//go:build !windows

package firewall

import "errors"

var errUnsupported = errors.New("Windows Firewall only")

// Check: there is no Windows Firewall here.
func Check(exe string) Status { return Status{State: Unknown, Detail: errUnsupported.Error()} }
