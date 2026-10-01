package tray

import (
	"math"
	"syscall"
	"unsafe"
)

// A thin GDI+ layer (gdiplus.dll flat API) for the panel (panel.go): anti-aliased
// shapes and text into a 32-bit premultiplied bitmap. Loaded when the panel opens
// and shut down when it closes, so nothing stays resident between clicks.
//
// Float arguments are passed as raw bits in uintptr: Go's syscall layer copies
// the first four argument registers into XMM0-3 too (Windows x64), and the
// rest go through the stack as 4-byte values.

var (
	gdiplus = syscall.NewLazyDLL("gdiplus.dll")

	pGdiplusStartup                 = gdiplus.NewProc("GdiplusStartup")
	pGdiplusShutdown                = gdiplus.NewProc("GdiplusShutdown")
	pGdipCreateBitmapFromScan0      = gdiplus.NewProc("GdipCreateBitmapFromScan0")
	pGdipGetImageGraphicsContext    = gdiplus.NewProc("GdipGetImageGraphicsContext")
	pGdipDeleteGraphics             = gdiplus.NewProc("GdipDeleteGraphics")
	pGdipDisposeImage               = gdiplus.NewProc("GdipDisposeImage")
	pGdipSetSmoothingMode           = gdiplus.NewProc("GdipSetSmoothingMode")
	pGdipSetTextRenderingHint       = gdiplus.NewProc("GdipSetTextRenderingHint")
	pGdipSetPixelOffsetMode         = gdiplus.NewProc("GdipSetPixelOffsetMode")
	pGdipGraphicsClear              = gdiplus.NewProc("GdipGraphicsClear")
	pGdipCreateSolidFill            = gdiplus.NewProc("GdipCreateSolidFill")
	pGdipDeleteBrush                = gdiplus.NewProc("GdipDeleteBrush")
	pGdipCreatePen1                 = gdiplus.NewProc("GdipCreatePen1")
	pGdipDeletePen                  = gdiplus.NewProc("GdipDeletePen")
	pGdipSetPenStartCap             = gdiplus.NewProc("GdipSetPenStartCap")
	pGdipSetPenEndCap               = gdiplus.NewProc("GdipSetPenEndCap")
	pGdipSetPenLineJoin             = gdiplus.NewProc("GdipSetPenLineJoin")
	pGdipCreatePath                 = gdiplus.NewProc("GdipCreatePath")
	pGdipDeletePath                 = gdiplus.NewProc("GdipDeletePath")
	pGdipAddPathArc                 = gdiplus.NewProc("GdipAddPathArc")
	pGdipAddPathLine                = gdiplus.NewProc("GdipAddPathLine")
	pGdipAddPathEllipse             = gdiplus.NewProc("GdipAddPathEllipse")
	pGdipClosePathFigure            = gdiplus.NewProc("GdipClosePathFigure")
	pGdipStartPathFigure            = gdiplus.NewProc("GdipStartPathFigure")
	pGdipFillPath                   = gdiplus.NewProc("GdipFillPath")
	pGdipDrawPath                   = gdiplus.NewProc("GdipDrawPath")
	pGdipFillEllipse                = gdiplus.NewProc("GdipFillEllipse")
	pGdipDrawEllipse                = gdiplus.NewProc("GdipDrawEllipse")
	pGdipDrawLine                   = gdiplus.NewProc("GdipDrawLine")
	pGdipDrawLines                  = gdiplus.NewProc("GdipDrawLines")
	pGdipFillRectangle              = gdiplus.NewProc("GdipFillRectangle")
	pGdipSetClipPath                = gdiplus.NewProc("GdipSetClipPath")
	pGdipResetClip                  = gdiplus.NewProc("GdipResetClip")
	pGdipNewPrivateFontCollection   = gdiplus.NewProc("GdipNewPrivateFontCollection")
	pGdipDeletePrivateFontCollection = gdiplus.NewProc("GdipDeletePrivateFontCollection")
	pGdipPrivateAddMemoryFont       = gdiplus.NewProc("GdipPrivateAddMemoryFont")
	pGdipCreateFontFamilyFromName   = gdiplus.NewProc("GdipCreateFontFamilyFromName")
	pGdipDeleteFontFamily           = gdiplus.NewProc("GdipDeleteFontFamily")
	pGdipCreateFont                 = gdiplus.NewProc("GdipCreateFont")
	pGdipDeleteFont                 = gdiplus.NewProc("GdipDeleteFont")
	pGdipCreateStringFormat         = gdiplus.NewProc("GdipCreateStringFormat")
	pGdipDeleteStringFormat         = gdiplus.NewProc("GdipDeleteStringFormat")
	pGdipSetStringFormatAlign       = gdiplus.NewProc("GdipSetStringFormatAlign")
	pGdipSetStringFormatLineAlign   = gdiplus.NewProc("GdipSetStringFormatLineAlign")
	pGdipSetStringFormatTrimming    = gdiplus.NewProc("GdipSetStringFormatTrimming")
	pGdipSetStringFormatFlags       = gdiplus.NewProc("GdipSetStringFormatFlags")
	pGdipDrawString                 = gdiplus.NewProc("GdipDrawString")
	pGdipMeasureString              = gdiplus.NewProc("GdipMeasureString")
)

