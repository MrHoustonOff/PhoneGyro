package main

import (
	"testing"
	"time"
)

// lossSim прогоняет детектор тиками по 250 мс; step возвращает прирост счётчиков
// за тик (total, merged, lost). Возвращает времена срабатываний (в секундах).
func lossSim(kind string, secs float64, active func(t float64) bool,
	step func(t float64) (uint64, uint64, uint64)) []float64 {
	var d lossAlarm
	var total, merged, lost uint64
	t0 := time.Unix(1000, 0)
	var fired []float64
	for t := 0.0; t < secs; t += 0.25 {
		dt, dm, dl := step(t)
		total, merged, lost = total+dt, merged+dm, lost+dl
		now := t0.Add(time.Duration(t * float64(time.Second)))
		connectedFor := time.Duration((t + 5) * float64(time.Second)) // подключено давно
		if _, ok := d.check(now, active(t), connectedFor, kind, total, merged, lost); ok {
			fired = append(fired, t)
		}
	}
	return fired
}

func always(float64) bool { return true }

func TestLossAlarm_QuietOnHealthyLinks(t *testing.T) {
	// USB 200 Гц с редкими одиночными сбоями CRC (1 кадр в 2 с) — не повод.
	usb := lossSim("usb", 60, always, func(t float64) (uint64, uint64, uint64) {
		if int(t*4)%8 == 0 {
			return 50, 0, 1
		}
		return 50, 0, 0
	})
	// Телефон 60 Гц на нормальном Wi-Fi: ~15% замеров склеено, потерь нет.
	phone := lossSim("phone", 60, always, func(t float64) (uint64, uint64, uint64) {
		return 15, 2, 0
	})
	if len(usb) != 0 || len(phone) != 0 {
		t.Fatalf("false alarms: usb %v, phone %v", usb, phone)
	}
}

func TestLossAlarm_FiresOnRealTrouble(t *testing.T) {
	// USB: плохой кабель с 20 с — теряется 10% кадров.
	usb := lossSim("usb", 30, always, func(t float64) (uint64, uint64, uint64) {
		if t >= 20 {
			return 50, 0, 5
		}
		return 50, 0, 0
	})
	if len(usb) == 0 || usb[0] < 20 || usb[0] > 21.5 {
		t.Fatalf("usb: fired at %v, want once soon after 20 s", usb)
	}
	// Телефон: одна пауза связи > 0.85 с на 10-й секунде — 60 замеров выброшено.
	stall := lossSim("phone", 20, always, func(t float64) (uint64, uint64, uint64) {
		if t == 10 {
			return 65, 4, 60
		}
		return 15, 1, 0
	})
	if len(stall) != 1 || stall[0] != 10 {
		t.Fatalf("phone stall: fired at %v, want exactly at 10 s", stall)
	}
	// Телефон: Wi-Fi захлёбывается с 5 с — 70% замеров склеены.
	congested := lossSim("phone", 12, always, func(t float64) (uint64, uint64, uint64) {
		if t >= 5 {
			return 15, 11, 0
		}
		return 15, 1, 0
	})
	// Окно 3 с усредняет хорошие и плохие замеры, поэтому порог 60% набирается
	// за ~2 с устойчивой перегрузки — это и есть защита от коротких всплесков.
	if len(congested) == 0 || congested[0] < 5 || congested[0] > 8 {
		t.Fatalf("phone congestion: fired at %v, want within 3 s after 5 s", congested)
	}
}

func TestLossAlarm_CooldownAndPause(t *testing.T) {
	// Постоянно плохой USB 60 с: не чаще раза в 15 с.
	bad := func(float64) (uint64, uint64, uint64) { return 50, 0, 10 }
	fired := lossSim("usb", 60, always, bad)
	for i := 1; i < len(fired); i++ {
		if fired[i]-fired[i-1] < 15 {
			t.Fatalf("alarms %v are closer than the 15 s cooldown", fired)
		}
	}
	if len(fired) < 3 || len(fired) > 4 {
		t.Fatalf("60 s of bad link: %d alarms (%v), want 3-4", len(fired), fired)
	}
	// На паузе — тишина.
	if got := lossSim("usb", 30, func(float64) bool { return false }, bad); len(got) != 0 {
		t.Fatalf("alarm while paused/disconnected: %v", got)
	}
}

func TestLossAlarm_GraceAfterConnect(t *testing.T) {
	var d lossAlarm
	t0 := time.Unix(0, 0)
	var total, lost uint64
	for i := 0; i < 8; i++ { // первые 2 с после подключения — сплошные потери
		total, lost = total+50, lost+25
		now := t0.Add(time.Duration(i) * 250 * time.Millisecond)
		if _, ok := d.check(now, true, time.Duration(i)*250*time.Millisecond, "usb", total, 0, lost); ok {
			t.Fatalf("alarm %v after connect, inside the %v grace period", time.Duration(i)*250*time.Millisecond, lossGrace)
		}
	}
}

func TestLossAlarm_NoDataSourceIsSilent(t *testing.T) {
	// Старая страница телефона (kind "") — счётчиков нет, звука нет.
	if got := lossSim("", 30, always, func(float64) (uint64, uint64, uint64) { return 0, 0, 0 }); len(got) != 0 {
		t.Fatalf("alarm without data: %v", got)
	}
}
