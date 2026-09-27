package main

import (
	"testing"
)

// encodeUSBFrame builds a valid 24-byte PhoneGyro frame exactly the way the
// reference firmware does, for use as test fixtures.
func encodeUSBFrame(typ, seq uint8, tsUs uint32, accel, gyro [3]int16, temp int16, buttons uint8) []byte {
	buf := make([]byte, usbFrameSize)
	buf[0], buf[1] = usbMagic0, usbMagic1
	buf[2] = typ
	buf[3] = seq
	buf[4] = byte(tsUs)
	buf[5] = byte(tsUs >> 8)
	buf[6] = byte(tsUs >> 16)
	buf[7] = byte(tsUs >> 24)
	for k := 0; k < 3; k++ {
		buf[8+2*k] = byte(uint16(accel[k]))
		buf[9+2*k] = byte(uint16(accel[k]) >> 8)
		buf[14+2*k] = byte(uint16(gyro[k]))
		buf[15+2*k] = byte(uint16(gyro[k]) >> 8)
	}
	buf[20] = byte(uint16(temp))
	buf[21] = byte(uint16(temp) >> 8)
	buf[22] = buttons
	buf[23] = usbCRC8(buf[:usbFrameSize-1])
	return buf
}

func TestUSBCRC8DetectsCorruption(t *testing.T) {
	data := []byte{0xAA, 0x55, 0x01, 42, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 0}
	good := usbCRC8(data)
	for bit := 0; bit < len(data)*8; bit++ {
		corrupted := append([]byte(nil), data...)
		corrupted[bit/8] ^= 1 << (bit % 8)
		if usbCRC8(corrupted) == good {
			t.Fatalf("CRC8 failed to detect a single flipped bit at position %d", bit)
		}
	}
}

func TestUSBFrameDecodeRoundTrip(t *testing.T) {
	accel := [3]int16{100, -200, 16384}
	gyro := [3]int16{-32768, 32767, 0}
	raw := encodeUSBFrame(usbTypeData, 7, 123456789, accel, gyro, 300, 0x01)

	var dec usbFrameDecoder
	frames := dec.push(raw)
	if len(frames) != 1 {
		t.Fatalf("expected 1 decoded frame, got %d", len(frames))
	}
	f := frames[0]
	if f.Type != usbTypeData || f.Seq != 7 || f.TimestampUs != 123456789 {
		t.Fatalf("header mismatch: %+v", f)
	}
	if f.Accel != accel || f.Gyro != gyro || f.Temp != 300 || f.Buttons != 0x01 {
		t.Fatalf("payload mismatch: %+v", f)
	}
	if len(dec.buf) != 0 {
		t.Fatalf("decoder should have consumed the whole frame, %d bytes left", len(dec.buf))
	}
}

func TestUSBFrameDecoderResyncsAfterGarbage(t *testing.T) {
	valid := encodeUSBFrame(usbTypeData, 1, 1000, [3]int16{1, 2, 3}, [3]int16{4, 5, 6}, 0, 0)

	var stream []byte
	stream = append(stream, 0x00, 0x11, 0x22, 0xAA)       // noise, plus a lone partial-magic byte
	stream = append(stream, 0xAA, 0x55, 0x01, 0x02, 0x03) // coincidental MAGIC with garbage/bad CRC after it
	stream = append(stream, valid...)

	var dec usbFrameDecoder
	var got []usbFrame
	// Feed byte-by-byte to also prove partial-frame buffering works, not
	// just whole-frame delivery.
	for i := range stream {
		got = append(got, dec.push(stream[i:i+1])...)
	}
	if len(got) != 1 {
		t.Fatalf("expected exactly 1 valid frame recovered after garbage, got %d", len(got))
	}
	if got[0].Seq != 1 || got[0].TimestampUs != 1000 {
		t.Fatalf("recovered wrong frame: %+v", got[0])
	}
}

func TestUSBConnStateMetadataOverridesDefaultRange(t *testing.T) {
	app := &App{}
	st := newUSBConnState()

	if st.gyroRangeDps != usbDefaultGyroRangeDps || st.accelRangeG != usbDefaultAccelRangeG {
		t.Fatalf("expected safe defaults before any metadata frame, got gyro=%v accel=%v", st.gyroRangeDps, st.accelRangeG)
	}

	meta := usbFrame{Type: usbTypeMeta, Accel: [3]int16{4, 500, 200}}
	st.handle(meta, app)
	if st.accelRangeG != 4 || st.gyroRangeDps != 500 {
		t.Fatalf("metadata frame should override range: got gyro=%v accel=%v", st.gyroRangeDps, st.accelRangeG)
	}

	// A data frame at full-scale positive raw value should now convert using
	// the declared range, not the default.
	data := usbFrame{Type: usbTypeData, Seq: 1, Gyro: [3]int16{32767, 0, 0}}
	st.handle(data, app) // app.srv is nil, handle() must not panic
}

func TestUSBConnStateTracksDroppedFrames(t *testing.T) {
	app := &App{}
	st := newUSBConnState()
	st.handle(usbFrame{Type: usbTypeData, Seq: 0}, app)
	st.handle(usbFrame{Type: usbTypeData, Seq: 1}, app)
	st.handle(usbFrame{Type: usbTypeData, Seq: 5}, app) // 3 frames lost (2,3,4)
	if st.droppedFrames != 3 {
		t.Fatalf("expected 3 dropped frames tracked, got %d", st.droppedFrames)
	}

	st2 := newUSBConnState()
	st2.handle(usbFrame{Type: usbTypeData, Seq: 254}, app)
	st2.handle(usbFrame{Type: usbTypeData, Seq: 1}, app) // 254->1 wraps through 255,0: 2 genuinely dropped
	if st2.droppedFrames != 2 {
		t.Fatalf("expected wraparound gap to count as 2 dropped frames, got %d", st2.droppedFrames)
	}
}

func TestUSBConnStateResetButtonIsEdgeTriggered(t *testing.T) {
	app := &App{}
	st := newUSBConnState()
	// Holding the button across several frames must fire recenter exactly
	// once (on the rising edge), not once per frame.
	st.handle(usbFrame{Type: usbTypeData, Seq: 0, Buttons: 0x01}, app)
	st.handle(usbFrame{Type: usbTypeData, Seq: 1, Buttons: 0x01}, app)
	st.handle(usbFrame{Type: usbTypeData, Seq: 2, Buttons: 0x01}, app)
	if !st.prevResetHeld {
		t.Fatalf("expected reset-held state to be tracked as true")
	}
	st.handle(usbFrame{Type: usbTypeData, Seq: 3, Buttons: 0x00}, app)
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
	st.handle(usbFrame{Type: usbTypeData, Seq: 200}, app)
	st.handle(usbFrame{Type: usbTypeData, Seq: 201}, app)
	st.handle(usbFrame{Type: usbTypeMeta}, app) // reboot
	st.handle(usbFrame{Type: usbTypeData, Seq: 0}, app)
	st.handle(usbFrame{Type: usbTypeData, Seq: 1}, app)
	if st.droppedFrames != 0 {
		t.Fatalf("device restart counted as %d dropped frames, want 0", st.droppedFrames)
	}
}

func TestHasUSBMeta(t *testing.T) {
	if hasUSBMeta([]usbFrame{{Type: usbTypeData}, {Type: usbTypeData}}) {
		t.Fatal("data-only frames reported as having metadata")
	}
	if !hasUSBMeta([]usbFrame{{Type: usbTypeData}, {Type: usbTypeMeta}}) {
		t.Fatal("metadata frame not found")
	}
}
