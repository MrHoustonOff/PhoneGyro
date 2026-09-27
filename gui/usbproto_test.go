package main

import (
	"testing"
	"time"
)

// TestUSBProtoSnapshot: the Live Debug protocol status reports what the device
// actually sent — version, ranges, repeat interval of the metadata, name, the
// reset-button capability, and the decoder's garbage/CRC counters.
func TestUSBProtoSnapshot(t *testing.T) {
	app := &App{profilesDir: t.TempDir()}
	app.bank("usb") // the name frame goes to the USB bank
	st := newUSBConnState()
	var dec usbFrameDecoder

	s := st.snapshot(time.Now(), "COM3", &dec, 0)
	if s.MetaSeen || s.Protocol != "" || s.GyroRangeDps != usbDefaultGyroRangeDps {
		t.Fatalf("before metadata: %+v", s)
	}

	meta := usbFrame{Type: usbTypeMeta, TimestampUs: 1<<16 | 1<<8, Buttons: 0x01}
	meta.Accel = [3]int16{2, 2000, 200}
	st.handle(meta, app)
	st.handle(usbFrame{Type: usbTypeName, Name: "Nano MPU-6050"}, app)
	st.handle(usbFrame{Type: usbTypeData, Seq: 0}, app)
	st.handle(usbFrame{Type: usbTypeData, Seq: 1, Buttons: 0x01}, app)
	st.lastMetaAt = st.lastMetaAt.Add(-time.Second) // the repeat comes a second later
	st.handle(meta, app)

	// A garbage byte, then a frame whose CRC fails.
	bad := make([]byte, usbFrameSize)
	bad[0], bad[1] = usbMagic0, usbMagic1
	bad[usbFrameSize-1] = usbCRC8(bad[:usbFrameSize-1]) ^ 0xFF
	dec.push(append([]byte{0x00}, bad...))

	s = st.snapshot(time.Now(), "COM3", &dec, 199.5)
	if !s.MetaSeen || s.Protocol != "1.1.0" || s.GyroRangeDps != 2000 || s.AccelRangeG != 2 || s.DeclaredHz != 200 {
		t.Fatalf("metadata not reported: %+v", s)
	}
	if s.MetaCount != 2 || s.MetaIntervalMs < 900 || s.MetaIntervalMs > 1100 {
		t.Fatalf("metadata repeat: count %d, interval %.0f ms", s.MetaCount, s.MetaIntervalMs)
	}
	if s.Name != "Nano MPU-6050" || !s.ResetButton || s.ResetPresses != 1 || s.Frames != 2 {
		t.Fatalf("name/button/frames: %+v", s)
	}
	// The leading byte plus the rest of the rejected frame, skipped while resyncing.
	if s.GarbageBytes < 1 || s.CRCRejects != 1 {
		t.Fatalf("decoder counters: garbage %d, crc %d", s.GarbageBytes, s.CRCRejects)
	}
}
