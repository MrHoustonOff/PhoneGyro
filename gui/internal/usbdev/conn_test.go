package usbdev

import (
	"testing"

	"phonegyro-gui/internal/hwproto"
)

func TestUSBConnStateMetadataOverridesDefaultRange(t *testing.T) {
	app := newTestHost(t)
	st := newConnState()

	if st.gyroRangeDps != defaultGyroRangeDps || st.accelRangeG != defaultAccelRangeG {
		t.Fatalf("expected safe defaults before any metadata frame, got gyro=%v accel=%v", st.gyroRangeDps, st.accelRangeG)
	}

	meta := hwproto.Frame{Type: hwproto.TypeMeta, Accel: [3]int16{4, 500, 200}}
	st.handle(meta, &app.Host)
	if st.accelRangeG != 4 || st.gyroRangeDps != 500 {
		t.Fatalf("metadata frame should override range: got gyro=%v accel=%v", st.gyroRangeDps, st.accelRangeG)
	}

	// A data frame at full-scale positive raw value should now convert using
	// the declared range, not the default.
	data := hwproto.Frame{Type: hwproto.TypeData, Seq: 1, Gyro: [3]int16{32767, 0, 0}}
	st.handle(data, &app.Host)
}

func TestUSBConnStateTracksDroppedFrames(t *testing.T) {
	app := newTestHost(t)
	st := newConnState()
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 0}, &app.Host)
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 1}, &app.Host)
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 5}, &app.Host) // 3 frames lost (2,3,4)
	if st.droppedFrames != 3 {
		t.Fatalf("expected 3 dropped frames tracked, got %d", st.droppedFrames)
	}

	st2 := newConnState()
	st2.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 254}, &app.Host)
	st2.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 1}, &app.Host) // 254->1 wraps through 255,0: 2 genuinely dropped
	if st2.droppedFrames != 2 {
		t.Fatalf("expected wraparound gap to count as 2 dropped frames, got %d", st2.droppedFrames)
	}
}

func TestUSBConnStateResetButtonIsEdgeTriggered(t *testing.T) {
	app := newTestHost(t)
	st := newConnState()
	// Holding the button across several frames must fire recenter exactly
	// once (on the rising edge), not once per frame.
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 0, Buttons: 0x01}, &app.Host)
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 1, Buttons: 0x01}, &app.Host)
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 2, Buttons: 0x01}, &app.Host)
	if !st.prevResetHeld {
		t.Fatalf("expected reset-held state to be tracked as true")
	}
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 3, Buttons: 0x00}, &app.Host)
	if st.prevResetHeld {
		t.Fatalf("expected reset-held state to clear once the bit drops")
	}
	if app.recenters != 1 {
		t.Fatalf("recenter fired %d times, want 1", app.recenters)
	}
}

// TestUSBConnStateBootRestartIsNotLoss: the Nano resets when the port opens, often
// after the probe already read stale frames of the previous run. Its metadata frame
// starts a new SEQ count; the jump back to 0 is not lost frames.
func TestUSBConnStateBootRestartIsNotLoss(t *testing.T) {
	app := newTestHost(t)
	st := newConnState()
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 200}, &app.Host)
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 201}, &app.Host)
	st.handle(hwproto.Frame{Type: hwproto.TypeMeta}, &app.Host) // reboot
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 0}, &app.Host)
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 1}, &app.Host)
	if st.droppedFrames != 0 {
		t.Fatalf("device restart counted as %d dropped frames, want 0", st.droppedFrames)
	}
}

// TestUSBConnStateRepeatedMetadata: protocol v1.1 repeats metadata mid-stream. A
// host that joined a running stream (no boot seen) switches to the declared range
// when it arrives, and the repeat does not break or fake the SEQ count.
func TestUSBConnStateRepeatedMetadata(t *testing.T) {
	app := newTestHost(t)
	st := newConnState()
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 40}, &app.Host)
	if st.gyroRangeDps != defaultGyroRangeDps {
		t.Fatalf("before metadata: %g dps, want the default", st.gyroRangeDps)
	}
	meta := hwproto.Frame{Type: hwproto.TypeMeta}
	meta.Accel[0], meta.Accel[1] = 2, 2000
	st.handle(meta, &app.Host)
	if st.gyroRangeDps != 2000 {
		t.Fatalf("mid-stream metadata not applied: %g dps", st.gyroRangeDps)
	}
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 41}, &app.Host)
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 43}, &app.Host) // one really lost
	if st.droppedFrames != 1 {
		t.Fatalf("dropped %d, want 1", st.droppedFrames)
	}
}

// TestConnStateHandsOnFrames: a data frame reaches the app converted with the
// declared range, with its SEQ gap for the loss counters (через переполнение
// SEQ; 1 и 2 потеряны), and a name frame names the device once.
func TestConnStateHandsOnFrames(t *testing.T) {
	app := newTestHost(t)
	st := newConnState()
	meta := hwproto.Frame{Type: hwproto.TypeMeta}
	meta.Accel[0], meta.Accel[1] = 4, 2000
	st.handle(meta, &app.Host)
	for _, seq := range []uint8{254, 255, 0, 3} {
		st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: seq, Gyro: [3]int16{16384, 0, 0}, Accel: [3]int16{0, 0, 8192}}, &app.Host)
	}
	if len(app.gaps) != 4 || app.gaps[0] != 1 || app.gaps[1] != 1 || app.gaps[2] != 1 || app.gaps[3] != 3 {
		t.Fatalf("gaps %v, want [1 1 1 3]", app.gaps)
	}
	if len(app.frames) != 4 || app.frames[0].RotX != 1000 || app.frames[0].AccZ != 1 {
		t.Fatalf("frames: %d, first %+v", len(app.frames), app.frames[0])
	}
	st.handle(hwproto.Frame{Type: hwproto.TypeName, Name: "Nano"}, &app.Host)
	st.handle(hwproto.Frame{Type: hwproto.TypeName, Name: "Nano"}, &app.Host)
	if len(app.names) != 1 || app.names[0] != "Nano" {
		t.Fatalf("names %v", app.names)
	}
}

// TestUSBConnStateSeqJumpIsNotLoss: a SEQ step over half of the 8-bit range means a
// frame from behind (or a second stream), not 150+ lost frames. Counting it as loss
// made the loss card show 99% on a controller whose gyro was clean.
func TestUSBConnStateSeqJumpIsNotLoss(t *testing.T) {
	app := newTestHost(t)
	st := newConnState()
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 100}, &app.Host)
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 99}, &app.Host)  // one step back
	st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 100}, &app.Host) // and forward again
	if st.droppedFrames != 0 {
		t.Fatalf("a frame from behind counted as %d lost frames, want 0", st.droppedFrames)
	}
	if st.seqJumps != 1 {
		t.Fatalf("seqJumps = %d, want 1", st.seqJumps)
	}
}
