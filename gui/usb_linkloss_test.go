package main

import (
	"phonegyro-gui/internal/hwproto"
	"testing"
)

func TestLinkLoss_USBThroughConnState(t *testing.T) {
	app := &App{usbBank: newMotionBank()}
	st := newUSBConnState()
	for _, seq := range []uint8{254, 255, 0, 3} { // через переполнение SEQ; 1 и 2 потеряны
		st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: seq}, app)
	}
	_, total, _, lost := app.usbBank.loss.Snapshot()
	if total != 6 || lost != 2 {
		t.Fatalf("total=%d lost=%d, want 6 and 2", total, lost)
	}
}
