package main

import (
	"time"

	"phonegyro/pkg/server"
)

// FrameClock даёт интервал, за который усреднена скорость кадра, — ровно тот,
// что DSU-клиент проинтегрирует по таймстампам пакетов (pkg/dsu stampMotion):
//   - есть часы устройства (MotionFrame.SampleClock) и интервал правдоподобен
//     (0 < d ≤ 1 с, 32-битный USB micros() — по модулю 2^32) — он и есть;
//   - часы устройства есть, но интервал неизвестен (первый кадр, переподключение,
//     сброс часов) — не больше одного кадра 60 Гц и не больше прошедшего времени;
//   - часов устройства нет (старая страница телефона) — время между кадрами на ПК,
//     как было раньше.
//
// Наш AHRS и attitudeanchor обязаны считать так же, как клиенты: иначе кубик
// разойдётся с PadTest, а anchor будет «исправлять» не ту ошибку.
type FrameClock struct {
	prevTs   uint64
	clock    uint8
	have     bool
	prevWall time.Time
}

// Interval возвращает интервал в секундах и true, если он взят с часов устройства.
func (c *FrameClock) Interval(frame server.MotionFrame, now time.Time) (float64, bool) {
	wall := -1.0
	if !c.prevWall.IsZero() {
		wall = now.Sub(c.prevWall).Seconds()
	}
	c.prevWall = now

	if frame.SampleClock == server.ClockNone {
		c.have = false
		if wall > 0 && wall <= 0.25 {
			return wall, false
		}
		return 1.0 / 60.0, false
	}

	d, ok := uint64(0), false
	if c.have && c.clock == frame.SampleClock {
		d, ok = server.SourceDeltaUs(c.prevTs, frame.TimestampUs, frame.SampleClock)
	}
	c.prevTs, c.clock, c.have = frame.TimestampUs, frame.SampleClock, true
	if ok {
		return float64(d) / 1e6, true
	}
	if wall > 0 && wall < 1.0/60.0 {
		return wall, false
	}
	return 1.0 / 60.0, false
}
