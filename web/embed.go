package web

import (
	"embed"
)

// IndexHTML contains the embedded phone controller web client.
//
//go:embed index.html
var IndexHTML []byte

// VisHTML contains the embedded Three.js 3D orientation visualizer.
//
//go:embed vis.html
var VisHTML []byte

// Assets are the phone page's fonts and textures, served under /m/ (the page
// itself is the single file above, so its first byte does not wait for them).
//
//go:embed assets
var Assets embed.FS
