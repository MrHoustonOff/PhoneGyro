package server

import "testing"

func TestSourceDeltaUs(t *testing.T) {
	cases := []struct {
		name      string
		prev, cur uint64
		clock     uint8
		want      uint64
		ok        bool
	}{
		{"64: normal", 1_000_000, 1_016_667, ClockMicros64, 16_667, true},
		{"64: backwards (page reload)", 5_000_000, 1_000, ClockMicros64, 0, false},
		{"64: equal", 7, 7, ClockMicros64, 0, false},
		{"64: > 1 s", 0, 1_000_001, ClockMicros64, 1_000_001, false},
		{"64: exactly 1 s", 0, 1_000_000, ClockMicros64, 1_000_000, true},
		{"32: normal", 100, 5_100, ClockMicros32, 5_000, true},
		{"32: micros() wrap", 0xFFFF_FF00, 0x0000_1288, ClockMicros32, 0x1388, true},
		{"32: wrap, stored as uint64", uint64(0xFFFF_FFF0), uint64(0x10), ClockMicros32, 0x20, true},
		{"32: backwards = huge", 5_000, 4_000, ClockMicros32, uint64(uint32(4_000 - 5_000 + (1 << 32))), false},
		{"none", 1, 2, ClockNone, 0, false},
	}
	for _, c := range cases {
		d, ok := SourceDeltaUs(c.prev, c.cur, c.clock)
		if ok != c.ok || (c.ok && d != c.want) {
			t.Errorf("%s: got (%d, %v), want (%d, %v)", c.name, d, ok, c.want, c.ok)
		}
	}
}

func TestParseFrame50CarriesDeviceClock(t *testing.T) {
	s := &Server{}
	data := make([]byte, 50)
	data[0] = 0x39 // ts_us = 0x...39
	data[7] = 0x01 // high byte set: 64-bit value survives
	f, ok := s.parseFrame(2 /* websocket.BinaryMessage */, data)
	if !ok || f.SampleClock != ClockMicros64 || f.TimestampUs != 0x0100_0000_0000_0039 {
		t.Fatalf("50-byte frame: ok=%v clock=%d ts=%#x", ok, f.SampleClock, f.TimestampUs)
	}
	if f.HasEventCounters {
		t.Fatal("50-byte frame must not claim event counters")
	}
	withCounters := make([]byte, 58)
	withCounters[50], withCounters[51] = 0x10, 0x27 // events = 10000
	withCounters[54] = 7                            // dropped = 7
	fc, ok := s.parseFrame(2, withCounters)
	if !ok || !fc.HasEventCounters || fc.SensorEvents != 10000 || fc.SensorDropped != 7 || fc.SampleClock != ClockMicros64 {
		t.Fatalf("58-byte frame: ok=%v has=%v events=%d dropped=%d", ok, fc.HasEventCounters, fc.SensorEvents, fc.SensorDropped)
	}
	legacy, ok := s.parseFrame(2, make([]byte, 46))
	if !ok || legacy.SampleClock != ClockNone {
		t.Fatalf("46-byte frame must stay ClockNone, got %d", legacy.SampleClock)
	}
}
