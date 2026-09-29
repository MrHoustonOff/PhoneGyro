//go:build !windows

package firewall

import "errors"

// ErrCancelled is returned by RequestAllow when the user declines.
var ErrCancelled = errors.New("cancelled")

var errUnsupported = errors.New("Windows Firewall only")

// Check: there is no Windows Firewall here.
func Check(exe string) Status { return Status{State: Unknown, Detail: errUnsupported.Error()} }

// Allow is Windows-only.
func Allow(exe string) error { return errUnsupported }

// RunHelper is Windows-only.
func RunHelper() int { return 1 }

// RequestAllow is Windows-only.
func RequestAllow() error { return errUnsupported }
