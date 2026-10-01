// Package winstate remembers where the main window was (position, size,
// maximised) and decides on the next launch whether that placement still fits
// the monitors. The UI scale is only restored together with a placement that
// fits; otherwise the window opens at the default size and scale, so a scale
// of 200 % can never end up in a small window.
package winstate

import (
	"encoding/json"
	"os"
	"path/filepath"
)

const fileName = "window.json"

// State is the window's normal (not maximised) rectangle in screen pixels.
type State struct {
	Left      int32 `json:"left"`
	Top       int32 `json:"top"`
	Right     int32 `json:"right"`
	Bottom    int32 `json:"bottom"`
	Maximised bool  `json:"maximised,omitempty"`
}

// Width and Height of the rectangle.
func (s State) Width() int32  { return s.Right - s.Left }
func (s State) Height() int32 { return s.Bottom - s.Top }

// Load reads dir/window.json; ok is false when there is none or it is broken.
func Load(dir string) (s State, ok bool) {
	b, err := os.ReadFile(filepath.Join(dir, fileName))
	if err != nil || json.Unmarshal(b, &s) != nil {
		return State{}, false
	}
	return s, s.Width() > 0 && s.Height() > 0
}

// Save writes dir/window.json.
func Save(dir string, s State) error {
	b, err := json.Marshal(s)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, fileName), b, 0o644)
}

// Snap picks the largest scale step that does not exceed fit (the window must
// fit the screen, so it rounds down); the steps are the UI's own (ui/zoom.js).
func Snap(fit float64) float64 {
	steps := []float64{0.5, 0.6, 0.7, 0.8, 0.9, 1}
	best := steps[0]
	for _, s := range steps {
		if s <= fit+1e-9 {
			best = s
		}
	}
	return best
}
