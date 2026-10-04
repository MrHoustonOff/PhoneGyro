//go:build windows

package resmon

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

var (
	kernel32                 = syscall.NewLazyDLL("kernel32.dll")
	psapi                    = syscall.NewLazyDLL("psapi.dll")
	procGetProcessMemoryInfo = psapi.NewProc("GetProcessMemoryInfo")
	procGetProcessTimes      = kernel32.NewProc("GetProcessTimes")
	procGlobalMemoryStatusEx = kernel32.NewProc("GlobalMemoryStatusEx")
)

const (
	processQueryInformation = 0x0400
	processQueryLimitedInfo = 0x1000
	processVMRead           = 0x0010

	// The process tree changes rarely (Live Debug opens, WebView2 restarts a
	// renderer): rebuilding it walks every process on the machine, so it is
	// done this often, not on every sample.
	treeRefreshEvery = 30 * time.Second
)

// processMemoryCounters matches Windows PROCESS_MEMORY_COUNTERS layout.
type processMemoryCounters struct {
	cb                         uint32
	PageFaultCount             uint32
	PeakWorkingSetSize         uintptr
	WorkingSetSize             uintptr // RSS / Working Set
	QuotaPeakPagedPoolUsage    uintptr
	QuotaPagedPoolUsage        uintptr
	QuotaPeakNonPagedPoolUsage uintptr
	QuotaNonPagedPoolUsage     uintptr
	PagefileUsage              uintptr
	PeakPagefileUsage          uintptr
	// PROCESS_MEMORY_COUNTERS_EX2 (Windows 10 1809+); older systems reject this cb
	PrivateUsage          uintptr
	PrivateWorkingSetSize uintptr
	SharedCommitUsage     uint64
}

// memoryStatusEx matches Windows MEMORYSTATUSEX layout.
type memoryStatusEx struct {
	cbSize                  uint32
	dwMemoryLoad            uint32
	ullTotalPhys            uint64
	ullAvailPhys            uint64
	ullTotalPageFile        uint64
	ullAvailPageFile        uint64
	ullTotalVirtual         uint64
	ullAvailVirtual         uint64
	ullAvailExtendedVirtual uint64
}

// tracked is one process of the app: its handle stays open between samples.
type tracked struct {
	h       syscall.Handle
	own     bool  // the handle belongs to us (not the pseudo handle of this process)
	core    bool  // PhoneGyro.exe itself (the Go side), not a WebView2 process
	lastCPU int64 // kernel+user time at the previous sample, ns; -1 = not sampled yet
}

type windowsMonitor struct {
	rootPID  uint32
	procs    map[uint32]*tracked
	lastTree time.Time
	lastWall time.Time
	totalRAM uint64
	ncpu     int
	noEx2    bool // the system has no PROCESS_MEMORY_COUNTERS_EX2
}

func readTotalRAMWindows() uint64 {
	var mse memoryStatusEx
	mse.cbSize = uint32(unsafe.Sizeof(mse))
	r, _, _ := procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&mse)))
	if r != 0 {
		return mse.ullTotalPhys
	}
	return 0
}

func newPlatformMonitor() (Monitor, error) {
	h, err := syscall.GetCurrentProcess()
	if err != nil {
		return nil, err
	}
	rootPID := uint32(os.Getpid())
	m := &windowsMonitor{
		rootPID:  rootPID,
		procs:    map[uint32]*tracked{rootPID: {h: h, core: true, lastCPU: -1}},
		lastWall: time.Now(),
		totalRAM: readTotalRAMWindows(),
		ncpu:     runtime.NumCPU(),
	}
	m.refreshTree()
	m.Sample() // baseline: the first real sample then covers one interval
	return m, nil
}

// appTreePIDs is the app's processes: this one, its own children (the debug
// window is PhoneGyro.exe --debugwin) and the WebView2 processes that
// render their UI (msedgewebview2.exe and everything they start: renderer,
// GPU, utility). WebView2 does most of the UI work, so leaving it out would
// under-report both CPU and memory.
func appTreePIDs(rootPID uint32) map[uint32]bool {
	snap, err := syscall.CreateToolhelp32Snapshot(syscall.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return map[uint32]bool{rootPID: true}
	}
	defer syscall.CloseHandle(snap)

	var entry syscall.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	if err := syscall.Process32First(snap, &entry); err != nil {
		return map[uint32]bool{rootPID: true}
	}

	exePath, _ := os.Executable()
	ourExe := strings.ToLower(filepath.Base(exePath))
	childrenOf := make(map[uint32][]uint32)
	nameOf := make(map[uint32]string)
	for {
		nameOf[entry.ProcessID] = strings.ToLower(syscall.UTF16ToString(entry.ExeFile[:]))
		childrenOf[entry.ParentProcessID] = append(childrenOf[entry.ParentProcessID], entry.ProcessID)
		if err := syscall.Process32Next(snap, &entry); err != nil {
			break
		}
	}

	pids := map[uint32]bool{rootPID: true} // pid → it is our own executable
	queue := []uint32{rootPID}
	seen := map[uint32]bool{rootPID: true}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		for _, c := range childrenOf[cur] {
			if seen[c] || c == 0 {
				continue
			}
			n := nameOf[c]
			// our own executable, WebView2, and anything WebView2 itself started
			if n == ourExe || strings.HasPrefix(n, "phonegyro") || n == "msedgewebview2.exe" || nameOf[cur] == "msedgewebview2.exe" {
				seen[c] = true
				pids[c] = n == ourExe || strings.HasPrefix(n, "phonegyro")
				queue = append(queue, c)
			}
		}
	}
	return pids
}

