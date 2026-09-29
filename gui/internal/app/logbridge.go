package app

import (
	"io"
	"log"
	"os"
	"strings"
)

// routeStdLog sends the std log (attitude anchor engage/disengage, sensor frame
// lock -- rare state changes only) into phonegyro.log as well as stderr. Before,
// they only reached a console nobody sees, so a field report could not tell
// whether the iOS attitude anchor was even engaged.
func (a *App) routeStdLog() {
	log.SetFlags(0)
	log.SetOutput(io.MultiWriter(os.Stderr, appLogWriter{a}))
}

type appLogWriter struct{ a *App }

func (w appLogWriter) Write(p []byte) (int, error) {
	if line := strings.TrimSpace(string(p)); line != "" {
		w.a.logEvent("INFO", "%s", line)
	}
	return len(p), nil
}
