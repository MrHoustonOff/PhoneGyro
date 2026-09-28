package link

import "testing"

func lossOf(l *Loss) (string, uint64, uint64, uint64) { return l.Snapshot() }

func TestLinkLoss_USBSeqGaps(t *testing.T) {
	var l Loss
	for _, gap := range []int{1, 1, 4, 1, 0 /* дубликат SEQ считается как 1 */} {
		l.ObserveUSB(gap)
	}
	kind, total, merged, lost := lossOf(&l)
	if kind != "usb" || total != 8 || merged != 0 || lost != 3 {
		t.Fatalf("usb: kind=%q total=%d merged=%d lost=%d, want usb 8 0 3", kind, total, merged, lost)
	}
}

func TestLinkLoss_PhoneMergedAndLost(t *testing.T) {
	var l Loss
	l.ObservePhone(100, 0)  // базовая точка: ничего не считается
	l.ObservePhone(101, 0)  // 1 замер в пакете
	l.ObservePhone(101, 0)  // keep-alive: без новых замеров
	l.ObservePhone(105, 0)  // сокет был занят: 4 замера в одном пакете -> 3 склеено
	l.ObservePhone(170, 60) // пауза > 0.85 с: 60 выброшено, 5 в пакете -> 4 склеено
	kind, total, merged, lost := lossOf(&l)
	if kind != "phone" || total != 70 || merged != 7 || lost != 60 {
		t.Fatalf("phone: kind=%q total=%d merged=%d lost=%d, want phone 70 7 60", kind, total, merged, lost)
	}
}

func TestLinkLoss_PhoneReloadAndWrap(t *testing.T) {
	var l Loss
	l.ObservePhone(5000, 3)
	l.ObservePhone(5001, 3)
	// Перезагрузка страницы: счётчики начались заново — новая база, без фантомов.
	l.ObservePhone(2, 0)
	l.ObservePhone(3, 0)
	_, total, merged, lost := lossOf(&l)
	if total != 2 || merged != 0 || lost != 0 {
		t.Fatalf("after reload: total=%d merged=%d lost=%d, want 2 0 0", total, merged, lost)
	}
	// Переполнение uint32 не считается перезагрузкой.
	var w Loss
	w.ObservePhone(0xFFFF_FFFE, 0)
	w.ObservePhone(1, 0) // 3 замера через переполнение
	if _, total, merged, _ := w.Snapshot(); total != 3 || merged != 2 {
		t.Fatalf("wrap: total=%d merged=%d, want 3 and 2", total, merged)
	}
}

func TestLinkLoss_LegacyPageHasNoData(t *testing.T) {
	var l Loss
	l.ObservePhone(10, 0)
	l.ObservePhone(12, 0)
	l.MarkNoData()
	if kind, _, _, _ := l.Snapshot(); kind != "" {
		t.Fatalf("legacy page: kind=%q, want empty (no data)", kind)
	}
}
