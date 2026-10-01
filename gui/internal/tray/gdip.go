package tray

import (
	"math"
	"syscall"
	"unsafe"
)

// A thin GDI+ layer (gdiplus.dll flat API) for the owner-drawn menu (menu.go):
// anti-aliased shapes and text drawn straight into the menu's device context.
// Started when the menu opens and shut down when it closes, so nothing stays
// resident between clicks.
//
// Float arguments are passed as raw bits in uintptr: Go's syscall layer copies
// the first four argument registers into XMM0-3 too (Windows x64), and the
// rest go through the stack as 4-byte values.

var (
	gdiplus = syscall.NewLazyDLL("gdiplus.dll")

	pGdiplusStartup               = gdiplus.NewProc("GdiplusStartup")
	pGdiplusShutdown              = gdiplus.NewProc("GdiplusShutdown")
	pGdipCreateFromHDC            = gdiplus.NewProc("GdipCreateFromHDC")
	pGdipDeleteGraphics           = gdiplus.NewProc("GdipDeleteGraphics")
	pGdipSetSmoothingMode         = gdiplus.NewProc("GdipSetSmoothingMode")
	pGdipSetTextRenderingHint     = gdiplus.NewProc("GdipSetTextRenderingHint")
	pGdipSetPixelOffsetMode       = gdiplus.NewProc("GdipSetPixelOffsetMode")
	pGdipCreateSolidFill          = gdiplus.NewProc("GdipCreateSolidFill")
	pGdipDeleteBrush              = gdiplus.NewProc("GdipDeleteBrush")
	pGdipCreatePen1               = gdiplus.NewProc("GdipCreatePen1")
	pGdipDeletePen                = gdiplus.NewProc("GdipDeletePen")
	pGdipSetPenStartCap           = gdiplus.NewProc("GdipSetPenStartCap")
	pGdipSetPenEndCap             = gdiplus.NewProc("GdipSetPenEndCap")
	pGdipSetPenLineJoin           = gdiplus.NewProc("GdipSetPenLineJoin")
	pGdipCreatePath               = gdiplus.NewProc("GdipCreatePath")
	pGdipDeletePath               = gdiplus.NewProc("GdipDeletePath")
	pGdipAddPathArc               = gdiplus.NewProc("GdipAddPathArc")
	pGdipAddPathLine              = gdiplus.NewProc("GdipAddPathLine")
	pGdipClosePathFigure          = gdiplus.NewProc("GdipClosePathFigure")
	pGdipFillPath                 = gdiplus.NewProc("GdipFillPath")
	pGdipDrawPath                 = gdiplus.NewProc("GdipDrawPath")
	pGdipFillEllipse              = gdiplus.NewProc("GdipFillEllipse")
	pGdipDrawLine                 = gdiplus.NewProc("GdipDrawLine")
	pGdipFillRectangle            = gdiplus.NewProc("GdipFillRectangle")
	pGdipCreateFontFamilyFromName = gdiplus.NewProc("GdipCreateFontFamilyFromName")
	pGdipDeleteFontFamily         = gdiplus.NewProc("GdipDeleteFontFamily")
	pGdipCreateFont               = gdiplus.NewProc("GdipCreateFont")
	pGdipDeleteFont               = gdiplus.NewProc("GdipDeleteFont")
	pGdipCreateStringFormat       = gdiplus.NewProc("GdipCreateStringFormat")
	pGdipDeleteStringFormat       = gdiplus.NewProc("GdipDeleteStringFormat")
	pGdipSetStringFormatAlign     = gdiplus.NewProc("GdipSetStringFormatAlign")
	pGdipSetStringFormatLineAlign = gdiplus.NewProc("GdipSetStringFormatLineAlign")
	pGdipSetStringFormatTrimming  = gdiplus.NewProc("GdipSetStringFormatTrimming")
	pGdipDrawString               = gdiplus.NewProc("GdipDrawString")
	pGdipMeasureString            = gdiplus.NewProc("GdipMeasureString")
)

type gdipStartupInput struct {
	version                uint32
	debugCallback          uintptr
	suppressBackgroundThrd int32
	suppressCodecs         int32
}

type rectF struct{ x, y, w, h float32 }

func fl(v float32) uintptr { return uintptr(math.Float32bits(v)) }

// argb packs a colour (straight alpha).
func argb(r, g, b, a uint8) uint32 { return uint32(a)<<24 | uint32(r)<<16 | uint32(g)<<8 | uint32(b) }

