package dsu

import (
	"math"
	"math/rand"
	"testing"

	"gyrobridge/pkg/server"
)

func devFrame(tsUs uint64, clock uint8, rate float32) server.MotionFrame {
	return server.MotionFrame{TimestampUs: tsUs, SampleClock: clock, RotY: rate, AccY: -1}
}

func TestStamp_DeviceClockIgnoresArrivalTiming(t *testing.T) {
	srv := NewServer(0)
	prev := srv.stampMotion(devFrame(1_000_000, server.ClockMicros64, 0))
	// A burst: five frames processed back-to-back, 16 667 µs apart on the device.
	for i := 1; i <= 5; i++ {
		ts := srv.stampMotion(devFrame(1_000_000+uint64(i)*16_667, server.ClockMicros64, 10))
		if d := ts - prev; d != 16_667 {
			t.Fatalf("frame %d: DSU delta %d µs, want the device's 16667", i, d)
		}
		prev = ts
	}
}

func TestStamp_IdleAndRepeatDoNotStealDeviceInterval(t *testing.T) {
	srv := NewServer(0)
	srv.stampMotion(devFrame(0, server.ClockMicros64, 0))
	srv.stampMotion(devFrame(16_667, server.ClockMicros64, 50))
	// Stall: heartbeat filler and a client's data request in between.
	srv.stampIdle()
	srv.stampIdle()
	before := srv.stampRepeat()
	// The frame after the stall carries the mean rate over the whole 300 ms.
	after := srv.stampMotion(devFrame(316_667, server.ClockMicros64, 50))
	if d := after - before; d != 300_000 {
		t.Fatalf("post-stall frame spans %d µs, want the device's 300000", d)
	}
}

func TestStamp_RepeatSpansOneMicrosecond(t *testing.T) {
	srv := NewServer(0)
	a := srv.stampMotion(devFrame(0, server.ClockMicros64, 100))
	b := srv.stampRepeat()
	if b-a != 1 {
		t.Fatalf("repeat spans %d µs, want 1 (its rate was already delivered)", b-a)
	}
}

func TestStamp_SkipMotionDuringPause(t *testing.T) {
	srv := NewServer(0)
	srv.stampMotion(devFrame(0, server.ClockMicros64, 0))
	last := srv.stampMotion(devFrame(16_667, server.ClockMicros64, 0))
	// 2 s of paused output: frames reach the server but are not sent.
	var ts uint64 = 16_667
	for i := 0; i < 120; i++ {
		ts += 16_667
		srv.SkipMotion(devFrame(ts, server.ClockMicros64, 90))
	}
	ts += 16_667
	got := srv.stampMotion(devFrame(ts, server.ClockMicros64, 90))
	if d := got - last; d != 16_667 {
		t.Fatalf("first frame after pause spans %d µs, want its own 16667 (not the pause)", d)
	}
}

func TestStamp_USBMicrosWrap(t *testing.T) {
	srv := NewServer(0)
	prev := srv.stampMotion(devFrame(0xFFFF_EC77, server.ClockMicros32, 0)) // 5000 µs before wrap
	ts := srv.stampMotion(devFrame(0x0000_0000, server.ClockMicros32, 0))
	if d := ts - prev; d != 5_001 {
		t.Fatalf("across micros() wrap: %d µs, want 5001", d)
	}
}

func TestStamp_ClockResetIsBounded(t *testing.T) {
	srv := NewServer(0)
	srv.stampMotion(devFrame(50_000_000, server.ClockMicros64, 0))
	prev := srv.stampMotion(devFrame(50_016_667, server.ClockMicros64, 0))
	// Page reload: device clock restarts near zero. Unknown interval -> at most one frame.
	ts := srv.stampMotion(devFrame(1_000, server.ClockMicros64, 300))
	if d := ts - prev; d > nominalFrameUs {
		t.Fatalf("after clock reset: %d µs, want <= %d", d, nominalFrameUs)
	}
}

