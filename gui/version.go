package main

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
	releaseVersion = "" // -X main.releaseVersion=1.2.0
	buildTag       = "" // -X main.buildTag=000
	buildChannel   = "" // -X main.buildChannel=release
)

// releaseVersionFallback is the last resort when neither -ldflags nor git are
// available. Keep it in sync with gui/wails.json's "version" field.
const releaseVersionFallback = "2.0.0"

// AppVersion is what the UI displays; Display is the ready-to-show string so every
// surface (desktop footer, phone web client) renders identically.
type AppVersion struct {
	Release string `json:"release"`
	Build   string `json:"build"`
	Channel string `json:"channel"` // "release" or "dev"
	Display string `json:"display"`
}

var versionOnce struct {
	sync.Once
	v AppVersion
}

// GetAppVersion returns the app's version identity (cached after first call — none of
// its inputs change while the process is running).
func (a *App) GetAppVersion() AppVersion {
	versionOnce.Do(func() {
		versionOnce.v = computeAppVersion()
	})
	return versionOnce.v
}

func computeAppVersion() AppVersion {
	release, build, channel := releaseVersion, buildTag, buildChannel
	if release == "" || build == "" || channel == "" {
		release, build, channel = versionFromGit()
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
	return AppVersion{
		Release: release,
		Build:   build,
		Channel: channel,
		Display: fmt.Sprintf("%s.%s-%s", release, build, channel),
	}
}

// versionFromGit is a best-effort local-dev fallback: it asks git for the nearest
// release tag and how many commits sit on top of it, run from the executable's own
// directory (git finds the repo root by walking up, so this works whether PhoneGyro
// runs from gui/build/bin or anywhere else inside the checkout). Any failure — no git,
// no repo, no tags — returns all-empty and the caller uses its hard defaults instead.
func versionFromGit() (release, build, channel string) {
	dir := "."
	if exe, err := os.Executable(); err == nil {
		dir = filepath.Dir(exe)
	}
	return gitVersionInDir(dir)
}

// gitVersionInDir is versionFromGit's testable core: same logic, explicit directory.
func gitVersionInDir(dir string) (release, build, channel string) {
	run := func(args ...string) (string, bool) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		out, err := cmd.Output()
		if err != nil {
			return "", false
		}
		return strings.TrimSpace(string(out)), true
	}

	tag, ok := run("describe", "--tags", "--abbrev=0")
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
