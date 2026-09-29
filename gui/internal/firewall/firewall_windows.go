package firewall

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
	"unsafe"

	ole "github.com/go-ole/go-ole"
	"github.com/go-ole/go-ole/oleutil"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// NET_FW_* values used here.
const (
	dirIn         = 1
	actionBlock   = 0
	actionAllow   = 1
	protoTCP      = 6
	protoAny      = 256
	profilesAll   = 0x7FFFFFFF
	sFalse        = 1          // S_FALSE: COM already initialised on this thread
	rpcChangeMode = 0x80010106 // RPC_E_CHANGED_MODE: initialised with another model
)

// ErrCancelled is returned by RequestAllow when the user declines the UAC prompt.
var ErrCancelled = errors.New("cancelled")

// withPolicy runs fn with the firewall policy object (HNetCfg.FwPolicy2) on a
// COM-initialised, locked OS thread.
func withPolicy(fn func(pol *ole.IDispatch) error) error {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if err := ole.CoInitializeEx(0, ole.COINIT_APARTMENTTHREADED); err != nil {
		var oe *ole.OleError
		switch {
		case errors.As(err, &oe) && oe.Code() == sFalse:
			defer ole.CoUninitialize()
		case errors.As(err, &oe) && oe.Code() == rpcChangeMode:
		default:
			return err
		}
	} else {
		defer ole.CoUninitialize()
	}
	unk, err := oleutil.CreateObject("HNetCfg.FwPolicy2")
	if err != nil {
		return err
	}
	defer unk.Release()
	pol, err := unk.QueryInterface(ole.IID_IDispatch)
	if err != nil {
		return err
	}
	defer pol.Release()
	return fn(pol)
}

func intProp(d *ole.IDispatch, name string, params ...interface{}) (int32, error) {
	v, err := oleutil.GetProperty(d, name, params...)
	if err != nil {
		return 0, err
	}
	defer v.Clear()
	switch x := v.Value().(type) {
	case int32:
		return x, nil
	case int64:
		return int32(x), nil
	case uint32:
		return int32(x), nil
	case bool:
		if x {
			return 1, nil
		}
		return 0, nil
	}
	return 0, fmt.Errorf("%s: unexpected %T", name, v.Value())
}

func strProp(d *ole.IDispatch, name string) string {
	v, err := oleutil.GetProperty(d, name)
	if err != nil {
		return ""
	}
	defer v.Clear()
	s, _ := v.Value().(string)
	return s
}

// activeProfiles is the profile bits of the networks the PC is on, minus the
// ones where Windows Firewall is off.
func activeProfiles(pol *ole.IDispatch) (int32, error) {
	cur, err := intProp(pol, "CurrentProfileTypes")
	if err != nil {
		return 0, err
	}
	var on int32
	for _, bit := range []int32{profileDomain, profilePrivate, profilePublic} {
		if cur&bit == 0 {
			continue
		}
		if enabled, err := intProp(pol, "FirewallEnabled", bit); err != nil || enabled != 0 {
			on |= bit // unreadable counts as on: better a needless prompt than a missed block
		}
	}
	return on, nil
}

// samePath compares a rule's application path with the exe's: rules may hold
// environment variables (%USERPROFILE%) and any letter case.
func samePath(ruleApp, exe string) bool {
	if ruleApp == "" {
		return false
	}
	if expanded, err := registry.ExpandString(ruleApp); err == nil {
		ruleApp = expanded
	}
	return strings.EqualFold(filepath.Clean(ruleApp), filepath.Clean(exe))
}

// forEachAppRule calls fn for each rule naming exe.
func forEachAppRule(pol *ole.IDispatch, exe string, fn func(r *ole.IDispatch, info rule) error) error {
	rv, err := oleutil.GetProperty(pol, "Rules")
	if err != nil {
		return err
	}
	rules := rv.ToIDispatch()
	defer rules.Release()
	return oleutil.ForEach(rules, func(v *ole.VARIANT) error {
		r := v.ToIDispatch()
		if r == nil || !samePath(strProp(r, "ApplicationName"), exe) {
			return nil
		}
		dir, _ := intProp(r, "Direction")
		action, _ := intProp(r, "Action")
		enabled, _ := intProp(r, "Enabled")
		profiles, _ := intProp(r, "Profiles")
		proto, _ := intProp(r, "Protocol")
		return fn(r, rule{
			inbound:  dir == dirIn,
			allow:    action == actionAllow,
			enabled:  enabled != 0,
			profiles: profiles,
			tcp:      proto == protoTCP || proto == protoAny,
		})
	})
}

// Check returns the firewall's verdict on exe for the networks in use.
func Check(exe string) Status {
	st := Status{State: Unknown}
	err := withPolicy(func(pol *ole.IDispatch) error {
		cur, err := intProp(pol, "CurrentProfileTypes")
		if err != nil {
			return err
		}
		st.Network = networkName(cur)
		active, err := activeProfiles(pol)
		if err != nil {
			return err
		}
		var rules []rule
		if err := forEachAppRule(pol, exe, func(_ *ole.IDispatch, info rule) error {
			rules = append(rules, info)
			return nil
		}); err != nil {
			return err
		}
		st.State = verdict(active, rules)
		return nil
	})
	if err != nil {
		st.State, st.Detail = Unknown, err.Error()
	}
	return st
}

