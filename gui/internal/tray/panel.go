package tray

import (
	"fmt"
	"math"
	"strings"
)

// The tray panel (design: components/Tray): a themed card with a hero (brand,
// link state, live rate), the phone / emulators / profile list, CPU and RAM
// tiles, and the actions. Drawn natively with GDI+ (gdip.go); nothing is kept
// between openings.

const (
	panelW   = 320 // logical px
	panelH   = 488
	shadowM  = 18 // margin around the card for its shadow
	cardR    = 22
	histLen  = 30
	heroH    = 108
	rowH     = 48
	tileH    = 78
	fontBody = "Onest"
	fontSemi = "Onest SemiBold SemiBold" // GDI+ names this face so (family + style)
	fontDisp = "Alegreya Sans ExtraBold"
	fontMono = "JetBrains Mono"
	fontMonS = "JetBrains Mono SemiBold"
)

type hitID int

const (
	hitNone hitID = iota
	hitOpen
	hitRecenter
	hitQuit
	hitProfile
)

type hitRect struct {
	id         hitID
	x, y, w, h float32
}

// panelModel is everything one frame needs.
type panelModel struct {
	st       Status
	hist     [histLen]float32 // rate history, oldest first
	cpuHist  [histLen]float32
	hover    hitID
	rects    []hitRect
	pal      palette
}

func (m *panelModel) hit(x, y float32) hitID {
	for _, r := range m.rects {
		if x >= r.x && x < r.x+r.w && y >= r.y && y < r.y+r.h {
			return r.id
		}
	}
	return hitNone
}

func (m *panelModel) enabled(id hitID) bool {
	return id != hitRecenter || m.st.Online
}

// num formats v with the language's decimal separator.
func num(lang string, v float64, dec int) string {
	s := fmt.Sprintf("%.*f", dec, v)
	if lang == "ru" {
		s = strings.Replace(s, ".", ",", 1)
	}
	return s
}

func (m *panelModel) texts() (title, sub, pill string) {
	l := m.st.Lang
	usb := m.st.Link == "USB"
	switch {
	case !m.st.Online:
		pill = tr(l, "офлайн", "offline")
		if m.st.Mode == "usb" {
			return tr(l, "Ждём контроллер", "Waiting for the controller"), tr(l, "Подключите его по USB", "Plug it in over USB"), pill
		}
		return tr(l, "Ждём телефон", "Waiting for your phone"), tr(l, "Отсканируйте QR-код в приложении", "Scan the QR code in the app"), pill
	case m.st.Paused:
		title, pill = tr(l, "Пауза", "Paused"), tr(l, "пауза", "paused")
	default:
		title, pill = tr(l, "Подключено", "Connected"), tr(l, "онлайн", "online")
	}
	var parts []string
	if m.st.Hz > 0 {
		parts = append(parts, fmt.Sprintf("%.0f %s", m.st.Hz, tr(l, "Гц", "Hz")))
	}
	if m.st.PingMs >= 0 && !usb {
		parts = append(parts, fmt.Sprintf("%d %s", m.st.PingMs, tr(l, "мс", "ms")))
	}
	if m.st.Link != "" {
		parts = append(parts, m.st.Link)
	}
	return title, strings.Join(parts, " · "), pill
}

