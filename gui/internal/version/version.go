// Package version is the app's build identity shown in the UI and on the phone page.
package version

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

// Build identity: {release}.{build:3 digits}-{channel}, e.g. "1.1.3.017-dev" or
// "1.1.3.000-release". release is the last version tag (v-prefix stripped); build is
// how many commits sit on top of it; channel is "release" for an exact tag build,
// "dev" for anything else (§ user request: explicit 4-part version, no guessing).
//
// releaseVersion/buildTag/buildChannel are settable at build time via -ldflags (the
// official release workflow does this from the pushed tag, which is authoritative and
// needs no git available on the build machine). Left empty, PhoneGyro falls back to
// asking git itself — convenient for everyday dev builds run straight from the repo —
// and finally to hard defaults if neither source is available (e.g. a binary someone
// copied out of the repo with no .git nearby).
var (
	releaseVersion = "" // -X phonegyro-gui/internal/version.releaseVersion=1.2.0
	buildTag       = "" // -X phonegyro-gui/internal/version.buildTag=000
	buildChannel   = "" // -X phonegyro-gui/internal/version.buildChannel=release
)

// releaseVersionFallback is the last resort when neither -ldflags nor git are
// available. Keep it in sync with gui/wails.json's "version" field.
const releaseVersionFallback = "2.0.0"

// Info is what the UI displays; Display is the ready-to-show string so every
// surface (desktop footer, phone web client) renders identically.
type Info struct {
	Release string `json:"release"`
	Build   string `json:"build"`
	Channel string `json:"channel"` // "release" or "dev"
	Display string `json:"display"`
}

var once struct {
	sync.Once
	v Info
}

// Get returns the app's version identity (cached after first call — none of its
// inputs change while the process is running).
func Get() Info {
	once.Do(func() {
		once.v = compute()
	})
	return once.v
}

func compute() Info {
	release, build, channel := releaseVersion, buildTag, buildChannel
	if release == "" || build == "" || channel == "" {
		release, build, channel = fromGit()
	}
	if release == "" {
		release = releaseVersionFallback
	}
	if build == "" {
		build = "000"
	}
	if channel == "" {
		channel = "dev"
	}
	if n, err := strconv.Atoi(build); err == nil {
		build = fmt.Sprintf("%03d", n)
	}
	return Info{
		Release: release,
		Build:   build,
		Channel: channel,
		Display: fmt.Sprintf("%s.%s-%s", release, build, channel),
	}
}

// fromGit is a best-effort local-dev fallback: it asks git for the nearest
// release tag and how many commits sit on top of it, run from the executable's own
// directory (git finds the repo root by walking up, so this works whether PhoneGyro
// runs from gui/build/bin or anywhere else inside the checkout). Any failure — no git,
// no repo, no tags — returns all-empty and the caller uses its hard defaults instead.
func fromGit() (release, build, channel string) {
	dir := "."
	if exe, err := os.Executable(); err == nil {
		dir = filepath.Dir(exe)
	}
	return gitInDir(dir)
}

// gitInDir is fromGit's testable core: same logic, explicit directory.
func gitInDir(dir string) (release, build, channel string) {
	run := func(args ...string) (string, bool) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		out, err := cmd.Output()
		if err != nil {
			return "", false
		}
		return strings.TrimSpace(string(out)), true
	}

	// Release tags only (v2.0.0): other tags (bookmarks like "pre-gemini") are not versions.
	tag, ok := run("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*")
	if !ok || tag == "" {
		return "", "", ""
	}
	release = strings.TrimPrefix(tag, "v")

	countStr, ok := run("rev-list", "--count", tag+"..HEAD")
	if !ok {
		return release, "", ""
	}
	n, err := strconv.Atoi(countStr)
	if err != nil {
		return release, "", ""
	}
	if n == 0 {
		return release, "000", "release"
	}
	return release, fmt.Sprintf("%03d", n), "dev"
}
