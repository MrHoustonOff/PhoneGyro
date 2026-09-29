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
	treeRefreshEvery = 10 * time.Second
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
	lastCPU int64 // kernel+user time at the previous sample, ns; -1 = not sampled yet
}

type windowsMonitor struct {
	rootPID  uint32
	procs    map[uint32]*tracked
	lastTree time.Time
	lastWall time.Time
	totalRAM uint64
	ncpu     int
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
		procs:    map[uint32]*tracked{rootPID: {h: h, lastCPU: -1}},
		lastWall: time.Now(),
		totalRAM: readTotalRAMWindows(),
		ncpu:     runtime.NumCPU(),
	}
	m.refreshTree()
	m.Sample() // baseline: the first real sample then covers one interval
	return m, nil
}

// appTreePIDs is the app's processes: this one, its own children (the Live
// Debug window is PhoneGyro.exe --livedebug) and the WebView2 processes that
// render their UI (msedgewebview2.exe and everything they start: renderer,
// GPU, utility). WebView2 does most of the UI work, so leaving it out would
// under-report both CPU and memory.
func appTreePIDs(rootPID uint32) []uint32 {
	snap, err := syscall.CreateToolhelp32Snapshot(syscall.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return []uint32{rootPID}
	}
	defer syscall.CloseHandle(snap)

	var entry syscall.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	if err := syscall.Process32First(snap, &entry); err != nil {
		return []uint32{rootPID}
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

	pids := []uint32{rootPID}
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
				pids = append(pids, c)
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
	now := make(map[uint32]bool)
	for _, pid := range appTreePIDs(m.rootPID) {
		now[pid] = true
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
		m.procs[pid] = &tracked{h: h, own: true, lastCPU: -1}
	}
	for pid, p := range m.procs {
		if !now[pid] && pid != m.rootPID {
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
	var rss uint64
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

		var pmc processMemoryCounters
		pmc.cb = uint32(unsafe.Sizeof(pmc))
		if r, _, _ := procGetProcessMemoryInfo.Call(uintptr(p.h), uintptr(unsafe.Pointer(&pmc)), uintptr(pmc.cb)); r != 0 {
			rss += uint64(pmc.WorkingSetSize)
		}
	}

	wall := now.Sub(m.lastWall).Nanoseconds()
	m.lastWall = now
	var cpuPercent float64
	if wall > 0 && m.ncpu > 0 {
		cpuPercent = float64(cpuDelta) / float64(wall) / float64(m.ncpu) * 100
	}
	return Stats{CPUPercent: cpuPercent, RAMBytes: rss, TotalRAMBytes: m.totalRAM}
}
