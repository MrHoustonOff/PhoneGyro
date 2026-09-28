package hwproto

import "testing"

// encodeFrame builds a valid 24-byte PhoneGyro frame exactly the way the
// reference firmware does, for use as test fixtures.
func encodeFrame(typ, seq uint8, tsUs uint32, accel, gyro [3]int16, temp int16, buttons uint8) []byte {
	buf := make([]byte, FrameSize)
	buf[0], buf[1] = Magic0, Magic1
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
	buf[23] = CRC8(buf[:FrameSize-1])
	return buf
}

func TestUSBCRC8DetectsCorruption(t *testing.T) {
	data := []byte{0xAA, 0x55, 0x01, 42, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 0}
	good := CRC8(data)
	for bit := 0; bit < len(data)*8; bit++ {
		corrupted := append([]byte(nil), data...)
		corrupted[bit/8] ^= 1 << (bit % 8)
		if CRC8(corrupted) == good {
			t.Fatalf("CRC8 failed to detect a single flipped bit at position %d", bit)
		}
	}
}

func TestUSBFrameDecodeRoundTrip(t *testing.T) {
	accel := [3]int16{100, -200, 16384}
	gyro := [3]int16{-32768, 32767, 0}
	raw := encodeFrame(TypeData, 7, 123456789, accel, gyro, 300, 0x01)

	var dec Decoder
	frames := dec.Push(raw)
	if len(frames) != 1 {
		t.Fatalf("expected 1 decoded frame, got %d", len(frames))
	}
	f := frames[0]
	if f.Type != TypeData || f.Seq != 7 || f.TimestampUs != 123456789 {
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
	valid := encodeFrame(TypeData, 1, 1000, [3]int16{1, 2, 3}, [3]int16{4, 5, 6}, 0, 0)

	var stream []byte
	stream = append(stream, 0x00, 0x11, 0x22, 0xAA)       // noise, plus a lone partial-magic byte
	stream = append(stream, 0xAA, 0x55, 0x01, 0x02, 0x03) // coincidental MAGIC with garbage/bad CRC after it
	stream = append(stream, valid...)

	var dec Decoder
	var got []Frame
	// Feed byte-by-byte to also prove partial-frame buffering works, not
	// just whole-frame delivery.
	for i := range stream {
		got = append(got, dec.Push(stream[i:i+1])...)
	}
	if len(got) != 1 {
		t.Fatalf("expected exactly 1 valid frame recovered after garbage, got %d", len(got))
	}
	if got[0].Seq != 1 || got[0].TimestampUs != 1000 {
		t.Fatalf("recovered wrong frame: %+v", got[0])
	}
}
