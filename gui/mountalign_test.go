package main

import (
	"bufio"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func rotAxis(axis [3]float64, deg float64) [3][3]float64 {
	n := Norm3(axis)
	x, y, z := axis[0]/n, axis[1]/n, axis[2]/n
	a := deg * math.Pi / 180
	c, s, t := math.Cos(a), math.Sin(a), 1-math.Cos(a)
	return [3][3]float64{
		{t*x*x + c, t*x*y - s*z, t*x*z + s*y},
		{t*x*y + s*z, t*y*y + c, t*y*z - s*x},
		{t*x*z - s*y, t*y*z + s*x, t*z*z + c},
	}
}

// Датчик повёрнут в корпусе: sensor = Mᵀ·body. Жест «вперёд» — вращение вокруг X корпуса.
func simulateMount(m [3][3]float64, pitchWobbleDeg float64) (up [3]float64, pitch [][3]float64) {
	mt := Transpose3(m)
	up = MulVec3(mt, [3]float64{0, 1, 0})
	wob := rotAxis([3]float64{0, 1, 0}, pitchWobbleDeg)
	for i := 0; i < 200; i++ {
		w := 150 * math.Sin(float64(i)/10)
		pitch = append(pitch, MulVec3(mt, MulVec3(wob, [3]float64{w, 0, 0})))
	}
	return
}

func TestMountRealTiltIsCorrected(t *testing.T) {
	// 7.8° вокруг Z корпуса + 2° вокруг X — как у реального USB-пада.
	m := MatMul(rotAxis([3]float64{0, 0, 1}, 7.8), rotAxis([3]float64{1, 0, 0}, 2))
	up, pitch := simulateMount(m, 1.5)
	c := ComputeMountCorrection(up, pitch)
	if c.Status != mountOK || !c.Active() {
		t.Fatalf("status %s (tilt %.2f check %.2f), want ok", c.Status, c.TiltDeg, c.CheckDeg)
	}
	if got := MulVec3(c.R, up); math.Abs(got[1]-1) > 1e-9 {
		t.Fatalf("R·up = %v, want (0,1,0)", got)
	}
	// Главное — перекрёстное влияние: чистый горизонтальный поворот корпуса после
	// поправки почти не должен уходить в pitch/roll (без поправки ~14%).
	yaw := MulVec3(Transpose3(m), [3]float64{0, 100, 0})
	before := math.Hypot(yaw[0], yaw[2]) / 100
	fixed := MulVec3(c.R, yaw)
	after := math.Hypot(fixed[0], fixed[2]) / 100
	t.Logf("tilt %.2f° (вперёд %.2f, вправо %.2f), check %.2f°, утечка yaw: %.1f%% -> %.2f%%",
		c.TiltDeg, c.ForwardDeg, c.RightDeg, c.CheckDeg, before*100, after*100)
	if before < 0.1 || after > 0.01 {
		t.Fatalf("утечка yaw %.3f -> %.3f, want >0.1 -> <0.01", before, after)
	}
}

func TestMountAccelBiasIsRejected(t *testing.T) {
	// Датчик стоит ровно, но акселерометр смещён на 0.136g по X: гироскоп наклона не видит.
	up := [3]float64{-0.136, 1, 0}
	_, pitch := simulateMount(Identity3(), 0)
	c := ComputeMountCorrection(up, pitch)
	if c.Status != mountInconsistent || c.Active() {
		t.Fatalf("status %s (tilt %.2f check %.2f), want inconsistent", c.Status, c.TiltDeg, c.CheckDeg)
	}
}

func TestMountThresholds(t *testing.T) {
	_, pitch := simulateMount(Identity3(), 0)
	if c := ComputeMountCorrection([3]float64{0.005, 1, 0}, pitch); c.Status != mountSmall || c.Active() {
		t.Fatalf("small tilt: status %s", c.Status)
	}
	m := rotAxis([3]float64{1, 0, 0}, 40)
	up, pitch := simulateMount(m, 0)
	if c := ComputeMountCorrection(up, pitch); c.Status != mountTooLarge || c.Active() {
		t.Fatalf("40°: status %s", c.Status)
	}
	if c := ComputeMountCorrection([3]float64{0.1, 1, 0}, nil); c.Status != mountNoData || c.Active() {
		t.Fatalf("no gesture: status %s", c.Status)
	}
}

func TestMountSignsMatchLevel(t *testing.T) {
	// Датчик завален вперёд (дальний край вниз) = -θ вокруг X — так же, как в TestEulerSigns.
	up, pitch := simulateMount(rotAxis([3]float64{1, 0, 0}, -6), 0)
	c := ComputeMountCorrection(up, pitch)
	if math.Abs(c.ForwardDeg-6) > 0.01 || math.Abs(c.RightDeg) > 0.01 {
		t.Fatalf("вперёд %.2f вправо %.2f, want 6, 0", c.ForwardDeg, c.RightDeg)
	}
	up, pitch = simulateMount(rotAxis([3]float64{0, 0, 1}, -6), 0)
	c = ComputeMountCorrection(up, pitch)
	if math.Abs(c.RightDeg-6) > 0.01 || math.Abs(c.ForwardDeg) > 0.01 {
		t.Fatalf("вперёд %.2f вправо %.2f, want 0, 6", c.ForwardDeg, c.RightDeg)
	}
}

func TestMountApplyToDSU(t *testing.T) {
	c := MountCorrection{Status: mountOK, Enabled: true, R: rotAxis([3]float64{1, 2, 3}, 10)}
	rot := [3]float64{10, -20, 30}
	acc := [3]float64{0.1, -0.9, 0.2}
	r2, a2 := c.ApplyToDSU(rot, acc)
	// Физический кадр: ω = P·Rot, up = -Acc — оба должны повернуться одним R.
	wantW := MulVec3(c.R, [3]float64{rot[0], -rot[1], -rot[2]})
	wantU := MulVec3(c.R, [3]float64{-acc[0], -acc[1], -acc[2]})
	gotW := [3]float64{r2[0], -r2[1], -r2[2]}
	gotU := [3]float64{-a2[0], -a2[1], -a2[2]}
	for i := 0; i < 3; i++ {
		if math.Abs(gotW[i]-wantW[i]) > 1e-9 || math.Abs(gotU[i]-wantU[i]) > 1e-9 {
			t.Fatalf("ω %v want %v; up %v want %v", gotW, wantW, gotU, wantU)
		}
	}
}

// TestMountOnRealUSBCapture прогоняет последние реальные калибровки USB-пада
// (%APPDATA%/PhoneGyro/usb) через тот же путь, что и SaveProfile. Нет файлов — skip.
func TestMountOnRealUSBCapture(t *testing.T) {
	dir := filepath.Join(os.Getenv("APPDATA"), "PhoneGyro", "usb")
	f, err := os.Open(filepath.Join(dir, "gyro_debug_capture.csv"))
	if err != nil {
		t.Skip("нет usb/gyro_debug_capture.csv")
	}
	defer f.Close()

	type session struct {
		step    int
		ok      bool
		samples []captureSample
	}
	var sessions []*session
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "# Session") {
			s := &session{ok: strings.Contains(line, "success=true")}
			if i := strings.Index(line, "step="); i >= 0 {
				s.step, _ = strconv.Atoi(line[i+5 : i+6])
			}
			sessions = append(sessions, s)
			continue
		}
		if len(sessions) == 0 || line == "" || line[0] < '0' || line[0] > '9' {
			continue
		}
		p := strings.Split(line, ",")
		if len(p) < 7 {
			continue
		}
		var v [6]float64
		for i := range v {
			v[i], _ = strconv.ParseFloat(p[i+1], 64)
		}
		cur := sessions[len(sessions)-1]
		cur.samples = append(cur.samples, captureSample{rot: [3]float64{v[0], v[1], v[2]}, acc: [3]float64{v[3], v[4], v[5]}})
	}

	// Матрица и кадр датчика — как в сохранённом USB-профиле.
	mat := [3][3]float64{{1, 0, 0}, {0, 0, -1}, {0, -1, 0}}
	sf := SensorFrame{Q: Identity3(), H: -1}
	runs := 0
	for i := 0; i+1 < len(sessions); i++ {
		rest, pitch := sessions[i], sessions[i+1]
		if rest.step != 0 || !rest.ok || pitch.step != 1 || !pitch.ok {
			continue
		}
		var g [3]float64
		for _, s := range rest.samples {
			for k := 0; k < 3; k++ {
				g[k] += s.acc[k] / float64(len(rest.samples))
			}
		}
		n := Norm3(g)
		g = [3]float64{g[0] / n, g[1] / n, g[2] / n}
		c := mountFromCalibration(mat, sf, g, pitch.samples)
		runs++
		t.Logf("калибровка #%d: %s  наклон %.2f° (вперёд %.2f, вправо %.2f)  проверка %.2f°",
			runs, c.Status, c.TiltDeg, c.ForwardDeg, c.RightDeg, c.CheckDeg)
	}
	if runs == 0 {
		t.Skip("нет пар покой + жест «вперёд»")
	}
}
