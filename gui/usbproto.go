package main

import (
	"fmt"
	"time"
)

// usbProtoStatus is what the connected USB device actually shows on each level of
// the PhoneGyro hardware protocol, for the "USB protocol" section of Live Debug.
// It is observed on the wire, never assumed: a field stays empty until the
// device has sent what it describes.
type usbProtoStatus struct {
	Type      string `json:"type"` // always "usb_proto"
	Connected bool   `json:"connected"`

	// Level 1 — transport.
	Port string `json:"port,omitempty"`
	Baud int    `json:"baud,omitempty"`

	// Level 2 — frames.
	RateHz       float64 `json:"rate_hz"`
	Frames       uint64  `json:"frames"`
	Lost         uint64  `json:"lost"`
	CRCRejects   uint64  `json:"crc_rejects"`
	GarbageBytes uint64  `json:"garbage_bytes"`

	// Level 3 — metadata (and the optional name frame).
	MetaSeen       bool    `json:"meta_seen"`
	Protocol       string  `json:"protocol,omitempty"` // "1.1.0"
	GyroRangeDps   float64 `json:"gyro_range_dps"`
	AccelRangeG    float64 `json:"accel_range_g"`
	DeclaredHz     int     `json:"declared_hz"`
	MetaCount      uint64  `json:"meta_count"`
	MetaIntervalMs float64 `json:"meta_interval_ms"` // 0 until metadata has repeated
	MetaAgeMs      float64 `json:"meta_age_ms"`
	Name           string  `json:"name,omitempty"`

	// Level 5 — reset button.
	ResetButton  bool   `json:"reset_button"`
	ResetPresses uint64 `json:"reset_presses"`
}

const usbProtoEvery = time.Second

// protocolVersionString unpacks the metadata TIMESTAMP_US field
// (major << 16 | minor << 8 | patch).
func protocolVersionString(v uint32) string {
	return fmt.Sprintf("%d.%d.%d", v>>16&0xFF, v>>8&0xFF, v&0xFF)
}

// snapshot builds the status from the connection state and the decoder's
// counters. rateHz is measured by the caller over its reporting interval.
func (st *usbConnState) snapshot(now time.Time, port string, dec *usbFrameDecoder, rateHz float64) usbProtoStatus {
	s := usbProtoStatus{
		Type:         "usb_proto",
		Connected:    true,
		Port:         port,
		Baud:         usbBaudRate,
		RateHz:       rateHz,
		Frames:       st.dataFrames,
		Lost:         st.droppedFrames,
		CRCRejects:   dec.crcRejects,
		GarbageBytes: dec.garbage,
		MetaSeen:     st.metaCount > 0,
		GyroRangeDps: st.gyroRangeDps,
		AccelRangeG:  st.accelRangeG,
		DeclaredHz:   int(st.declaredHz),
		MetaCount:    st.metaCount,
		Name:         st.lastReportedName,
		ResetButton:  st.caps&0x01 != 0,
		ResetPresses: st.resetPresses,
	}
	if s.MetaSeen {
		s.Protocol = protocolVersionString(st.protoVersion)
		s.MetaAgeMs = float64(now.Sub(st.lastMetaAt).Microseconds()) / 1000
		s.MetaIntervalMs = float64(st.metaInterval.Microseconds()) / 1000
	}
	return s
}
