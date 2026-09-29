// Package hwproto is the wire format of the PhoneGyro Hardware Protocol
// (https://github.com/MrHoustonOff/PhoneGyro_hardware_protocol): the 24-byte
// frame, its CRC-8/SMBUS and a streaming decoder that resynchronizes after
// garbage. It knows nothing about serial ports or the app; internal/usbdev is
// the host that finds the device and feeds its frames into the pipeline.
package hwproto

import "bytes"

// Wire format of the protocol (Level 1-3).
const (
	FrameSize = 24
	Magic0    = 0xAA
	Magic1    = 0x55
	TypeMeta  = 0x00
	TypeData  = 0x01
	TypeName  = 0x02 // optional device name frame (see PhoneGyro_hardware_protocol docs/PROTOCOL.md)
	BaudRate  = 115200
)

// Frame is one decoded 24-byte PhoneGyro frame, still in raw register units.
type Frame struct {
	Type        uint8
	Seq         uint8
	TimestampUs uint32
	Accel       [3]int16
	Gyro        [3]int16
	Temp        int16
	Buttons     uint8
	Name        string // only set when Type == usbTypeName
}

// CRC8 is CRC-8/SMBUS: poly 0x07, init 0x00, no reflect, no final xor —
// the exact variant the protocol and reference firmware use.
func CRC8(data []byte) byte {
	var crc byte
	for _, b := range data {
		crc ^= b
		for i := 0; i < 8; i++ {
			if crc&0x80 != 0 {
				crc = (crc << 1) ^ 0x07
			} else {
				crc <<= 1
			}
		}
	}
	return crc
}

// Decoder is a streaming, resynchronizing decoder: feed it arbitrary
// chunks of bytes as they arrive off the wire, get back however many whole,
// CRC-valid frames were found. On any corruption it drops one byte at a time
// until MAGIC lines up again (protocol Level 2/Level 5), so a single glitch
// never requires tearing down the connection.
type Decoder struct {
	buf []byte

	garbage    uint64 // bytes skipped to find MAGIC again
	crcRejects uint64 // MAGIC found but the CRC failed (corrupt frame or a coincidence)
}

// ResumeDecoder returns a decoder that continues from bytes another decoder
// left unconsumed (Pending), e.g. after the port probe read the first frames.
func ResumeDecoder(pending []byte) Decoder { return Decoder{buf: pending} }

// Pending returns the bytes received but not yet decoded (an incomplete frame).
func (d *Decoder) Pending() []byte { return d.buf }

// Garbage returns how many bytes were skipped to find MAGIC again.
func (d *Decoder) Garbage() uint64 { return d.garbage }

// CRCRejects returns how many frames had MAGIC but failed the CRC.
func (d *Decoder) CRCRejects() uint64 { return d.crcRejects }

func (d *Decoder) Push(data []byte) []Frame {
	d.buf = append(d.buf, data...)
	var out []Frame
	for {
		f, consumed, ok := decodeOne(d.buf)
		if consumed == 0 {
			break // not enough bytes yet; wait for more
		}
		d.buf = d.buf[consumed:]
		if ok {
			out = append(out, f)
		} else if consumed == 1 {
			d.garbage++
		} else {
			d.crcRejects++
		}
	}
	return out
}

func decodeOne(buf []byte) (Frame, int, bool) {
	if len(buf) < 2 {
		return Frame{}, 0, false
	}
	if buf[0] != Magic0 || buf[1] != Magic1 {
		return Frame{}, 1, false // resync: drop one byte and look again
	}
	if len(buf) < FrameSize {
		return Frame{}, 0, false // wait for the rest of the frame
	}
	frame := buf[:FrameSize]
	if CRC8(frame[:FrameSize-1]) != frame[FrameSize-1] {
		return Frame{}, 2, false // coincidental MAGIC match, not a real frame
	}
	var f Frame
	f.Type = frame[2]
	f.Seq = frame[3]
	if f.Type == TypeName {
		// Bytes 4..22 (19 bytes) are an ASCII name, zero-padded -- read up to
		// the first 0x00, or all 19 bytes if there is none.
		name := frame[4:23]
		if i := bytes.IndexByte(name, 0); i >= 0 {
			name = name[:i]
		}
		f.Name = string(name)
		return f, FrameSize, true
	}
	f.TimestampUs = uint32(frame[4]) | uint32(frame[5])<<8 | uint32(frame[6])<<16 | uint32(frame[7])<<24
	for k := 0; k < 3; k++ {
		f.Accel[k] = int16(uint16(frame[8+2*k]) | uint16(frame[9+2*k])<<8)
		f.Gyro[k] = int16(uint16(frame[14+2*k]) | uint16(frame[15+2*k])<<8)
	}
	f.Temp = int16(uint16(frame[20]) | uint16(frame[21])<<8)
	f.Buttons = frame[22]
	return f, FrameSize, true
}
