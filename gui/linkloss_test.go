package main

import "testing"

func lossOf(l *linkLoss) (string, uint64, uint64, uint64) { return l.snapshot() }

func TestLinkLoss_USBSeqGaps(t *testing.T) {
	var l linkLoss
	for _, gap := range []int{1, 1, 4, 1, 0 /* дубликат SEQ считается как 1 */} {
		l.observeUSB(gap)
	}
	kind, total, merged, lost := lossOf(&l)
	if kind != "usb" || total != 8 || merged != 0 || lost != 3 {
		t.Fatalf("usb: kind=%q total=%d merged=%d lost=%d, want usb 8 0 3", kind, total, merged, lost)
	}
}

func TestLinkLoss_USBThroughConnState(t *testing.T) {
	app := &App{usbBank: newMotionBank()}
	st := newUSBConnState()
	for _, seq := range []uint8{254, 255, 0, 3} { // через переполнение SEQ; 1 и 2 потеряны
		st.handle(usbFrame{Type: usbTypeData, Seq: seq}, app)
	}
	_, total, _, lost := app.usbBank.loss.snapshot()
	if total != 6 || lost != 2 {
		t.Fatalf("total=%d lost=%d, want 6 and 2", total, lost)
	}
}

func TestLinkLoss_PhoneMergedAndLost(t *testing.T) {
	var l linkLoss
	l.observePhone(100, 0)  // базовая точка: ничего не считается
	l.observePhone(101, 0)  // 1 замер в пакете
	l.observePhone(101, 0)  // keep-alive: без новых замеров
	l.observePhone(105, 0)  // сокет был занят: 4 замера в одном пакете -> 3 склеено
	l.observePhone(170, 60) // пауза > 0.85 с: 60 выброшено, 5 в пакете -> 4 склеено
	kind, total, merged, lost := lossOf(&l)
	if kind != "phone" || total != 70 || merged != 7 || lost != 60 {
		t.Fatalf("phone: kind=%q total=%d merged=%d lost=%d, want phone 70 7 60", kind, total, merged, lost)
	}
}

func TestLinkLoss_PhoneReloadAndWrap(t *testing.T) {
	var l linkLoss
	l.observePhone(5000, 3)
	l.observePhone(5001, 3)
	// Перезагрузка страницы: счётчики начались заново — новая база, без фантомов.
	l.observePhone(2, 0)
	l.observePhone(3, 0)
	_, total, merged, lost := lossOf(&l)
	if total != 2 || merged != 0 || lost != 0 {
		t.Fatalf("after reload: total=%d merged=%d lost=%d, want 2 0 0", total, merged, lost)
	}
	// Переполнение uint32 не считается перезагрузкой.
	var w linkLoss
	w.observePhone(0xFFFF_FFFE, 0)
	w.observePhone(1, 0) // 3 замера через переполнение
	if _, total, merged, _ := w.snapshot(); total != 3 || merged != 2 {
		t.Fatalf("wrap: total=%d merged=%d, want 3 and 2", total, merged)
	}
}

func TestLinkLoss_LegacyPageHasNoData(t *testing.T) {
	var l linkLoss
	l.observePhone(10, 0)
	l.observePhone(12, 0)
	l.markNoData()
	if kind, _, _, _ := l.snapshot(); kind != "" {
		t.Fatalf("legacy page: kind=%q, want empty (no data)", kind)
	}
}
