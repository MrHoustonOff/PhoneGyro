//go:build windows

package resmon

import (
	"os"
	"runtime/debug"
	"syscall"
	"unsafe"
)

var (
	procSetProcessWorkingSetSize = kernel32.NewProc("SetProcessWorkingSetSize")
	procSetProcessInformation    = kernel32.NewProc("SetProcessInformation")
	procSetPriorityClass         = kernel32.NewProc("SetPriorityClass")
)

const (
	processSetQuota       = 0x0100
	processSetInformation = 0x0200

	processPowerThrottling        = 4 // PROCESS_INFORMATION_CLASS
	powerThrottlingCurrentVersion = 1
	powerThrottlingExecutionSpeed = 0x1

	idlePriorityClass   = 0x40
	normalPriorityClass = 0x20
)

type powerThrottlingState struct {
	Version     uint32
	ControlMask uint32
	StateMask   uint32
}

// SetTrayMode puts the app's processes in or out of the tray diet. In: the
// WebView2 processes (the page is about:blank by now) go to efficiency mode
// (EcoQoS + idle priority: Task Manager shows the green leaf) and every app
// process, Go included, hands its working set back to Windows, so the memory
// Task Manager shows drops to a few MB. Out: normal priority and speed again;
// the pages come back on their own as the UI reloads. The Go side is not
// throttled: DSU and the phone link keep their timing.
func SetTrayMode(on bool) {
	if on {
		debug.FreeOSMemory()
	}
	self := uint32(os.Getpid())
	for pid, core := range appTreePIDs(self) {
		h, err := syscall.OpenProcess(processSetQuota|processSetInformation, false, pid)
		if err != nil {
			continue
		}
		if !core {
			st := powerThrottlingState{Version: powerThrottlingCurrentVersion, ControlMask: powerThrottlingExecutionSpeed}
			prio := uintptr(normalPriorityClass)
			if on {
				st.StateMask = powerThrottlingExecutionSpeed
				prio = idlePriorityClass
			}
			procSetProcessInformation.Call(uintptr(h), processPowerThrottling, uintptr(unsafe.Pointer(&st)), unsafe.Sizeof(st))
			procSetPriorityClass.Call(uintptr(h), prio)
		}
		if on {
			// (SIZE_T)-1, (SIZE_T)-1: empty the working set
			procSetProcessWorkingSetSize.Call(uintptr(h), ^uintptr(0), ^uintptr(0))
		}
		syscall.CloseHandle(h)
	}
}
