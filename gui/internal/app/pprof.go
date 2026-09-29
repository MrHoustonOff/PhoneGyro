package app

import (
	"net/http"
	_ "net/http/pprof" // registers /debug/pprof on http.DefaultServeMux only
	"os"
)

// startProfilerIfAsked serves Go's profiler on localhost when PHONEGYRO_PPROF is
// set, for diagnosing CPU use in the field:
//
//	set PHONEGYRO_PPROF=1 && PhoneGyro.exe
//	go tool pprof -top http://127.0.0.1:6061/debug/pprof/profile?seconds=10
//
// Off by default. It uses http.DefaultServeMux, which none of the app's own
// servers use, and listens on 127.0.0.1 only.
func startProfilerIfAsked() {
	if os.Getenv("PHONEGYRO_PPROF") == "" {
		return
	}
	go func() { _ = http.ListenAndServe("127.0.0.1:6061", nil) }()
}
