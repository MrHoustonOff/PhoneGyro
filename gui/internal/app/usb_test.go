package app

import (
	"phonegyro-gui/internal/hwproto"
	"testing"
)

func TestUSBConnStateMetadataOverridesDefaultRange(t *testing.T) {
	app := &App{}
	st := newUSBConnState()

	if st.gyroRangeDps != usbDefaultGyroRangeDps || st.accelRangeG != usbDefaultAccelRangeG {
		t.Fatalf("expected safe defaults before any metadata frame, got gyro=%v accel=%v", st.gyroRangeDps, st.accelRangeG)
	}

	meta := hwproto.Frame{Type: hwproto.TypeMeta, Accel: [3]int16{4, 500, 200}}
	st.handle(meta, app)
	if st.accelRangeG != 4 || st.gyroRangeDps != 500 {
		t.Fatalf("metadata frame should override range: got gyro=%v accel=%v", st.gyroRangeDps, st.accelRangeG)
	}

	// A data frame at full-scale positive raw value should now convert using
	// the declared range, not the default.
	data := hwproto.Frame{Type: hwproto.TypeData, Seq: 1, Gyro: [3]int16{32767, 0, 0}}
	st.handle(data, app) // app.srv is nil, handle() must not panic
}

func TestUSBConnStateTracksDroppedFrames(t *testing.T) {
	app := &App{}
	st := newUSBConnState()
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 0}, app)
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 1}, app)
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 5}, app) // 3 frames lost (2,3,4)
	if st.droppedFrames != 3 {
		t.Fatalf("expected 3 dropped frames tracked, got %d", st.droppedFrames)
	}

	st2 := newUSBConnState()
	st2.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 254}, app)
	st2.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 1}, app) // 254->1 wraps through 255,0: 2 genuinely dropped
	if st2.droppedFrames != 2 {
		t.Fatalf("expected wraparound gap to count as 2 dropped frames, got %d", st2.droppedFrames)
	}
}

func TestUSBConnStateResetButtonIsEdgeTriggered(t *testing.T) {
	app := &App{}
	st := newUSBConnState()
	// Holding the button across several frames must fire recenter exactly
	// once (on the rising edge), not once per frame.
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 0, Buttons: 0x01}, app)
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 1, Buttons: 0x01}, app)
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 2, Buttons: 0x01}, app)
	if !st.prevResetHeld {
		t.Fatalf("expected reset-held state to be tracked as true")
	}
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 3, Buttons: 0x00}, app)
	if st.prevResetHeld {
		t.Fatalf("expected reset-held state to clear once the bit drops")
	}
}

// TestUSBConnStateBootRestartIsNotLoss: the Nano resets when the port opens, often
// after the probe already read stale frames of the previous run. Its metadata frame
// starts a new SEQ count; the jump back to 0 is not lost frames.
func TestUSBConnStateBootRestartIsNotLoss(t *testing.T) {
	app := &App{}
	st := newUSBConnState()
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 200}, app)
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 201}, app)
	st.handle(hwproto.Frame{Type: hwproto.TypeMeta}, app) // reboot
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 0}, app)
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 1}, app)
	if st.droppedFrames != 0 {
		t.Fatalf("device restart counted as %d dropped frames, want 0", st.droppedFrames)
	}
}

// TestUSBConnStateRepeatedMetadata: protocol v1.1 repeats metadata mid-stream. A
// host that joined a running stream (no boot seen) switches to the declared range
// when it arrives, and the repeat does not break or fake the SEQ count.
func TestUSBConnStateRepeatedMetadata(t *testing.T) {
	app := &App{}
	st := newUSBConnState()
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 40}, app)
	if st.gyroRangeDps != usbDefaultGyroRangeDps {
		t.Fatalf("before metadata: %g dps, want the default", st.gyroRangeDps)
	}
	meta := hwproto.Frame{Type: hwproto.TypeMeta}
	meta.Accel[0], meta.Accel[1] = 2, 2000
	st.handle(meta, app)
	if st.gyroRangeDps != 2000 {
		t.Fatalf("mid-stream metadata not applied: %g dps", st.gyroRangeDps)
	}
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 41}, app)
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 43}, app) // one really lost
	if st.droppedFrames != 1 {
		t.Fatalf("dropped %d, want 1", st.droppedFrames)
	}
}
