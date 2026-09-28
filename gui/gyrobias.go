package main

import (
	"math"
	"time"
)

// Живая подстройка нуля гироскопа (bias) в покое.
//
// Шаг «Покой» калибровки задаёт bias один раз, но ноль гироскопа плывёт от
// температуры (у MPU-6050 заметно в первые минуты после включения). Остаток в
// 0.1-0.3°/с — это 6-18° дрейфа yaw в минуту в игре, и акселерометр его не
// исправит. Поэтому, когда устройство лежит неподвижно, bias медленно
// подтягивается к среднему сырого гироскопа.
//
// Прежний вариант пропускал окно, только если СЫРАЯ скорость каждого кадра
// < 0.35°/с. У USB-пада сырой ноль ~2°/с (реальные логи), так что окно не
// проходило ни разу и подстройка не работала вовсе. Теперь покой определяется
// по разбросу внутри окна, а не по модулю скорости:
//
//   - разброс гироскопа (std по оси) в покое — это шум датчика: до 0.83°/с у
//     USB (±2000°/с) и до 0.1°/с у телефона; в руке даже самые спокойные
//     0.5 с дают от 1.3°/с (всё — замеры по реальным логам калибровки).
//     Порог 1.0°/с лежит между ними;
//   - акселерометр: |a| около 1g и небольшой разброс — грубый фильтр
//     движения (у USB в покое и в руке он пересекается, поэтому не главный);
//   - отклонение среднего от текущего bias ограничено: скачок больше
//     biasMaxJumpDps — это не дрейф, а медленное вращение, его не берём.
//
// Окно меряется по времени, а не числом кадров: USB идёт на ~200 Гц, телефон
// на 60 Гц, а смысл «секунда покоя» должен быть одинаковым.

const (
	biasWindow       = time.Second
	biasMinSamples   = 20
	biasTau          = 5 * time.Second // постоянная времени подстройки (по времени покоя)
	biasMaxStdDps    = 1.0             // max std гироскопа по оси в окне покоя
	biasMaxAccStdG   = 0.02            // max std акселерометра по оси в окне покоя
	biasMinAccG      = 0.92
	biasMaxAccG      = 1.08
	biasSampleMaxDps = 10.0 // кадр с |ω - bias| больше — явное движение, окно сначала
	biasMaxJumpDps   = 5.0  // среднее окна дальше от bias — не дрейф нуля
)

type GyroBiasTracker struct {
	start  time.Time
	n      int
	sum    [3]float64
	sumSq  [3]float64
	aSum   [3]float64
	aSumSq [3]float64
}

func (t *GyroBiasTracker) reset() { *t = GyroBiasTracker{} }

// Feed принимает сырой гироскоп (°/с), сырой акселерометр (g) и текущий bias.
// Возвращает новый bias и true, когда окно покоя закрылось и bias обновлён.
func (t *GyroBiasTracker) Feed(now time.Time, raw, acc, bias [3]float64) ([3]float64, bool) {
	accMag := Norm3(acc)
	d := [3]float64{raw[0] - bias[0], raw[1] - bias[1], raw[2] - bias[2]}
	if accMag < biasMinAccG || accMag > biasMaxAccG || Norm3(d) > biasSampleMaxDps {
		t.reset()
		return bias, false
	}
	if t.n == 0 {
		t.start = now
	}
	t.n++
	for k := 0; k < 3; k++ {
		t.sum[k] += raw[k]
		t.sumSq[k] += raw[k] * raw[k]
		t.aSum[k] += acc[k]
		t.aSumSq[k] += acc[k] * acc[k]
	}
	dur := now.Sub(t.start)
	if dur < biasWindow || t.n < biasMinSamples {
		return bias, false
	}

	n := float64(t.n)
	var mean [3]float64
	still := true
	for k := 0; k < 3; k++ {
		mean[k] = t.sum[k] / n
		gStd := math.Sqrt(math.Max(0, t.sumSq[k]/n-mean[k]*mean[k]))
		aMean := t.aSum[k] / n
		aStd := math.Sqrt(math.Max(0, t.aSumSq[k]/n-aMean*aMean))
		if gStd > biasMaxStdDps || aStd > biasMaxAccStdG || math.Abs(mean[k]-bias[k]) > biasMaxJumpDps {
			still = false
		}
	}
	t.reset()
	if !still {
		return bias, false
	}
	k := math.Min(1, dur.Seconds()/biasTau.Seconds())
	return [3]float64{
		bias[0] + k*(mean[0]-bias[0]),
		bias[1] + k*(mean[1]-bias[1]),
		bias[2] + k*(mean[2]-bias[2]),
	}, true
}