type gdipStartupInput struct {
	version                uint32
	debugCallback          uintptr
	suppressBackgroundThrd int32
	suppressCodecs         int32
}

type rectF struct{ x, y, w, h float32 }
type pointF struct{ x, y float32 }

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

// session is one GDI+ startup and the private fonts loaded for it.
type session struct {
	token uintptr
	coll  uintptr
	fams  map[string]uintptr
}

func startGdip() *session {
	var tok uintptr
	in := gdipStartupInput{version: 1}
	if r, _, _ := pGdiplusStartup.Call(uintptr(unsafe.Pointer(&tok)), uintptr(unsafe.Pointer(&in)), 0); r != 0 {
		return nil
	}
	return &session{token: tok, fams: map[string]uintptr{}}
}

// loadFont adds a font file from memory; the bytes must stay alive until close.
func (s *session) loadFont(data []byte) {
	if s.coll == 0 {
		pGdipNewPrivateFontCollection.Call(uintptr(unsafe.Pointer(&s.coll)))
	}
	pGdipPrivateAddMemoryFont.Call(s.coll, uintptr(unsafe.Pointer(&data[0])), uintptr(len(data)))
}

func (s *session) family(name string) uintptr {
	if f, ok := s.fams[name]; ok {
		return f
	}
	var fam uintptr
	n, _ := syscall.UTF16PtrFromString(name)
	if r, _, _ := pGdipCreateFontFamilyFromName.Call(uintptr(unsafe.Pointer(n)), s.coll, uintptr(unsafe.Pointer(&fam))); r != 0 {
		fam = 0
	}
	s.fams[name] = fam
	return fam
}

func (s *session) close() {
	for _, f := range s.fams {
		if f != 0 {
			pGdipDeleteFontFamily.Call(f)
		}
	}
	if s.coll != 0 {
		pGdipDeletePrivateFontCollection.Call(uintptr(unsafe.Pointer(&s.coll)))
	}
	pGdiplusShutdown.Call(s.token)
}

// canvas draws into a w×h premultiplied-ARGB bitmap backed by bits.
type canvas struct {
	s        *session
	bmp, g   uintptr
	sf       uintptr // string format used for drawing
	fonts    map[fontKey]uintptr
	w, h     int
	scale    float32
}

type fontKey struct {
	name string
	px   float32
}

const pixelFormat32bppPARGB = 0x000E200B

func newCanvas(s *session, bits unsafe.Pointer, w, h int, scale float32) *canvas {
	c := &canvas{s: s, w: w, h: h, scale: scale, fonts: map[fontKey]uintptr{}}
	pGdipCreateBitmapFromScan0.Call(uintptr(w), uintptr(h), uintptr(w*4), pixelFormat32bppPARGB, uintptr(bits), uintptr(unsafe.Pointer(&c.bmp)))
	pGdipGetImageGraphicsContext.Call(c.bmp, uintptr(unsafe.Pointer(&c.g)))
	pGdipSetSmoothingMode.Call(c.g, 4)
	pGdipSetTextRenderingHint.Call(c.g, 4)
	pGdipSetPixelOffsetMode.Call(c.g, 4)
	pGdipCreateStringFormat.Call(0x00001000|0x0800, 0, uintptr(unsafe.Pointer(&c.sf))) // NoWrap | MeasureTrailingSpaces
	pGdipSetStringFormatLineAlign.Call(c.sf, 1)
	return c
}