// paint draws the whole window (card + shadow) and fills m.rects.
func (m *panelModel) paint(c *canvas) {
	p := m.pal
	l := m.st.Lang
	m.rects = m.rects[:0]
	c.clear()

	px, py, pw, ph := float32(shadowM), float32(shadowM), float32(panelW), float32(panelH)

	// shadow: soft rings outward from the card, lower than it
	a0 := float32(0.20)
	if p.dark {
		a0 = 0.55
	}
	for i := 1; i <= shadowM-2; i++ {
		k := 1 - float32(i)/float32(shadowM-1)
		c.strokeRRect(px-float32(i), py-float32(i)+7, pw+2*float32(i), ph+2*float32(i), cardR+float32(i), 1, argb(0, 0, 0, uint8(a0*k*k*255)))
	}
	c.fillRRect(px, py, pw, ph, cardR, p.raised)
	c.strokeRRect(px, py, pw, ph, cardR, 1, p.line)

	x := px + 8
	w := pw - 16
	y := py + 8

	// ── hero ────────────────────────────────────────────────────────────────
	live := m.st.Online && !m.st.Paused
	c.fillRRect(x, y, w, heroH, 14, p.surface)
	if live {
		c.fillRRect(x, y, w, heroH, 14, p.accentSoft)
		c.clipRRect(x, y, w, heroH, 14)
		cx, cy := x+w-37, y+37
		for k := 0; k < 6; k++ {
			r := 14.5 + 16*float32(k)
			a := float32(1) - float32(k)/5.5
			c.strokeEllipse(cx-r, cy-r, 2*r, 2*r, 3, withAlpha(p.accentSoft, 1.1*a))
		}
		c.resetClip()
	}
	c.strokeRRect(x, y, w, heroH, 14, 1, p.line)

	m.brand(c, x+12, y+12, live)
	title, sub, pillText := m.texts()
	m.pill(c, x+w-12, y+12, pillText, live)

	ty := y + 12 + 26 + 12
	textW := w - 24
	if live && m.st.Hz > 0 {
		textW -= 84
	}
	c.text(title, fontDisp, 22, p.ink, x+12, ty, textW, 24, alignLeft, true)
	c.text(sub, fontMono, 12, p.ink2, x+12, ty+26, w-24, 16, alignLeft, true)
	if live && m.st.Hz > 0 {
		m.spark(c, m.hist[:], x+w-12-72, ty+10, 72, 30, 0, p.accent)
	}
	y += heroH + 8

	// ── list ────────────────────────────────────────────────────────────────
	listH := float32(3 * rowH)
	c.fillRRect(x, y, w, listH, 14, p.inset)
	c.clipRRect(x, y, w, listH, 14)

	phoneLabel, phoneIcon := tr(l, "Телефон", "Phone"), iconPhone
	if m.st.Mode == "usb" {
		phoneLabel, phoneIcon = tr(l, "Контроллер", "Controller"), iconPad
	}
	phoneVal, phoneDot := "—", p.danger
	if m.st.Online {
		phoneVal, phoneDot = m.st.Device, p.accent
	}
	emuVal, emuDot := tr(l, "Нет клиентов", "No clients"), p.warn
	if m.st.Emulators > 0 {
		emuDot = p.accent
		emuVal = fmt.Sprintf(tr(l, "Подключено: %d", "Connected: %d"), m.st.Emulators)
	}
	profVal := m.st.Profile
	if profVal == "" {
		profVal = "—"
	}
	rows := []struct {
		label, val string
		icon       int
		dot        uint32
		link       bool
	}{
		{phoneLabel, phoneVal, phoneIcon, phoneDot, false},
		{tr(l, "Эмуляторы", "Emulators"), emuVal, iconPad, emuDot, false},
		{tr(l, "Профиль", "Profile"), profVal, iconProfile, 0, true},
	}
	// the first two rows are informational; the emulators row gets the pad icon, the controller row the phone one
	rows[1].icon = iconEmu
	for i, r := range rows {
		ry := y + float32(i*rowH)
		if r.link {
			m.rects = append(m.rects, hitRect{hitProfile, x, ry, w, rowH})
			if m.hover == hitProfile {
				c.fillRRect(x, ry, w, rowH, 0, p.hover)
			}
		}
		if i > 0 {
			c.line(x, ry, x+w, ry, 1, p.lineSub)
		}
		c.fillRRect(x+8, ry+10, 28, 28, 6, p.surface)
		c.strokeRRect(x+8, ry+10, 28, 28, 6, 1, p.lineSub)
		drawIcon(c, r.icon, x+8+14, ry+10+14, p.ink2)
		c.text(r.label, fontBody, 11, p.ink3, x+46, ry+6, w-46-34, 14, alignLeft, true)
		c.text(r.val, fontSemi, 13, p.ink, x+46, ry+22, w-46-34, 18, alignLeft, true)
		if r.link {
			c.line(x+w-17, ry+rowH/2-4, x+w-13, ry+rowH/2, 1.8, p.ink3)
			c.line(x+w-13, ry+rowH/2, x+w-17, ry+rowH/2+4, 1.8, p.ink3)
		} else {
			c.fillEllipse(x+w-20, ry+rowH/2-4, 8, 8, r.dot)
		}
	}
	c.resetClip()
	c.strokeRRect(x, y, w, listH, 14, 1, p.line)
	y += listH + 8

	// ── metrics ─────────────────────────────────────────────────────────────
	tw := (w - 8) / 2
	m.tile(c, x, y, tw, "CPU", tr(l, "процесс", "process"), num(l, m.st.CPU, 0), "%", func() {
		m.spark(c, m.cpuHist[:], x+12, y+tileH-10-22, tw-24, 22, 0, p.accent)
	})
	share := 0.0
	if m.st.RAMTotal > 0 {
		share = m.st.RAMMB / m.st.RAMTotal * 100
	}
	ramSub := ""
	if m.st.RAMTotal > 0 {
		ramSub = fmt.Sprintf(tr(l, "%s %% от %.0f ГБ", "%s%% of %.0f GB"), num(l, share, 1), m.st.RAMTotal/1024)
	}
	m.tile(c, x+tw+8, y, tw, tr(l, "ОЗУ", "RAM"), ramSub, num(l, m.st.RAMMB, 0), tr(l, "МБ", "MB"), func() {
		bx, by, bw := x+tw+8+12, y+tileH-10-8, tw-24
		c.fillRRect(bx, by, bw, 8, 4, p.surface)
		f := float32(math.Min(1, m.st.RAMMB/500))
		if f > 0.04 {
			c.fillRRect(bx, by, bw*f, 8, 4, p.accent)
		}
	})
	y += tileH + 8

	// ── actions ─────────────────────────────────────────────────────────────
	m.rects = append(m.rects, hitRect{hitOpen, x, y, w, 44})
	open := p.accent
	if m.hover == hitOpen {
		open = blend(p.accent, argb(255, 255, 255, 255), 0.14)
	}
	c.fillRRect(x, y, w, 44, 10, open)
	label := tr(l, "Открыть PhoneGyro", "Open PhoneGyro")
	lw := c.measure(label, fontSemi, 14)
	c.text(label, fontSemi, 14, p.onAccent, x+(w-lw-24)/2, y, lw+4, 44, alignLeft, false)
	ax := x + (w-lw-24)/2 + lw + 10
	c.line(ax, y+22, ax+12, y+22, 1.8, p.onAccent)
	c.line(ax+7, y+17, ax+12, y+22, 1.8, p.onAccent)
	c.line(ax+12, y+22, ax+7, y+27, 1.8, p.onAccent)
	y += 44 + 8

	rcW := w - 8 - 40
	m.rects = append(m.rects, hitRect{hitRecenter, x, y, rcW, 40}, hitRect{hitQuit, x + rcW + 8, y, 40, 40})
	m.button(c, x, y, rcW, 40, m.hover == hitRecenter && m.st.Online, m.st.Online, p.hover)
	k := float32(1)
	if !m.st.Online {
		k = 0.45
	}
	rl := tr(l, "Центрировать", "Recenter")
	rw := c.measure(rl, fontSemi, 13)
	rx := x + (rcW-rw-22)/2
	drawIcon(c, iconTarget, rx+7, y+20, withAlpha(p.ink2, k))
	c.text(rl, fontSemi, 13, withAlpha(p.ink, k), rx+22, y, rw+4, 40, alignLeft, false)
	quitHot := m.hover == hitQuit
	m.button(c, x+rcW+8, y, 40, 40, quitHot, true, withAlpha(p.danger, 0.16))
	qc := p.ink2
	if quitHot {
		qc = p.danger
	}
	drawIcon(c, iconPower, x+rcW+8+20, y+20, qc)
	y += 40 + 8

	// ── footer ──────────────────────────────────────────────────────────────
	foot := m.st.Version
	if m.st.DSUPort > 0 {
		if foot != "" {
			foot += " · "
		}
		foot += fmt.Sprintf("DSU :%d", m.st.DSUPort)
	}
	c.text(foot, fontMono, 11, p.ink3, x, y, w, 18, alignCenter, true)
}

