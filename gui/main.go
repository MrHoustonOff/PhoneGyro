// PhoneGyro turns a phone or a USB controller into a Cemuhook DSU motion source.
// The app itself lives in internal/app; this package only embeds the UI.
package main

import (
	"embed"

	"phonegyro-gui/internal/app"
)

//go:embed all:frontend/src
var assets embed.FS

func main() {
	app.Run(assets)
}
