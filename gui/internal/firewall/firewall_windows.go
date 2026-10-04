package firewall

import (
	"errors"
	"fmt"
	"path/filepath"
	"runtime"
	"strings"

	ole "github.com/go-ole/go-ole"
	"github.com/go-ole/go-ole/oleutil"
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
