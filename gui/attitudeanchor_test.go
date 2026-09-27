package main

import (
	"bufio"
	"math"
	"math/rand"
	"os"
	"strconv"
	"strings"
	"testing"
)

// simulateHandMotion returns 60 Hz samples of fast wobbly rotation: the gyro sample
// (instantaneous rate with per-axis scale error and noise, device axes, rad/s) and
// the true attitude (device -> world) integrated finely in between.
func simulateHandMotion(seconds float64, seed int64) (gyro [][3]float64, truth []quat) {
	rng := rand.New(rand.NewSource(seed))
	const sub = 20
	const dt = 1.0 / 60.0
	scale := [3]float64{1.03, 0.98, 1.02}
	q := quat{1, 0, 0, 0}
	f := [3]float64{1.1 + rng.Float64(), 1.7 + rng.Float64(), 2.3 + rng.Float64()}
	rate := func(t float64) [3]float64 {
		if t > seconds-1.5 {
			return [3]float64{}
		}
		return [3]float64{4 * math.Sin(f[0]*t), 5 * math.Sin(f[1]*t+1), 6 * math.Sin(f[2]*t+2)}
	}
	for i := 0; float64(i)*dt < seconds; i++ {
		t := float64(i) * dt
		truth = append(truth, q)
		for s := 0; s < sub; s++ {
			ws := rate(t + (float64(s)+0.5)*dt/sub)
			q = qnormalize(qmul(q, qexp([3]float64{ws[0] * dt / sub, ws[1] * dt / sub, ws[2] * dt / sub})))
		}
		w := rate(t + dt/2)
		var g [3]float64
		for k := 0; k < 3; k++ {
			g[k] = w[k]*scale[k] + 0.005*rng.NormFloat64()
		}
		gyro = append(gyro, g)
	}
	return
}

// clientDriftDeg integrates the output stream like a DSU client and returns the final
// angle (deg) between the client's attitude and the true one.
func clientDriftDeg(useAnchor, lag bool) float64 {
	gyro, truth := simulateHandMotion(60, 3)
	an := newAttitudeAnchor()
	client := truth[0]
	for i := 1; i < len(truth); i++ {
		w := gyro[i-1]                    // rate covering truth[i-1] -> truth[i]
		if lag && i >= 1200 && i < 1230 { // network stall: this rotation never reaches the client
			w = [3]float64{}
		}
		if useAnchor {
			c := an.Correction(w, truth[i-1], 1.0/60)
			for k := 0; k < 3; k++ {
				w[k] += c[k]
			}
		}
		client = qnormalize(qmul(client, qexp([3]float64{w[0] / 60, w[1] / 60, w[2] / 60})))
	}
	return norm3(qlog(qmul(qconj(client), truth[len(truth)-1]))) / alignDegToRad
}

func TestAttitudeAnchorRemovesIntegrationDrift(t *testing.T) {
	raw := clientDriftDeg(false, false)
	anchored := clientDriftDeg(true, false)
	lagged := clientDriftDeg(true, true)
	t.Logf("drift after 60 s: raw gyro %.1f deg, anchored %.1f deg", raw, anchored)
	if raw < 10 {
		t.Fatalf("simulation not demanding enough: raw drift %.1f", raw)
	}
	t.Logf("after a 0.5 s stall that lost rotation: anchored %.1f deg", lagged)
	if lagged > 3 {
		t.Fatalf("stall left a %.1f deg offset, want < 3", lagged)
	}
	if anchored > 3 {
		t.Fatalf("anchored drift %.1f deg, want < 3", anchored)
	}
}

