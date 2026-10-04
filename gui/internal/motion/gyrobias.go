package motion

import (
	"math"
	"time"
)

// Параметры нового алгоритма EWM
const (
	ewmTau = 0.25 // секунды: постоянная времени EWM
	// Шум USB-пада (±2000°/с) в покое доходит до 0.83°/с std, телефона — до
	// 0.1°/с; в руке даже самые спокойные полсекунды дают от 1.3°/с (замеры по
	// реальным логам калибровки). Порог лежит между ними: ниже 0.83 USB-пад
	// никогда не считается лежащим и подстройка у него не работает вовсе.
	restGyroStd    = 1.0  // °/с: порог std гироскопа
	restAccStd     = 0.02 // g: порог std акселерометра
	restMinAccG    = 0.92 // g
	restMaxAccG    = 1.08 // g
	restTime1      = 1.0  // с: первый порог (малый bias)
	restTime3      = 3.0  // с: второй порог (большой bias)
	biasFarDps     = 0.6  // °/с: "далеко" от текущего bias
	biasFollowTime = 5.0  // с: постоянная времени подстройки (малые изменения), как biasTau прежнего окна
	stallMaxTime   = 1.0  // с: после этого повторяющийся не-нулевой = stall
	biasMaxAbs     = 20.0 // °/с: абсолютный предел bias (санитарный)
	biasMaxJumpDps = 5.0  // °/с: среднее дальше от bias — не дрейф нуля, а медленное вращение
	maxDeltaTime   = 0.1  // с: зазор — большой gap = не покой
)

type BiasStatus struct {
	AtRest       bool
	RestProgress float64
	EWMGyroMean  [3]float64
}

type GyroBiasTracker struct {
	lastTime time.Time

	ewmMean    [3]float64
	ewmVar     [3]float64
	ewmAccMean [3]float64
	ewmAccVar  [3]float64

	prevRaw   [3]float64
	stallTime float64

	restTime float64
	restFar  bool

	initialized bool
	atRest      bool
	needTime    float64
}

func (t *GyroBiasTracker) Reset() { *t = GyroBiasTracker{} }

func (t *GyroBiasTracker) Status() BiasStatus {
	progress := 0.0
	if t.needTime > 0 {
		progress = t.restTime / t.needTime
		if progress > 1.0 {
			progress = 1.0
		}
	}
	return BiasStatus{
		AtRest:       t.atRest,
		RestProgress: progress,
		EWMGyroMean:  t.ewmMean,
	}
}

func (t *GyroBiasTracker) Feed(now time.Time, raw, acc, bias [3]float64) ([3]float64, bool) {
	if !t.initialized {
		t.lastTime = now
		t.ewmMean = raw
		t.ewmAccMean = acc
		t.prevRaw = raw
		t.needTime = restTime1
		t.initialized = true
		return bias, false
	}

	dt := now.Sub(t.lastTime).Seconds()
	t.lastTime = now

	if dt <= 0 {
		return bias, false
	}
	if dt > maxDeltaTime {
		t.atRest = false
		t.restTime = 0
		t.restFar = false
		return bias, false
	}

	k := dt / ewmTau
	if k > 1.0 {
		k = 1.0
	}

	for i := 0; i < 3; i++ {
		oldD := raw[i] - t.ewmMean[i]
		t.ewmMean[i] += k * oldD
		d := raw[i] - t.ewmMean[i]
		t.ewmVar[i] = (1-k)*t.ewmVar[i] + k*d*d

		oldDAcc := acc[i] - t.ewmAccMean[i]
		t.ewmAccMean[i] += k * oldDAcc
		dAcc := acc[i] - t.ewmAccMean[i]
		t.ewmAccVar[i] = (1-k)*t.ewmAccVar[i] + k*dAcc*dAcc
	}

	isStall := true
	allZero := true
	for i := 0; i < 3; i++ {
		if raw[i] != t.prevRaw[i] {
			isStall = false
		}
		if raw[i] != 0 {
			allZero = false
		}
	}
	if isStall && !allZero {
		t.stallTime += dt
	} else {
		t.stallTime = 0
	}
	t.prevRaw = raw

	accMag2 := t.ewmAccMean[0]*t.ewmAccMean[0] + t.ewmAccMean[1]*t.ewmAccMean[1] + t.ewmAccMean[2]*t.ewmAccMean[2]
	accMag := math.Sqrt(accMag2)

	atRest := true
	if t.stallTime > stallMaxTime {
		atRest = false
	}
	if accMag < restMinAccG || accMag > restMaxAccG {
		atRest = false
	}
	for i := 0; i < 3; i++ {
		if math.Sqrt(t.ewmVar[i]) >= restGyroStd {
			atRest = false
		}
		if math.Sqrt(t.ewmAccVar[i]) >= restAccStd {
			atRest = false
		}
	}

	t.atRest = atRest

	if !atRest {
		t.restTime = 0
		t.restFar = false
		return bias, false
	}

	t.restTime += dt

	far := false
	for i := 0; i < 3; i++ {
		dev := math.Abs(t.ewmMean[i] - bias[i])
		if dev > biasMaxJumpDps {
			// Ровное вращение без шума проходит фильтр по разбросу; ноль так
			// далеко не уплывает, поэтому не трогаем bias вовсе.
			t.restTime = 0
			t.restFar = false
			return bias, false
		}
		if dev >= biasFarDps {
			far = true
		}
	}

	if far && !t.restFar {
		t.restTime = dt
	}
	t.restFar = far

	if far {
		t.needTime = restTime3
	} else {
		t.needTime = restTime1
	}

	if t.restTime < t.needTime {
		return bias, false
	}

	updated := false
	for i := 0; i < 3; i++ {
		target := t.ewmMean[i]
		if math.Abs(target) > biasMaxAbs {
			if target > 0 {
				target = biasMaxAbs
			} else {
				target = -biasMaxAbs
			}
		}

		oldVal := bias[i]
		if far {
			bias[i] = target
		} else {
			kb := dt / biasFollowTime
			if kb > 1.0 {
				kb = 1.0
			}
			bias[i] += kb * (target - bias[i])
		}
		if bias[i] != oldVal {
			updated = true
		}
	}

	return bias, updated
}
