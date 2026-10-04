package app

import (
	"sync"
	"time"

	"phonegyro/pkg/server"

	"phonegyro-gui/internal/motion"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// bindPhoneCallbacks hooks the phone's WebSocket connection lifecycle: connect,
// disconnect (with a grace period for a quick reconnect), page visibility and
// the device model the page reports.
func (a *App) bindPhoneCallbacks(srv *server.Server) {
	var disconnectTimer *time.Timer
	var disconnectMu sync.Mutex

	srv.OnClientConnect = func(remoteAddr string) {
		disconnectMu.Lock()
		if disconnectTimer != nil {
			disconnectTimer.Stop()
			disconnectTimer = nil
		}
		disconnectMu.Unlock()

		// This callback fires only for phone WebSocket connections -- USB has
		// its own separate lifecycle handling in internal/usbdev -- so it always
		// targets phoneBank directly, never activeBank().
		a.phoneBank.hasClient.Store(true)
		a.phoneBank.resetAnchor.Store(true)
		a.clientAddr = remoteAddr
		a.phoneBank.markConnected()
		a.emitStateChange()
		if a.ctx != nil {
			wailsRuntime.EventsEmit(a.ctx, "device:connected", true)
		}
		a.broadcastLiveDebugJSON(map[string]any{
			"type":      "device_status",
			"connected": true,
		})
	}

	srv.OnClientDisconnect = func(remoteAddr string) {
		disconnectMu.Lock()
		defer disconnectMu.Unlock()

		_, clients, _ := srv.PacketStats()
		if clients > 0 {
			return
		}

		// Emit immediate disconnection event for active calibration/monitoring
		if a.ctx != nil {
			wailsRuntime.EventsEmit(a.ctx, "device:connection-lost", true)
		}

		if disconnectTimer != nil {
			disconnectTimer.Stop()
		}
		disconnectTimer = time.AfterFunc(2500*time.Millisecond, func() {
			_, c, _ := srv.PacketStats()
			if c <= 0 {
				a.phoneBank.hasClient.Store(false)
				a.phoneBank.clearConnected()
				a.phoneBank.deviceName.Store("Controller")
				a.emitStateChange()
				if a.ctx != nil {
					wailsRuntime.EventsEmit(a.ctx, "device:disconnected", true)
				}
				a.broadcastLiveDebugJSON(map[string]any{
					"type":      "device_status",
					"connected": false,
				})
			}
		})
	}

	srv.OnClientVisibility = func(visible bool) {
		if a.ctx != nil {
			wailsRuntime.EventsEmit(a.ctx, "device:visibility", visible)
		}
		if !visible && a.silenceDisconnect.Load() {
			srv.DisconnectAllClients()
		}
	}

	srv.OnClientDevice = func(device string) {
		if device != "" {
			a.phoneBank.deviceName.Store(device)
			a.emitStateChange()
			if device == "iPhone" || device == "iPad" {
				a.phoneBank.align.SeedGuess(motion.IOSSensorFrame())
			}
		}
	}
}
