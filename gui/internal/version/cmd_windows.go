//go:build windows

package version

import (
	"os/exec"
	"syscall"
)

// prepareCmd hides the console window for spawned subprocesses on Windows.
// Without this, console applications like git.exe flash a CMD/conhost window
// when launched from a GUI subsystem process.
func prepareCmd(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}
}