// refreshTree opens handles for processes that joined the app and closes the
// ones that left.
func (m *windowsMonitor) refreshTree() {
	m.lastTree = time.Now()
	now := appTreePIDs(m.rootPID)
	for pid, core := range now {
		if _, ok := m.procs[pid]; ok {
			continue
		}
		h, err := syscall.OpenProcess(processQueryInformation|processVMRead, false, pid)
		if err != nil {
			h, err = syscall.OpenProcess(processQueryLimitedInfo|processVMRead, false, pid)
		}
		if err != nil {
			continue
		}
		m.procs[pid] = &tracked{h: h, own: true, core: core, lastCPU: -1}
	}
	for pid, p := range m.procs {
		if _, ok := now[pid]; !ok && pid != m.rootPID {
			m.drop(pid, p)
		}
	}
}

func (m *windowsMonitor) drop(pid uint32, p *tracked) {
	if p.own {
		syscall.CloseHandle(p.h)
	}
	delete(m.procs, pid)
}

func filetimeNanos(ft syscall.Filetime) int64 {
	return (int64(ft.HighDateTime)<<32 | int64(ft.LowDateTime)) * 100
}

// Sample: one GetProcessTimes and one GetProcessMemoryInfo per app process
// (the tree itself is rebuilt only every treeRefreshEvery).
func (m *windowsMonitor) Sample() Stats {
	if time.Since(m.lastTree) >= treeRefreshEvery {
		m.refreshTree()
	}
	now := time.Now()
	var cpuDelta int64
	var core, web uint64
	for pid, p := range m.procs {
		var creation, exit, kernel, user syscall.Filetime
		r, _, _ := procGetProcessTimes.Call(uintptr(p.h),
			uintptr(unsafe.Pointer(&creation)), uintptr(unsafe.Pointer(&exit)),
			uintptr(unsafe.Pointer(&kernel)), uintptr(unsafe.Pointer(&user)))
		if r == 0 || (pid != m.rootPID && filetimeNanos(exit) != 0) {
			if pid != m.rootPID {
				m.drop(pid, p) // exited: its handle would otherwise keep the process object alive
			}
			continue
		}
		cpu := filetimeNanos(kernel) + filetimeNanos(user)
		if p.lastCPU >= 0 && cpu > p.lastCPU {
			cpuDelta += cpu - p.lastCPU
		}
		p.lastCPU = cpu

		if mem := m.privateMemory(p.h); p.core {
			core += mem
		} else {
			web += mem
		}
	}

	wall := now.Sub(m.lastWall).Nanoseconds()
	m.lastWall = now
	var cpuPercent float64
	if wall > 0 && m.ncpu > 0 {
		cpuPercent = float64(cpuDelta) / float64(wall) / float64(m.ncpu) * 100
	}
	return Stats{CPUPercent: cpuPercent, RAMBytes: core + web, CoreRAMBytes: core, WebRAMBytes: web, TotalRAMBytes: m.totalRAM}
}

// privateMemory is the process's private working set: what Task Manager shows
// in its Memory column. The plain working set also counts pages shared with
// other processes (the WebView2 DLLs, the GPU process's shared memory), so
// summing it over the app's 6-8 processes counted the same pages many times
// and reported about twice what Task Manager does.
func (m *windowsMonitor) privateMemory(h syscall.Handle) uint64 {
	var pmc processMemoryCounters
	if !m.noEx2 {
		pmc.cb = uint32(unsafe.Sizeof(pmc))
		if r, _, _ := procGetProcessMemoryInfo.Call(uintptr(h), uintptr(unsafe.Pointer(&pmc)), uintptr(pmc.cb)); r != 0 {
			return uint64(pmc.PrivateWorkingSetSize)
		}
		m.noEx2 = true
	}
	// before Windows 10 1809: the working set, shared pages included
	pmc.cb = uint32(unsafe.Offsetof(pmc.PrivateUsage))
	if r, _, _ := procGetProcessMemoryInfo.Call(uintptr(h), uintptr(unsafe.Pointer(&pmc)), uintptr(pmc.cb)); r != 0 {
		return uint64(pmc.WorkingSetSize)
	}
	return 0
}
