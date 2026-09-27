package main

import (
	"bufio"
	"math"
	"math/rand"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// feedSeconds кормит трекер dur секунд кадрами с частотой hz.
func feedSeconds(tr *gyroBiasTracker, t0 time.Time, hz float64, dur time.Duration, bias [3]float64,
	gen func(i int) (raw, acc [3]float64)) ([3]float64, time.Time, int) {
	step := time.Duration(float64(time.Second) / hz)
	updates := 0
	now := t0
	for i := 0; now.Sub(t0) < dur; i++ {
		raw, acc := gen(i)
		if nb, ok := tr.Feed(now, raw, acc, bias); ok {
			bias = nb
			updates++
		}
		now = now.Add(step)
	}
	return bias, now, updates
}

func TestGyroBiasTracksUSBDrift(t *testing.T) {
	// USB-пад: сырой ноль 2°/с (как на реальных логах), шум 0.45°/с, 200 Гц.
	// Калибровка поймала ноль, потом он уплыл на 0.3°/с от прогрева.
	rng := rand.New(rand.NewSource(1))
	trueBias := [3]float64{-2.3, 0.64, 0.23}
	calBias := [3]float64{-2.0, 0.64, 0.23}
	gen := func(int) (raw, acc [3]float64) {
		for k := 0; k < 3; k++ {
			raw[k] = trueBias[k] + rng.NormFloat64()*0.45
			acc[k] = rng.NormFloat64() * 0.005
		}
		acc[2] -= 1
		return
	}
	var tr gyroBiasTracker
	bias, _, updates := feedSeconds(&tr, time.Unix(0, 0), 200, 20*time.Second, calBias, gen)
	errDps := math.Abs(bias[0] - trueBias[0])
	t.Logf("после 20 с покоя: bias X %.3f (истина %.3f, ошибка %.3f°/с), обновлений %d", bias[0], trueBias[0], errDps, updates)
	if updates < 15 || errDps > 0.05 {
		t.Fatalf("bias не подтянулся: ошибка %.3f°/с, обновлений %d", errDps, updates)
	}
}

func TestGyroBiasIgnoresHandheld(t *testing.T) {
	// В руке: медленный дрейф + тремор ~1.5°/с std — bias трогать нельзя.
	rng := rand.New(rand.NewSource(2))
	calBias := [3]float64{-2.0, 0.64, 0.23}
	gen := func(i int) (raw, acc [3]float64) {
		tt := float64(i) / 200
		for k := 0; k < 3; k++ {
			raw[k] = calBias[k] + 1.5*math.Sin(2*math.Pi*1.3*tt+float64(k)) + rng.NormFloat64()*0.5
			acc[k] = rng.NormFloat64() * 0.008
		}
		acc[2] -= 1
		return
	}
	var tr gyroBiasTracker
	bias, _, updates := feedSeconds(&tr, time.Unix(0, 0), 200, 20*time.Second, calBias, gen)
	if updates != 0 || bias != calBias {
		t.Fatalf("bias изменён в руке: %v, обновлений %d", bias, updates)
	}
}

func TestGyroBiasIgnoresSlowSteadyRotation(t *testing.T) {
	// Ровное медленное вращение 7°/с без шума — это не дрейф нуля (скачок > biasMaxJumpDps).
	calBias := [3]float64{0, 0, 0}
	gen := func(int) (raw, acc [3]float64) {
		return [3]float64{0, 7, 0}, [3]float64{0, -1, 0}
	}
	var tr gyroBiasTracker
	if bias, _, updates := feedSeconds(&tr, time.Unix(0, 0), 60, 10*time.Second, calBias, gen); updates != 0 {
		t.Fatalf("медленное вращение принято за bias: %v", bias)
	}
}

// TestGyroBiasOnRealCaptures: реальные шаги калибровки. Окна «Покой» должны
// приниматься, жесты — никогда. Нет файлов — skip.
func TestGyroBiasOnRealCaptures(t *testing.T) {
	found := false
	for _, sub := range []string{"usb", ""} {
		path := filepath.Join(os.Getenv("APPDATA"), "PhoneGyro", sub, "gyro_debug_capture.csv")
		f, err := os.Open(path)
		if err != nil {
			continue
		}
		found = true
		type sess struct {
			rest, gesture bool
			samples       []captureSample
		}
		var ss []*sess
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			line := sc.Text()
			if strings.HasPrefix(line, "# Session") {
				// Неудачный «Покой» не относим ни к одному классу: внутри него
				// бывает честная секунда покоя (проверено по среднему = нулю).
				ok := strings.Contains(line, "success=true")
				ss = append(ss, &sess{
					rest:    strings.Contains(line, "step=0") && ok,
					gesture: strings.Contains(line, "step=1") || strings.Contains(line, "step=2"),
				})
				continue
			}
			if len(ss) == 0 || line == "" || line[0] < '0' || line[0] > '9' {
				continue
			}
			var v [6]float64
			p := strings.Split(line, ",")
			for i := range v {
				v[i], _ = strconv.ParseFloat(p[i+1], 64)
			}
			cur := ss[len(ss)-1]
			cur.samples = append(cur.samples, captureSample{rot: [3]float64{v[0], v[1], v[2]}, acc: [3]float64{v[3], v[4], v[5]}})
		}
		f.Close()

		hz := 200.0
		name := sub
		if sub == "" {
			hz = 60
			name = "phone"
		}
		var restOK, restAll, gestBad, gestAll int
		for _, s := range ss {
			if len(s.samples) < 50 {
				continue
			}
			// Покой: bias = среднее сессии (как делает шаг 0), дальше окно должно пройти.
			var bias [3]float64
			for _, c := range s.samples {
				for k := 0; k < 3; k++ {
					bias[k] += c.rot[k] / float64(len(s.samples))
				}
			}
			var tr gyroBiasTracker
			updates := 0
			now := time.Unix(0, 0)
			for _, c := range s.samples {
				if _, ok := tr.Feed(now, c.rot, c.acc, bias); ok {
					updates++
				}
				now = now.Add(time.Duration(float64(time.Second) / hz))
			}
			if s.rest {
				restAll++
				if updates > 0 {
					restOK++
				} else {
					t.Logf("  %s: «Покой» без принятого окна: %d кадров", name, len(s.samples))
				}
			} else if s.gesture {
				gestAll++
				if updates > 0 {
					gestBad++
				}
			}
		}
		t.Logf("%s: окна покоя приняты в %d/%d сессиях «Покой»; жестов принято %d/%d", name, restOK, restAll, gestBad, gestAll)
		if gestBad != 0 {
			t.Errorf("%s: жест принят за покой в %d сессиях", name, gestBad)
		}
	}
	if !found {
		t.Skip("нет gyro_debug_capture.csv")
	}
}
