package version

import (
	"os"
	"os/exec"
	"testing"
)

func TestComputeUsesLdflagsWhenSet(t *testing.T) {
	oldR, oldB, oldC := releaseVersion, buildTag, buildChannel
	defer func() { releaseVersion, buildTag, buildChannel = oldR, oldB, oldC }()

	releaseVersion, buildTag, buildChannel = "1.2.0", "7", "dev"
	v := compute()
	if v.Release != "1.2.0" || v.Build != "007" || v.Channel != "dev" {
		t.Fatalf("got %+v", v)
	}
	if v.Display != "1.2.0.007-dev" {
		t.Fatalf("display = %q, want 1.2.0.007-dev", v.Display)
	}
}

func TestComputeFallsBackWithoutLdflagsOrGit(t *testing.T) {
	oldR, oldB, oldC := releaseVersion, buildTag, buildChannel
	defer func() { releaseVersion, buildTag, buildChannel = oldR, oldB, oldC }()

	releaseVersion, buildTag, buildChannel = "", "", ""
	v := compute()
	// Whatever the source (git in this checkout, or the hard fallback), the shape
	// must always be well-formed: non-empty release, 3-digit build, a real channel.
	if v.Release == "" {
		t.Fatalf("empty release: %+v", v)
	}
	if len(v.Build) != 3 {
		t.Fatalf("build not zero-padded to 3 digits: %+v", v)
	}
	if v.Channel != "release" && v.Channel != "dev" {
		t.Fatalf("unexpected channel: %+v", v)
	}
}

func TestGitInDirMatchesRepoState(t *testing.T) {
	release, build, channel := gitInDir(".")
	if release == "" {
		t.Skip("no git tags reachable from this checkout")
	}
	t.Logf("release=%s build=%s channel=%s", release, build, channel)
	if len(build) != 3 {
		t.Fatalf("build not 3 digits: %q", build)
	}
	if channel != "release" && channel != "dev" {
		t.Fatalf("unexpected channel: %q", channel)
	}
}

// TestGitInDirIgnoresNonReleaseTags: a bookmark tag newer than the last release
// ("pre-gemini" after v2.0.0) is not a version.
func TestGitInDirIgnoresNonReleaseTags(t *testing.T) {
	dir := t.TempDir()
	git := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Skipf("git %v: %v %s", args, err, out)
		}
	}
	git("init", "-q")
	git("commit", "-q", "--allow-empty", "-m", "a")
	git("tag", "v1.2.0")
	git("commit", "-q", "--allow-empty", "-m", "b")
	git("tag", "pre-something")
	release, build, channel := gitInDir(dir)
	if release != "1.2.0" || build != "001" || channel != "dev" {
		t.Fatalf("got %s %s %s, want 1.2.0 001 dev", release, build, channel)
	}
}