func (c *canvas) close() {
	for _, f := range c.fonts {
		pGdipDeleteFont.Call(f)
	}
	pGdipDeleteStringFormat.Call(c.sf)
	pGdipDeleteGraphics.Call(c.g)
	pGdipDisposeImage.Call(c.bmp)
}

func (c *canvas) clear() { pGdipGraphicsClear.Call(c.g, 0) }

func (c *canvas) font(name string, px float32) uintptr {
	k := fontKey{name, px}
	if f, ok := c.fonts[k]; ok {
		return f
	}
	var f uintptr
	if fam := c.s.family(name); fam != 0 {
		pGdipCreateFont.Call(fam, fl(px*c.scale), 0, 2, uintptr(unsafe.Pointer(&f)))
	}
	c.fonts[k] = f
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

// rrectPath is a rounded rectangle in logical px (scaled here).
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

// strokeRRect draws a border that stays inside the rectangle.
func (c *canvas) strokeRRect(x, y, w, h, r, width float32, col uint32) {
	if col>>24 == 0 {
		return
	}
	hw := width / 2
	p := c.rrectPath(x+hw, y+hw, w-width, h-width, r-hw)
	pn := c.pen(col, width)
	pGdipDrawPath.Call(c.g, pn, p)
	pGdipDeletePen.Call(pn)
	pGdipDeletePath.Call(p)
}

func (c *canvas) fillEllipse(x, y, w, h float32, col uint32) {
	s := c.scale
	b := c.brush(col)
	pGdipFillEllipse.Call(c.g, b, fl(x*s), fl(y*s), fl(w*s), fl(h*s))
	pGdipDeleteBrush.Call(b)
}

func (c *canvas) strokeEllipse(x, y, w, h, width float32, col uint32) {
	s := c.scale
	pn := c.pen(col, width)
	pGdipDrawEllipse.Call(c.g, pn, fl(x*s), fl(y*s), fl(w*s), fl(h*s))
	pGdipDeletePen.Call(pn)
}

func (c *canvas) line(x1, y1, x2, y2, width float32, col uint32) {
	s := c.scale
	pn := c.pen(col, width)
	pGdipDrawLine.Call(c.g, pn, fl(x1*s), fl(y1*s), fl(x2*s), fl(y2*s))
	pGdipDeletePen.Call(pn)
}

func (c *canvas) polyline(pts []pointF, width float32, col uint32) {
	if len(pts) < 2 {
		return
	}
	sc := make([]pointF, len(pts))
	for i, p := range pts {
		sc[i] = pointF{p.x * c.scale, p.y * c.scale}
	}
	pn := c.pen(col, width)
	pGdipDrawLines.Call(c.g, pn, uintptr(unsafe.Pointer(&sc[0])), uintptr(len(sc)))
	pGdipDeletePen.Call(pn)
}

// strokeArc draws an arc of the ellipse in the box (x,y,w,h); angles in degrees, 0 = 3 o'clock, clockwise.
func (c *canvas) strokeArc(x, y, w, h, start, sweep, width float32, col uint32) {
	s := c.scale
	var p uintptr
	pGdipCreatePath.Call(0, uintptr(unsafe.Pointer(&p)))
	pGdipAddPathArc.Call(p, fl(x*s), fl(y*s), fl(w*s), fl(h*s), fl(start), fl(sweep))
	pn := c.pen(col, width)
	pGdipDrawPath.Call(c.g, pn, p)
	pGdipDeletePen.Call(pn)
	pGdipDeletePath.Call(p)
}

// clipRRect limits drawing to a rounded rectangle until resetClip.
func (c *canvas) clipRRect(x, y, w, h, r float32) {
	p := c.rrectPath(x, y, w, h, r)
	pGdipSetClipPath.Call(c.g, p, 0)
	pGdipDeletePath.Call(p)
}

func (c *canvas) resetClip() { pGdipResetClip.Call(c.g) }

type align int

const (
	alignLeft align = iota
	alignCenter
	alignRight
)

// text draws one line inside the box (x,y,w,h), vertically centred.
func (c *canvas) text(s string, font string, px float32, col uint32, x, y, w, h float32, al align, ellipsis bool) {
	f := c.font(font, px)
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
func (c *canvas) measure(s string, font string, px float32) float32 {
	f := c.font(font, px)
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
