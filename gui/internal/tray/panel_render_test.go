package tray

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"unsafe"
)

// TestRenderPanel paints the panel off-screen for several states. With
// TRAY_SHOT_DIR set it also writes PNGs there (composited on a desktop-like
// background) for a visual check.
func TestRenderPanel(t *testing.T) {
	dir := os.Getenv("TRAY_SHOT_DIR")
	live := Status{Lang: "ru", Theme: "dark", Accent: "green", Online: true, Device: "iPhone", Link: "Wi-Fi · LAN", Mode: "phone",
		Hz: 62, PingMs: 7, Emulators: 2, Profile: "Айфон вертикальный 3", Profiles: []string{"A", "B", "C"}, Slot: 2,
		CPU: 4, RAMMB: 45, RAMTotal: 16384, Version: "v2.0.0.116", DSUPort: 26760}
	offline := Status{Lang: "en", Theme: "light", Accent: "amber", Mode: "phone", Profile: "Profile 3", CPU: 1, RAMMB: 45, RAMTotal: 16384,
		Version: "v2.0.0.116", DSUPort: 26760, PingMs: -1}
	paused := live
	paused.Paused = true
	paused.Theme, paused.Accent = "dark", "violet"
	usb := live
	usb.Mode, usb.Link, usb.PingMs, usb.Lang, usb.Theme, usb.Accent = "usb", "USB", -1, "en", "light", "teal"

	cases := map[string]Status{"live_ru_dark": live, "offline_en_light": offline, "paused_dark": paused, "usb_light": usb}
	for name, st := range cases {
		for _, scale := range []float32{1, 1.5} {
			sess := startGdip()
			if sess == nil {
				t.Skip("GDI+ unavailable")
			}
			for _, f := range [][]byte{fontOnest, fontOnestSemi, fontAlegreya, fontMonoData, fontMonoSemiData} {
				sess.loadFont(f)
			}
			w := int(float32(panelW+2*shadowM) * scale)
			h := int(float32(panelH+2*shadowM) * scale)
			buf := make([]byte, w*h*4)
			cv := newCanvas(sess, unsafe.Pointer(&buf[0]), w, h, scale)
			m := &panelModel{st: st, pal: paletteFor(st.Theme, st.Accent)}
			for i := range m.hist {
				m.hist[i] = 55 + float32(i%7)*2
				m.cpuHist[i] = float32(i%5) + 1
			}
			m.paint(cv)
			if len(m.rects) != 4 {
				t.Errorf("%s: %d hit rects, want 4", name, len(m.rects))
			}
			opaque := 0
			for i := 3; i < len(buf); i += 4 {
				if buf[i] != 0 {
					opaque++
				}
			}
			if opaque < w*h/4 {
				t.Errorf("%s: panel mostly empty (%d of %d pixels drawn)", name, opaque, w*h)
			}
			if dir != "" {
				bg := color.NRGBA{0x20, 0x20, 0x20, 255}
				if st.Theme == "light" {
					bg = color.NRGBA{0xe6, 0xe6, 0xe6, 255}
				}
				img := image.NewNRGBA(image.Rect(0, 0, w, h))
				for i := 0; i < w*h; i++ {
					b, g, r, a := buf[i*4], buf[i*4+1], buf[i*4+2], buf[i*4+3]
					// premultiplied over the background
					inv := 255 - uint32(a)
					img.Pix[i*4] = uint8(uint32(r) + uint32(bg.R)*inv/255)
					img.Pix[i*4+1] = uint8(uint32(g) + uint32(bg.G)*inv/255)
					img.Pix[i*4+2] = uint8(uint32(b) + uint32(bg.B)*inv/255)
					img.Pix[i*4+3] = 255
				}
				suffix := ""
				if scale != 1 {
					suffix = "_x1.5"
				}
				f, _ := os.Create(filepath.Join(dir, name+suffix+".png"))
				_ = png.Encode(f, img)
				f.Close()
			}
			cv.close()
			sess.close()
		}
	}
}
