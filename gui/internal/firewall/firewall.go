// Package firewall reads Windows Firewall's verdict on PhoneGyro.
//
// The phone connects to the PC over Wi-Fi (HTTP/HTTPS), so Windows Firewall must
// let inbound connections to PhoneGyro.exe through. Windows asks once, the first
// time the exe listens; a dismissed prompt leaves block rules behind and Windows
// never asks again. Check reads the rules (no admin rights needed). Fixing it is
// the user's job: the docs explain how to create the rule by hand.
package firewall

// States of Status.State.
const (
	Allowed = "allowed" // an allow rule covers every active network
	Blocked = "blocked" // a block rule, or nothing allows it (Windows blocks by default)
	Pending = "pending" // no rule at all yet: Windows is probably asking right now
	Off     = "off"     // Windows Firewall is off for the active networks
	Unknown = "unknown" // could not read the firewall (Detail says why)
)

// Status is the firewall's verdict on PhoneGyro for the networks the PC is on.
type Status struct {
	State   string `json:"state"`
	Network string `json:"network"` // "public", "private" or "domain": the strictest active one
	Detail  string `json:"detail,omitempty"`
}

// RuleName is the name of the allow rule PhoneGyro adds.
const RuleName = "PhoneGyro"

// Profile bits (NET_FW_PROFILE_TYPE2).
const (
	profileDomain  = 1
	profilePrivate = 2
	profilePublic  = 4
)

func networkName(profiles int32) string {
	switch {
	case profiles&profilePublic != 0:
		return "public"
	case profiles&profilePrivate != 0:
		return "private"
	case profiles&profileDomain != 0:
		return "domain"
	}
	return ""
}

// rule is the part of a firewall rule the verdict depends on.
type rule struct {
	inbound  bool
	allow    bool
	enabled  bool
	profiles int32
	tcp      bool // TCP or any protocol: what the phone uses
}

// verdict decides the state for the active, firewall-enabled profile bits from
// the rules that name PhoneGyro's exe. Block rules win, as in Windows.
func verdict(active int32, rules []rule) string {
	if active == 0 {
		return Off
	}
	anyRule := false
	for _, r := range rules {
		if r.inbound && r.enabled {
			anyRule = true
		}
	}
	for _, bit := range []int32{profileDomain, profilePrivate, profilePublic} {
		if active&bit == 0 {
			continue
		}
		allowed := false
		for _, r := range rules {
			if !r.inbound || !r.enabled || !r.tcp || r.profiles&bit == 0 {
				continue
			}
			if !r.allow {
				return Blocked
			}
			allowed = true
		}
		if !allowed {
			if !anyRule {
				return Pending
			}
			return Blocked
		}
	}
	return Allowed
}
