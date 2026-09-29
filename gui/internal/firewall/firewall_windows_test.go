package firewall

import (
	"runtime"
	"testing"
	"unsafe"
)

// SHELLEXECUTEINFOW is 112 bytes on 64-bit Windows; a wrong layout makes
// ShellExecuteExW fail or write past the struct.
func TestShellExecuteInfoSize(t *testing.T) {
	if runtime.GOARCH != "amd64" && runtime.GOARCH != "arm64" {
		t.Skip("64-bit layout only")
	}
	if got := unsafe.Sizeof(shellExecuteInfo{}); got != 112 {
		t.Fatalf("sizeof(shellExecuteInfo) = %d, want 112", got)
	}
}
