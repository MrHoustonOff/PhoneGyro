package app

import (
	"context"
	"math"
	"time"

	"phonegyro/pkg/pairing"

	"phonegyro-gui/internal/link"
	"phonegyro-gui/internal/resmon"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// streamQuat is the 60 Hz orientation stream for the main window's live 3D previews
// (calibration confirm/manual screens). The full AppState (heartbeat) goes out at
// only 15 Hz -- too slow for a 3D model without interpolation, and
// interpolating would add lag on top. Four floats, sent only when changed.
func (a *App) streamQuat(ctx context.Context) {
	ticker := time.NewTicker(16 * time.Millisecond)
	defer ticker.Stop()
	var last [4]uint64
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			bank := a.activeBank()
			if !bank.hasClient.Load() || a.ctx == nil || a.uiHidden.Load() {
				continue
			}
			q := [4]uint64{bank.curAhrsQ0.Load(), bank.curAhrsQ1.Load(), bank.curAhrsQ2.Load(), bank.curAhrsQ3.Load()}
			if q == last {
				continue
			}
			last = q
			wailsRuntime.EventsEmit(a.ctx, "ahrs:quat", map[string]float64{
				"q0": math.Float64frombits(q[0]),
				"q1": math.Float64frombits(q[1]),
				"q2": math.Float64frombits(q[2]),
				"q3": math.Float64frombits(q[3]),
			})
		}
	}
}

// heartbeat sends the state to the UI at 15 Hz (66 ms), drops a phone whose
// sensors went silent or froze, and keeps the Live Debug cube alive between
// motion packets.
func (a *App) heartbeat() {
	ticker := time.NewTicker(66 * time.Millisecond)
	defer ticker.Stop()
	for range ticker.C {
		bank := a.activeBank()
		if bank.hasClient.Load() {
			// Sensor silence & frozen data watchdog (2.0 seconds)
			if a.silenceDisconnect.Load() && a.srv != nil {
				nowMs := time.Now().UnixMilli()
				silenceDuration := nowMs - bank.lastMotionRecvTs.Load()
				frozenDuration := nowMs - bank.lastSensorChangeTs.Load()
				// Grace period of 2 seconds after initial connection
				if time.Since(bank.connectedAt) > 2*time.Second {
					if silenceDuration > 2000 || frozenDuration > 2000 {
						a.srv.DisconnectAllClients()
					}
				}
			}

			a.emitStateChange()
			// Only send fallback heartbeat to 3D window if no live motion packet arrived recently (> 150ms)
			if time.Now().UnixMilli()-bank.lastMotionRecvTs.Load() > 150 {
				q0 := float32(math.Float64frombits(bank.curAhrsQ0.Load()))
				q1 := float32(math.Float64frombits(bank.curAhrsQ1.Load()))
				q2 := float32(math.Float64frombits(bank.curAhrsQ2.Load()))
				q3 := float32(math.Float64frombits(bank.curAhrsQ3.Load()))
				a.liveDebugMu.RLock()
				numDebug := len(a.liveDebugClients)
				a.liveDebugMu.RUnlock()
				if numDebug > 0 {
					var inHz float64
					if a.srv != nil {
						_, _, inHz = a.srv.PacketStats()
					}
					a.broadcastLiveDebug(q0, q1, q2, q3, liveDebugMsg{
						InHz: inHz,
					})
				}
			}
		}
	}
}

// watchLinkLoss: тихий звук при сильной потере данных (link/alarm.go): решение по настоящим
// счётчикам канала активного источника, звук играет фронтенд ("link:loss").
func (a *App) watchLinkLoss(ctx context.Context) {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	var alarm link.Alarm
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			bank := a.activeBank()
			kind, total, merged, lost := bank.loss.Snapshot()
			active := bank.hasClient.Load() && !a.isPaused.Load()
			var connectedFor time.Duration
			if at := bank.connectedAt; !at.IsZero() {
				connectedFor = now.Sub(at)
			}
			if reason, ok := alarm.Check(now, active, connectedFor, kind, total, merged, lost); ok {
				a.logEvent("WARN", "link: heavy data loss (%s)", reason)
				if a.ctx != nil {
					wailsRuntime.EventsEmit(a.ctx, "link:loss", reason)
				}
			}
		}
	}
}

// startResourceMonitor samples the process CPU / RAM for the UI.
func (a *App) startResourceMonitor() {
	a.stopResmon = resmon.RunLoop(1500*time.Millisecond, func(s resmon.Stats) {
		ramPercent := 0.0
		if s.TotalRAMBytes > 0 {
			ramPercent = (float64(s.RAMBytes) / float64(s.TotalRAMBytes)) * 100.0
		}
		statsPayload := map[string]any{
			"cpuPercent": s.CPUPercent,
			"ramMb":      float64(s.RAMBytes) / (1024 * 1024),
			"totalRamMb": float64(s.TotalRAMBytes) / (1024 * 1024),
			"ramPercent": ramPercent,
		}
		a.lastResStats.Store(&statsPayload)
		if a.ctx != nil {
			wailsRuntime.EventsEmit(a.ctx, "resource-stats", statsPayload)
		}
	})
}

// watchNetwork follows the primary IP (detects DHCP updates, USB tethering, or Wi-Fi reconnects)
func (a *App) watchNetwork() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		lanIPs := pairing.GetLocalIPv4s()
		if len(lanIPs) == 0 {
			continue
		}
		newPrimary := pairing.GetPrimaryIP(lanIPs)
		if newPrimary != "" && newPrimary != a.primaryIP {
			a.primaryIP = newPrimary
			a.rebuildURLsAndQRCodes()
			if a.caMgr != nil {
				a.caMgr.AddHostIPs(lanIPs)
			}
			a.emitStateChange()
			if a.ctx != nil {
				wailsRuntime.EventsEmit(a.ctx, "network:ip-changed", newPrimary)
			}
			a.logEvent("INFO", "Network adapter change detected: primary IP updated to %s", newPrimary)
		}
	}
}
