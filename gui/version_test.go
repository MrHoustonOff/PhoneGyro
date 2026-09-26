package main

import "testing"

func TestComputeAppVersionUsesLdflagsWhenSet(t *testing.T) {
	oldR, oldB, oldC := releaseVersion, buildTag, buildChannel
	defer func() { releaseVersion, buildTag, buildChannel = oldR, oldB, oldC }()

	releaseVersion, buildTag, buildChannel = "1.2.0", "7", "dev"
	v := computeAppVersion()
	if v.Release != "1.2.0" || v.Build != "007" || v.Channel != "dev" {
		t.Fatalf("got %+v", v)
	}
	if v.Display != "1.2.0.007-dev" {
		t.Fatalf("display = %q, want 1.2.0.007-dev", v.Display)
	}
}

func TestComputeAppVersionFallsBackWithoutLdflagsOrGit(t *testing.T) {
	oldR, oldB, oldC := releaseVersion, buildTag, buildChannel
	defer func() { releaseVersion, buildTag, buildChannel = oldR, oldB, oldC }()

	releaseVersion, buildTag, buildChannel = "", "", ""
	v := computeAppVersion()
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

func TestGitVersionInDirMatchesRepoState(t *testing.T) {
	release, build, channel := gitVersionInDir(".")
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
