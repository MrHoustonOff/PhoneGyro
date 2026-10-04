//go:build !windows

package resmon

import "runtime/debug"

// SetTrayMode: on other systems only the Go heap is returned (see trim_windows.go).
func SetTrayMode(on bool) {
	if on {
		debug.FreeOSMemory()
	}
}