// withAlpha returns c with its alpha scaled by k (0..1).
func withAlpha(c uint32, k float32) uint32 {
	a := float32(c>>24) * k
	if a > 255 {
		a = 255
	}
	return uint32(a)<<24 | c&0x00ffffff
}

// blend mixes a towards b by k (0..1), opaque result.
func blend(a, b uint32, k float32) uint32 {
	mix := func(sh uint) uint32 {
		return uint32(float32(a>>sh&0xff)*(1-k) + float32(b>>sh&0xff)*k)
	}
	return 0xff<<24 | mix(16)<<16 | mix(8)<<8 | mix(0)
}

type fontKey struct {
	name  string
	px    float32
	style int32
}

// session is one GDI+ startup with its font cache.
type session struct {
	token uintptr
	fams  map[string]uintptr
	fonts map[fontKey]uintptr
}

func startGdip() *session {
	var tok uintptr
	in := gdipStartupInput{version: 1}
	if r, _, _ := pGdiplusStartup.Call(uintptr(unsafe.Pointer(&tok)), uintptr(unsafe.Pointer(&in)), 0); r != 0 {
		return nil
	}
	return &session{token: tok, fams: map[string]uintptr{}, fonts: map[fontKey]uintptr{}}
}

// family is an installed font family (0 if the system has none by that name).
func (s *session) family(name string) uintptr {
	if f, ok := s.fams[name]; ok {
		return f
	}
	var fam uintptr
	n, _ := syscall.UTF16PtrFromString(name)
	if r, _, _ := pGdipCreateFontFamilyFromName.Call(uintptr(unsafe.Pointer(n)), 0, uintptr(unsafe.Pointer(&fam))); r != 0 {
		fam = 0
	}
	s.fams[name] = fam
	return fam
}

// pick returns the first installed family of the names.
func (s *session) pick(names ...string) string {
	for _, n := range names {
		if s.family(n) != 0 {
			return n
		}
	}
	return names[len(names)-1]
}

func (s *session) close() {
	for _, f := range s.fonts {
		if f != 0 {
			pGdipDeleteFont.Call(f)
		}
	}
	for _, f := range s.fams {
		if f != 0 {
			pGdipDeleteFontFamily.Call(f)
		}
	}
	pGdiplusShutdown.Call(s.token)
}

const (
	styleRegular = 0
	styleBold    = 1
)

// canvas draws into a device context; sizes are logical px times scale.
type canvas struct {
	s     *session
	g, sf uintptr
	scale float32
}

func (s *session) canvasForDC(hdc uintptr, scale float32) *canvas {
	c := &canvas{s: s, scale: scale}
	pGdipCreateFromHDC.Call(hdc, uintptr(unsafe.Pointer(&c.g)))
	pGdipSetSmoothingMode.Call(c.g, 4)
	pGdipSetTextRenderingHint.Call(c.g, 5) // ClearType: the menu background is opaque
	pGdipSetPixelOffsetMode.Call(c.g, 4)
	pGdipCreateStringFormat.Call(0x00001000|0x0800, 0, uintptr(unsafe.Pointer(&c.sf))) // NoWrap | MeasureTrailingSpaces
	pGdipSetStringFormatLineAlign.Call(c.sf, 1)
	return c
}

func (c *canvas) close() {
	pGdipDeleteStringFormat.Call(c.sf)
	pGdipDeleteGraphics.Call(c.g)
}

func (c *canvas) font(name string, px float32, style int32) uintptr {
	k := fontKey{name, px * c.scale, style}
	if f, ok := c.s.fonts[k]; ok {
		return f
	}
	var f uintptr
	if fam := c.s.family(name); fam != 0 {
		pGdipCreateFont.Call(fam, fl(px*c.scale), uintptr(style), 2, uintptr(unsafe.Pointer(&f)))
	}
	c.s.fonts[k] = f
	return f
}

func (c *canvas) brush(col uint32) uintptr {
	var b uintptr
	pGdipCreateSolidFill.Call(uintptr(col), uintptr(unsafe.Pointer(&b)))
	return b
}

func (c *canvas) pen(col uint32, w float32) uintptr {
	var p uintptr
	pGdipCreatePen1.Call(uintptr(col), fl(w*c.scale), 2, uintptr(unsafe.Pointer(&p)))
	pGdipSetPenStartCap.Call(p, 2)
	pGdipSetPenEndCap.Call(p, 2)
	pGdipSetPenLineJoin.Call(p, 2)
	return p
}

