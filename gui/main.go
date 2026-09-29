// PhoneGyro turns a phone or a USB controller into a Cemuhook DSU motion source.
// The app itself lives in internal/app; this package only embeds the UI.
package main

import (
	"embed"
	"os"

	"phonegyro-gui/internal/app"
	"phonegyro-gui/internal/firewall"
)

//go:embed all:frontend/src
var assets embed.FS

func main() {
	// Started elevated by the "Allow" button: fix the firewall and exit, no UI.
	if len(os.Args) == 2 && os.Args[1] == firewall.HelperArg {
		os.Exit(firewall.RunHelper())
	}
	app.Run(assets)
}