// TestAttitudeAnchorEngagesWithLaggingReference: regression guard for a reference
// that arrives two frames late with jitter (synthetic). The real-world failure of
// the old per-frame engage test is covered by TestAttitudeAnchorEngagesOnRealIPhone.
func TestAttitudeAnchorEngagesWithLaggingReference(t *testing.T) {
	gyro, truth := simulateHandMotion(60, 5)
	rng := rand.New(rand.NewSource(9))
	an := newAttitudeAnchor()
	client := truth[0]
	engagedAt := -1
	for i := 1; i < len(truth); i++ {
		w := gyro[i-1]
		ref := truth[i-1]
		if i >= 3 {
			ref = truth[i-3] // two frames later than the anchor's own one-frame alignment
		}
		jitter := [3]float64{0.004 * rng.NormFloat64(), 0.004 * rng.NormFloat64(), 0.004 * rng.NormFloat64()}
		ref = qnormalize(qmul(ref, qexp(jitter)))
		c := an.Correction(w, ref, 1.0/60)
		if an.mode >= 0 && engagedAt < 0 {
			engagedAt = i
		}
		for k := 0; k < 3; k++ {
			w[k] += c[k]
		}
		client = qnormalize(qmul(client, qexp([3]float64{w[0] / 60, w[1] / 60, w[2] / 60})))
	}
	drift := norm3(qlog(qmul(qconj(client), truth[len(truth)-1]))) / alignDegToRad
	t.Logf("engaged after %.1f s, drift after 60 s: %.2f deg", float64(engagedAt)/60, drift)
	if engagedAt < 0 || engagedAt > 10*60 {
		t.Fatalf("anchor did not engage within 10 s (engagedAt=%d)", engagedAt)
	}
	if drift > 3 {
		t.Fatalf("drift %.2f deg with a lagging reference, want < 3", drift)
	}
}

// TestAttitudeAnchorEngagesOnRealIPhone replays 25 s of a real iPhone recording
// (testdata): the old per-frame engage test never engaged on it (per-frame step
// error 0.33-0.42 > 0.25, because deviceorientation lags the gyro and jitters);
// the windowed test must engage with the right convention (mode 0) and keep the
// heading the anchor tracks close to the phone's own attitude.
func TestAttitudeAnchorEngagesOnRealIPhone(t *testing.T) {
	f, err := os.Open("testdata/iphone_anchor_2026-09-27.csv")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	sfQ := [3][3]float64{{0, 1, 0}, {0, 0, 1}, {1, 0, 0}}
	an := newAttitudeAnchor()
	var prevTs uint64
	engagedAt, frames := -1, 0
	var client quat
	var worst float64
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		if line == "" || line[0] < '0' || line[0] > '9' {
			continue
		}
		p := strings.Split(line, ",")
		ts, _ := strconv.ParseUint(p[0], 10, 64)
		var v [7]float64
		for i := range v {
			v[i], _ = strconv.ParseFloat(p[i+1], 64)
		}
		dt := 1.0 / 60
		if prevTs > 0 && ts > prevTs {
			dt = float64(ts-prevTs) / 1e6
		}
		prevTs = ts
		ref := quat{v[3], v[4], v[5], v[6]}
		dev := mulVec3(transpose3(sfQ), [3]float64{v[0] * alignDegToRad, v[1] * alignDegToRad, v[2] * alignDegToRad})
		if client == (quat{}) {
			client = qnormalize(ref)
		}
		if engagedAt >= 0 {
			worst = math.Max(worst, norm3(qlog(qmul(qconj(client), qnormalize(ref))))/alignDegToRad)
		}
		c := an.Correction(dev, ref, dt)
		if an.mode >= 0 && engagedAt < 0 {
			engagedAt = frames
		}
		client = qnormalize(qmul(client, qexp([3]float64{(dev[0] + c[0]) * dt, (dev[1] + c[1]) * dt, (dev[2] + c[2]) * dt})))
		frames++
	}
	t.Logf("%d frames: engaged after frame %d (mode %d); worst heading gap to iOS once engaged %.1f deg", frames, engagedAt, an.mode, worst)
	if engagedAt < 0 || an.mode != 0 {
		t.Fatalf("anchor not engaged on a real iPhone recording (mode %d)", an.mode)
	}
	if worst > 15 {
		t.Fatalf("heading drifted %.1f deg from the phone's attitude while engaged, want < 15", worst)
	}
}