func blend(a, b uint32, k float32) uint32 {
	mix := func(sh uint) uint32 {
		return uint32(float32(a>>sh&0xff)*(1-k) + float32(b>>sh&0xff)*k)
	}
	return mix(24)<<24 | mix(16)<<16 | mix(8)<<8 | mix(0)
}

func (m *panelModel) button(c *canvas, x, y, w, h float32, hot, enabled bool, hotFill uint32) {
	p := m.pal
	c.fillRRect(x, y, w, h, 10, p.surface)
	if hot {
		c.fillRRect(x, y, w, h, 10, hotFill)
	}
	c.strokeRRect(x, y, w, h, 10, 1, p.line)
}

// brand: the mark (phone in orbit) and the wordmark with its ring-o.
func (m *panelModel) brand(c *canvas, x, y float32, live bool) {
	p := m.pal
	c.strokeEllipse(x+1, y+1, 22, 22, 1.6, p.ink)
	c.fillRRect(x+8.5, y+5.5, 7, 13, 2, p.ink)
	c.fillEllipse(x+17, y+2, 5, 5, p.accent)
	tx := x + 32
	word := "PhoneGyr"
	wd := c.measure(word, fontDisp, 18)
	c.text(word, fontDisp, 18, p.ink, tx, y-1, wd+6, 26, alignLeft, false)
	ox := tx + wd - 2
	c.strokeEllipse(ox, y+7, 11, 11, 2, p.ink)
	if live {
		c.fillEllipse(ox+3.5, y+10.5, 4, 4, p.accent)
	}
}

