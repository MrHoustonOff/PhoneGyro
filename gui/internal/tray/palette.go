package tray

// The design tokens the panel needs (docs/internal/Design/tokens.css and the
// accents in pg.css), for both themes.

type palette struct {
	raised, surface, inset, hover  uint32
	ink, ink2, ink3                uint32
	line, lineSub                  uint32
	accent, accentSoft, onAccent   uint32
	accentLine                     uint32
	danger, warn                   uint32
	dark                           bool
}

func rgb(hex uint32) uint32 { return 0xff000000 | hex }

func rgba(hex uint32, a float32) uint32 { return uint32(a*255+0.5)<<24 | hex }

type accentTone struct {
	accent, onAccent uint32
	soft             float32 // alpha of the soft tint
}

// accents[name] = light, dark.
var accents = map[string][2]accentTone{
	"green":    {{0x5b7c26, 0xffffff, .13}, {0xa3bc69, 0x0b0b0b, .15}},
	"amber":    {{0xa06f08, 0xffffff, .13}, {0xf2cc85, 0x0b0b0b, .14}},
	"teal":     {{0x2f7686, 0xffffff, .13}, {0x7fc0cf, 0x0b0b0b, .14}},
	"pink":     {{0xb04570, 0xffffff, .12}, {0xeba3bd, 0x0b0b0b, .15}},
	"blue":     {{0x3b6fb0, 0xffffff, .13}, {0x8fb4e6, 0x0b0b0b, .15}},
	"violet":   {{0x7454b0, 0xffffff, .13}, {0xb8a2e8, 0x0b0b0b, .15}},
	"coral":    {{0xc4522a, 0xffffff, .13}, {0xf0a07f, 0x0b0b0b, .15}},
	"graphite": {{0x3a3a3a, 0xffffff, .13}, {0xd0d0d0, 0x0b0b0b, .15}},
}

func paletteFor(theme, accent string) palette {
	tones, ok := accents[accent]
	if !ok {
		tones = accents["green"]
	}
	if theme == "light" {
		t := tones[0]
		return palette{
			raised: rgb(0xffffff), surface: rgb(0xffffff), inset: rgb(0xe8e8e8), hover: rgb(0xf5f5f5),
			ink: rgb(0x0b0b0b), ink2: rgb(0x545454), ink3: rgb(0x646464),
			line: rgba(0x000000, .12), lineSub: rgba(0x000000, .07),
			accent: rgb(t.accent), accentSoft: rgba(t.accent, t.soft), onAccent: rgb(t.onAccent), accentLine: rgba(t.accent, .42),
			danger: rgb(0xc2432f), warn: rgb(0xb07c0c),
		}
	}
	t := tones[1]
	return palette{
		raised: rgb(0x1a1a1a), surface: rgb(0x151515), inset: rgb(0x0a0a0a), hover: rgb(0x1e1e1e),
		ink: rgb(0xf4f4f4), ink2: rgb(0xa6a6a6), ink3: rgb(0x8c8c8c),
		line: rgba(0xffffff, .12), lineSub: rgba(0xffffff, .07),
		accent: rgb(t.accent), accentSoft: rgba(t.accent, t.soft), onAccent: rgb(t.onAccent), accentLine: rgba(t.accent, .42),
		danger: rgb(0xf29b88), warn: rgb(0xf2cc85), dark: true,
	}
}
