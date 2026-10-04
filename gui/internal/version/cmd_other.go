//go:build !windows

package version

import "os/exec"

// prepareCmd is a no-op on non-Windows platforms.
func prepareCmd(cmd *exec.Cmd) {}