// Allow lets inbound connections to exe through on the networks in use: block
// rules naming exe stop covering them (a rule left with no network is switched
// off), and the PhoneGyro allow rule is added or widened. Needs admin rights.
func Allow(exe string) error {
	return withPolicy(func(pol *ole.IDispatch) error {
		active, err := activeProfiles(pol)
		if err != nil {
			return err
		}
		if active == 0 {
			return nil // firewall off: nothing to allow
		}
		var own *ole.IDispatch
		err = forEachAppRule(pol, exe, func(r *ole.IDispatch, info rule) error {
			if !info.inbound {
				return nil
			}
			if info.allow {
				if own == nil && strProp(r, "Name") == RuleName {
					r.AddRef()
					own = r
				}
				return nil
			}
			if !info.enabled || info.profiles&active == 0 {
				return nil
			}
			profiles := info.profiles
			if profiles == profilesAll {
				profiles = profileDomain | profilePrivate | profilePublic
			}
			if left := profiles &^ active; left != 0 {
				_, err := oleutil.PutProperty(r, "Profiles", left)
				return err
			}
			_, err := oleutil.PutProperty(r, "Enabled", false)
			return err
		})
		if err != nil {
			return err
		}

		if own != nil {
			defer own.Release()
			profiles, _ := intProp(own, "Profiles")
			if _, err := oleutil.PutProperty(own, "Profiles", profiles|active); err != nil {
				return err
			}
			_, err := oleutil.PutProperty(own, "Enabled", true)
			return err
		}

		unk, err := oleutil.CreateObject("HNetCfg.FWRule")
		if err != nil {
			return err
		}
		defer unk.Release()
		r, err := unk.QueryInterface(ole.IID_IDispatch)
		if err != nil {
			return err
		}
		defer r.Release()
		for _, p := range []struct {
			name string
			val  interface{}
		}{
			{"Name", RuleName},
			{"Description", "Lets the phone connect to PhoneGyro over Wi-Fi."},
			{"ApplicationName", exe},
			{"Protocol", int32(protoAny)},
			{"Direction", int32(dirIn)},
			{"Action", int32(actionAllow)},
			{"Profiles", active},
			{"Enabled", true},
		} {
			if _, err := oleutil.PutProperty(r, p.name, p.val); err != nil {
				return fmt.Errorf("%s: %w", p.name, err)
			}
		}
		rv, err := oleutil.GetProperty(pol, "Rules")
		if err != nil {
			return err
		}
		rules := rv.ToIDispatch()
		defer rules.Release()
		_, err = oleutil.CallMethod(rules, "Add", r)
		return err
	})
}

// RunHelper is the elevated side of RequestAllow: main calls it when started
// with HelperArg, before anything else, and exits with its code.
func RunHelper() int {
	exe, err := os.Executable()
	if err != nil {
		return 2
	}
	if err := Allow(exe); err != nil {
		return 1
	}
	return 0
}

// shellExecuteInfo is SHELLEXECUTEINFOW.
type shellExecuteInfo struct {
	cbSize       uint32
	fMask        uint32
	hwnd         uintptr
	verb         *uint16
	file         *uint16
	parameters   *uint16
	directory    *uint16
	show         int32
	instApp      uintptr
	idList       uintptr
	class        *uint16
	keyClass     uintptr
	hotKey       uint32
	iconOrMonito uintptr
	process      windows.Handle
}

var (
	procShellExecuteEx   = windows.NewLazySystemDLL("shell32.dll").NewProc("ShellExecuteExW")
	procForegroundWindow = windows.NewLazySystemDLL("user32.dll").NewProc("GetForegroundWindow")
)

// RequestAllow runs this exe with HelperArg as administrator (Windows shows
// the UAC prompt) and waits for it. ErrCancelled if the user says no.
func RequestAllow() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	const (
		seeMaskNoCloseProcess = 0x40
		seeMaskNoAsync        = 0x100
		swHide                = 0
	)
	owner, _, _ := procForegroundWindow.Call() // the UAC prompt comes up over our window
	info := shellExecuteInfo{
		fMask:      seeMaskNoCloseProcess | seeMaskNoAsync,
		hwnd:       owner,
		verb:       windows.StringToUTF16Ptr("runas"),
		file:       windows.StringToUTF16Ptr(exe),
		parameters: windows.StringToUTF16Ptr(HelperArg),
		show:       swHide,
	}
	info.cbSize = uint32(unsafe.Sizeof(info))
	if ok, _, callErr := procShellExecuteEx.Call(uintptr(unsafe.Pointer(&info))); ok == 0 {
		if errors.Is(callErr, windows.ERROR_CANCELLED) {
			return ErrCancelled
		}
		return callErr
	}
	if info.process == 0 {
		return errors.New("no process")
	}
	defer windows.CloseHandle(info.process)
	ev, err := windows.WaitForSingleObject(info.process, uint32((60 * time.Second).Milliseconds()))
	if err != nil {
		return err
	}
	if ev != windows.WAIT_OBJECT_0 {
		return errors.New("timed out")
	}
	var code uint32
	if err := windows.GetExitCodeProcess(info.process, &code); err != nil {
		return err
	}
	if code != 0 {
		return fmt.Errorf("exit code %d", code)
	}
	return nil
}