// pill: the status chip, right edge at rx.
func (m *panelModel) pill(c *canvas, rx, y float32, text string, live bool) {
	p := m.pal
	tw := c.measure(text, fontSemi, 11)
	w := tw + 10 + 8 + 8 + 10
	x := rx - w
	fill, ink, dot := p.inset, p.ink2, p.danger
	if live {
		fill, ink, dot = p.accentSoft, p.accent, p.accent
	} else if m.st.Online {
		dot = p.warn
	}
	c.fillRRect(x, y, w, 26, 13, fill)
	c.strokeRRect(x, y, w, 26, 13, 1, p.line)
	c.fillEllipse(x+10, y+9, 8, 8, dot)
	c.text(text, fontSemi, 11, ink, x+10+8+8, y, tw+4, 26, alignLeft, false)
}

// tile: a metric card with label, value and the content drawn by extra.
func (m *panelModel) tile(c *canvas, x, y, w float32, label, sub, value, unit string, extra func()) {
	p := m.pal
	c.fillRRect(x, y, w, tileH, 14, p.inset)
	c.strokeRRect(x, y, w, tileH, 14, 1, p.line)
	c.text(label, fontBody, 11, p.ink3, x+12, y+9, 60, 14, alignLeft, false)
	c.text(sub, fontBody, 10, p.ink3, x+12+30, y+9, w-24-30, 14, alignRight, true)
	vw := c.measure(value, fontMonS, 20)
	c.text(value, fontMonS, 20, p.ink, x+12, y+22, vw+6, 26, alignLeft, false)
	c.text(unit, fontMono, 11, p.ink3, x+12+vw+2, y+24, 40, 26, alignLeft, false)
	extra()
}

// spark draws the series as a thin line in the box; lo is the fixed floor (0).
func (m *panelModel) spark(c *canvas, v []float32, x, y, w, h, lo float32, col uint32) {
	hi := float32(1)
	for _, f := range v {
		if f > hi {
			hi = f
		}
	}
	pts := make([]pointF, len(v))
	for i, f := range v {
		pts[i] = pointF{x + w*float32(i)/float32(len(v)-1), y + h - h*(f-lo)/(hi-lo)}
	}
	c.line(x, y+h, x+w, y+h, 1, m.pal.lineSub)
	c.polyline(pts, 1.6, col)
}

// icons (15 px, stroke 1.8, centred at cx,cy)
const (
	iconPhone = iota
	iconPad
	iconEmu
	iconProfile
	iconTarget
	iconPower
)

func drawIcon(c *canvas, id int, cx, cy float32, col uint32) {
	const sw = 1.7
	switch id {
	case iconPhone:
		c.strokeRRect(cx-4.5, cy-7, 9, 14, 2.5, sw, col)
		c.line(cx-1.5, cy+4, cx+1.5, cy+4, sw, col)
	case iconPad, iconEmu:
		c.strokeRRect(cx-8, cy-5, 16, 10, 5, sw, col)
		c.line(cx-4.5, cy, cx-1.5, cy, sw, col)
		c.line(cx-3, cy-1.5, cx-3, cy+1.5, sw, col)
		c.fillEllipse(cx+2, cy-2.6, 2.4, 2.4, col)
		c.fillEllipse(cx+4.6, cy-0.2, 2.4, 2.4, col)
	case iconProfile:
		c.line(cx-6, cy-4, cx+6, cy-4, sw, col)
		c.line(cx-6, cy+4, cx+6, cy+4, sw, col)
		c.fillEllipse(cx-3, cy-6.5, 5, 5, col)
		c.fillEllipse(cx+1, cy+1.5, 5, 5, col)
	case iconTarget:
		c.strokeEllipse(cx-4.5, cy-4.5, 9, 9, sw, col)
		c.line(cx, cy-8, cx, cy-5, sw, col)
		c.line(cx, cy+5, cx, cy+8, sw, col)
		c.line(cx-8, cy, cx-5, cy, sw, col)
		c.line(cx+5, cy, cx+8, cy, sw, col)
	case iconPower:
		c.strokeArc(cx-6.5, cy-5.5, 13, 13, -60, 300, sw, col)
		c.line(cx, cy-8, cx, cy-1, sw, col)
	}
}
