package firewall

import "testing"

func TestVerdict(t *testing.T) {
	allowPriv := rule{inbound: true, allow: true, enabled: true, profiles: profilePrivate, tcp: true}
	blockPub := rule{inbound: true, allow: false, enabled: true, profiles: profilePublic, tcp: true}
	blockUDP := rule{inbound: true, allow: false, enabled: true, profiles: profilesAllTest, tcp: false}
	allowAll := rule{inbound: true, allow: true, enabled: true, profiles: profilesAllTest, tcp: true}
	disabledBlock := rule{inbound: true, allow: false, enabled: false, profiles: profilesAllTest, tcp: true}

	cases := []struct {
		name   string
		active int32
		rules  []rule
		want   string
	}{
		{"firewall off", 0, []rule{blockPub}, Off},
		{"no rules yet", profilePrivate, nil, Pending},
		{"allowed on private", profilePrivate, []rule{allowPriv, blockPub}, Allowed},
		{"public network, only private allowed", profilePublic, []rule{allowPriv, blockPub}, Blocked},
		{"public network, no public rule", profilePublic, []rule{allowPriv}, Blocked},
		{"UDP block does not matter", profilePrivate, []rule{allowPriv, blockUDP}, Allowed},
		{"disabled block ignored", profilePrivate, []rule{allowAll, disabledBlock}, Allowed},
		{"block wins", profilePrivate, []rule{allowAll, {inbound: true, enabled: true, profiles: profilePrivate, tcp: true}}, Blocked},
		{"two networks, one blocked", profilePrivate | profilePublic, []rule{allowPriv}, Blocked},
	}
	for _, c := range cases {
		if got := verdict(c.active, c.rules); got != c.want {
			t.Errorf("%s: got %s, want %s", c.name, got, c.want)
		}
	}
}

const profilesAllTest = 0x7FFFFFFF

// TestCheckReads only reads this machine's firewall: it must not fail.
func TestCheckReads(t *testing.T) {
	st := Check(`C:\nonexistent\PhoneGyro-test.exe`)
	if st.State == Unknown {
		t.Skipf("firewall unreadable here: %s", st.Detail)
	}
	t.Logf("state=%s network=%s", st.State, st.Network)
}