// TestStamp_ClientAngleMatchesDevice — сквозная модель: телефон (логика
// web/index.html: копит поворот, пока сокет занят, шлёт среднюю скорость за
// интервал), Wi-Fi с паузами и пачками, наш DSU-сервер с пустыми кадрами, и
// клиент, который интегрирует RotY × Δts. Сравниваем итоговый угол клиента с
// реально измеренным телефоном — в старой схеме (время отправки на ПК, пустые
// кадры через 35 мс) и в новой.
func TestStamp_ClientAngleMatchesDevice(t *testing.T) {
	// Вероятность паузы Wi-Fi каждого вида на каждое событие датчика (60 Гц):
	// 0.001 ≈ пауза раз в ~8 с, 0.01 ≈ ~2 паузы в секунду (плохая сеть).
	for _, stallP := range []float64{0.001, 0.01} {
		clientAngleVsDevice(t, stallP)
	}
}

func clientAngleVsDevice(t *testing.T, stallP float64) {
	rng := rand.New(rand.NewSource(7))
	const eventUs = 16_667 // DeviceMotion at 60 Hz
	const simUs = 120_000_000

	type pkt struct {
		arriveUs float64
		tsUs     uint64
		rate     float64
	}
	var pkts []pkt

	// Phone side.
	var accum, accumDt float64 // °, s
	clock := 1_000_000.0       // integration clock, µs
	measured := 0.0            // what the phone actually measured, °
	busyUntil, netHoldUntil := 0.0, 0.0
	for tUs := 0.0; tUs < simUs; tUs += eventUs {
		sec := tUs / 1e6
		rate := 220*math.Sin(2*math.Pi*0.6*sec) + 80*math.Sin(2*math.Pi*1.7*sec+1)
		dt := eventUs / 1e6
		accum += rate * dt
		accumDt += dt
		measured += rate * dt

		// Wi-Fi: occasional stalls where the socket stays busy (nothing sent),
		// and occasional ones where sent packets are held and arrive in a burst.
		if rng.Float64() < stallP {
			busyUntil = tUs + 50_000 + rng.Float64()*350_000
		}
		if rng.Float64() < stallP {
			netHoldUntil = tUs + 50_000 + rng.Float64()*300_000
		}
		if tUs < busyUntil {
			continue
		}
		ts := clock + accumDt*1e6
		arrive := tUs + 3_000 + rng.Float64()*4_000
		if arrive < netHoldUntil {
			arrive = netHoldUntil + rng.Float64()*500
		}
		pkts = append(pkts, pkt{arriveUs: arrive, tsUs: uint64(math.Round(ts)), rate: accum / accumDt})
		clock = ts
		accum, accumDt = 0, 0
	}

	// Old scheme: DSU ts = PC arrival time, filler frames after 35 ms of silence.
	oldAngle, lastArrive := 0.0, pkts[0].arriveUs
	for _, p := range pkts[1:] {
		prevTs := lastArrive
		for gap := lastArrive + 35_000; gap < p.arriveUs; gap += 16_000 {
			prevTs = gap // filler frame (rate 0) resets the client's delta
		}
		if p.arriveUs > prevTs {
			oldAngle += p.rate * (p.arriveUs - prevTs) / 1e6
		}
		lastArrive = p.arriveUs
	}

	// New scheme: this server's timestamp chain, filler after idleAfter.
	srv := NewServer(0)
	newAngle := 0.0
	prevTs := srv.stampMotion(devFrame(pkts[0].tsUs, server.ClockMicros64, float32(pkts[0].rate)))
	lastArrive = pkts[0].arriveUs
	for _, p := range pkts[1:] {
		for gap := lastArrive + float64(idleAfter.Microseconds()); gap < p.arriveUs; gap += 16_000 {
			prevTs = srv.stampIdle() // rate 0: contributes nothing, only moves ts
		}
		ts := srv.stampMotion(devFrame(p.tsUs, server.ClockMicros64, float32(p.rate)))
		newAngle += float64(float32(p.rate)) * float64(ts-prevTs) / 1e6
		prevTs = ts
		lastArrive = p.arriveUs
	}
	// The first packet's own interval is not integrated by any client.
	measuredAfterFirst := measured - pkts[0].rate*float64(pkts[0].tsUs-1_000_000)/1e6

	oldErr := math.Abs(oldAngle - measuredAfterFirst)
	newErr := math.Abs(newAngle - measuredAfterFirst)
	t.Logf("паузы p=%.3f, 2 мин, %d пакетов: ошибка угла у клиента — старая схема %.1f°, новая %.4f°", stallP, len(pkts), oldErr, newErr)
	if newErr > 0.05 {
		t.Fatalf("new scheme loses %.3f° of measured rotation", newErr)
	}
}