func (c *canvas) fillRect(x, y, w, h float32, col uint32) {
	s := c.scale
	b := c.brush(col)
	pGdipFillRectangle.Call(c.g, b, fl(x*s), fl(y*s), fl(w*s), fl(h*s))
	pGdipDeleteBrush.Call(b)
}

func (c *canvas) rrectPath(x, y, w, h, r float32) uintptr {
	s := c.scale
	x, y, w, h, r = x*s, y*s, w*s, h*s, r*s
	if r*2 > h {
		r = h / 2
	}
	if r*2 > w {
		r = w / 2
	}
	var p uintptr
	pGdipCreatePath.Call(0, uintptr(unsafe.Pointer(&p)))
	if r <= 0.5 {
		pGdipAddPathLine.Call(p, fl(x), fl(y), fl(x+w), fl(y))
		pGdipAddPathLine.Call(p, fl(x+w), fl(y), fl(x+w), fl(y+h))
		pGdipAddPathLine.Call(p, fl(x+w), fl(y+h), fl(x), fl(y+h))
	} else {
		d := r * 2
		pGdipAddPathArc.Call(p, fl(x), fl(y), fl(d), fl(d), fl(180), fl(90))
		pGdipAddPathArc.Call(p, fl(x+w-d), fl(y), fl(d), fl(d), fl(270), fl(90))
		pGdipAddPathArc.Call(p, fl(x+w-d), fl(y+h-d), fl(d), fl(d), fl(0), fl(90))
		pGdipAddPathArc.Call(p, fl(x), fl(y+h-d), fl(d), fl(d), fl(90), fl(90))
	}
	pGdipClosePathFigure.Call(p)
	return p
}

func (c *canvas) fillRRect(x, y, w, h, r float32, col uint32) {
	if col>>24 == 0 {
		return
	}
	p := c.rrectPath(x, y, w, h, r)
	b := c.brush(col)
	pGdipFillPath.Call(c.g, b, p)
	pGdipDeleteBrush.Call(b)
	pGdipDeletePath.Call(p)
}

func (c *canvas) fillEllipse(x, y, w, h float32, col uint32) {
	s := c.scale
	b := c.brush(col)
	pGdipFillEllipse.Call(c.g, b, fl(x*s), fl(y*s), fl(w*s), fl(h*s))
	pGdipDeleteBrush.Call(b)
}

func (c *canvas) line(x1, y1, x2, y2, width float32, col uint32) {
	s := c.scale
	pn := c.pen(col, width)
	pGdipDrawLine.Call(c.g, pn, fl(x1*s), fl(y1*s), fl(x2*s), fl(y2*s))
	pGdipDeletePen.Call(pn)
}

type align int

const (
	alignLeft align = iota
	alignCenter
	alignRight
)

// text draws one line inside the box (x,y,w,h), vertically centred.
func (c *canvas) text(s string, font string, px float32, style int32, col uint32, x, y, w, h float32, al align, ellipsis bool) {
	f := c.font(font, px, style)
	if f == 0 || s == "" {
		return
	}
	u, _ := syscall.UTF16FromString(s)
	b := c.brush(col)
	pGdipSetStringFormatAlign.Call(c.sf, uintptr(al))
	trim := uintptr(0)
	if ellipsis {
		trim = 3
	}
	pGdipSetStringFormatTrimming.Call(c.sf, trim)
	sc := c.scale
	r := rectF{x * sc, y * sc, w * sc, h * sc}
	pGdipDrawString.Call(c.g, uintptr(unsafe.Pointer(&u[0])), uintptr(len(u)-1), f, uintptr(unsafe.Pointer(&r)), c.sf, b)
	pGdipDeleteBrush.Call(b)
}

// measure is the width of s in logical px.
func (c *canvas) measure(s string, font string, px float32, style int32) float32 {
	f := c.font(font, px, style)
	if f == 0 || s == "" {
		return 0
	}
	u, _ := syscall.UTF16FromString(s)
	pGdipSetStringFormatAlign.Call(c.sf, 0)
	pGdipSetStringFormatTrimming.Call(c.sf, 0)
	lay := rectF{0, 0, 4000, 200}
	var bounds rectF
	var cp, ln int32
	pGdipMeasureString.Call(c.g, uintptr(unsafe.Pointer(&u[0])), uintptr(len(u)-1), f, uintptr(unsafe.Pointer(&lay)), c.sf,
		uintptr(unsafe.Pointer(&bounds)), uintptr(unsafe.Pointer(&cp)), uintptr(unsafe.Pointer(&ln)))
	return bounds.w / c.scale
}
