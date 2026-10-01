package tray

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"unsafe"
)

// TestRenderMenu draws the owner-drawn items off-screen. With TRAY_SHOT_DIR set
// it writes PNGs for a visual check.
func TestRenderMenu(t *testing.T) {
	dir := os.Getenv("TRAY_SHOT_DIR")
	live := Status{Lang: "ru", Theme: "dark", Accent: "green", Online: true, Device: "iPhone", Hz: 62, PingMs: 7, Profile: "Айфон вертикальный 3",
		Emulators: 2, Clients: []Client{{"Cemu", true}, {"PadTest", true}, {"192.168.0.5:51234", false}}}
	off := Status{Lang: "en", Theme: "light", Accent: "amber", PingMs: -1, Profile: "Profile 3"}
	paused := live
	paused.Paused, paused.Theme, paused.Accent, paused.Lang = true, "dark", "violet", "en"
	gdi := syscall.NewLazyDLL("gdi32.dll")
	pDIB, pDC, pSel := gdi.NewProc("CreateDIBSection"), gdi.NewProc("CreateCompatibleDC"), gdi.NewProc("SelectObject")

	for name, st := range map[string]Status{"live": live, "offline": off, "paused": paused} {
		for _, scale := range []float32{1, 1.5} {
			tm := &Manager{}
			sess := startGdip()
			if sess == nil {
				t.Skip("GDI+ unavailable")
			}
			tm.menuGdip, tm.menuScale, tm.menuBg = sess, scale, 0
			tm.menuPal = paletteFor(st.Theme, st.Accent)
			items := buildItems(st, true)
			var flat []*menuItem
			for _, it := range items {
				flat = append(flat, it)
				flat = append(flat, it.children...)
			}
			tm.menu = flat
			// two columns: the menu, then the submenu
			var heights [2]float32
			var col []int
			for i, it := range flat {
				_, h := it.size()
				c := 0
				if it.kind == kindClient {
					c = 1
				}
				heights[c] += h + 2
				col = append(col, c)
				_ = i
			}
			W := int((268 + 20 + 256) * scale)
			H := int(max32f(heights[0], heights[1]) * scale)
			bgc := uint32(0xf0f0f0) // a classic light frame: the items must not depend on it
			if st.Theme == "light" {
				bgc = 0xf9f9f9
			}
			bi := bitmapInfoHeaderT{width: int32(W), height: -int32(H), planes: 1, bitCount: 32}
			bi.size = uint32(unsafe.Sizeof(bi))
			hdc, _, _ := pDC.Call(0)
			var bits unsafe.Pointer
			hbm, _, _ := pDIB.Call(hdc, uintptr(unsafe.Pointer(&bi)), 0, uintptr(unsafe.Pointer(&bits)), 0, 0)
			pSel.Call(hdc, hbm)
			px := unsafe.Slice((*uint32)(bits), W*H)
			for i := range px {
				px[i] = bgc
			}
			y := [2]float32{}
			for i := range flat {
				c := col[i]
				ms := measureItemStruct{ctlType: odtMenu, itemData: uintptr(i + 1)}
				tm.measureItem(uintptr(unsafe.Pointer(&ms)))
				x := int32(0)
				if c == 1 {
					x = int32(288 * scale)
				}
				top := int32(y[c] * scale)
				state := uint32(0)
				if i == 3 || i == 2 { // pretend the open row / DSU row is hovered
					state = odsSelected
				}
				ds := drawItemStruct{ctlType: odtMenu, itemState: state, hdc: hdc, itemData: uintptr(i + 1),
					rc: rectI{x, top, x + int32(ms.itemWidth), top + int32(ms.itemHeight)}}
				if !tm.drawItem(uintptr(unsafe.Pointer(&ds))) {
					t.Fatalf("%s: item %d not drawn", name, i)
				}
				y[c] += float32(ms.itemHeight)/scale + 2
			}
			if dir != "" {
				img := image.NewNRGBA(image.Rect(0, 0, W, H))
				for i, v := range px {
					img.Set(i%W, i/W, color.NRGBA{uint8(v >> 16), uint8(v >> 8), uint8(v), 255})
				}
				suffix := ""
				if scale != 1 {
					suffix = "_x1.5"
				}
				f, _ := os.Create(filepath.Join(dir, "menu_"+name+suffix+".png"))
				_ = png.Encode(f, img)
				f.Close()
			}
			sess.close()
		}
	}
}

type bitmapInfoHeaderT struct {
	size          uint32
	width, height int32
	planes        uint16
	bitCount      uint16
	compression   uint32
	sizeImage     uint32
	xppm, yppm    int32
	clrUsed       uint32
	clrImportant  uint32
}

func max32f(a, b float32) float32 {
	if a > b {
		return a
	}
	return b
}
