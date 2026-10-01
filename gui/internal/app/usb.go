package app

import (
	"phonegyro/pkg/server"

	"phonegyro-gui/internal/usbdev"
)

// usbHost connects the USB transport (internal/usbdev) to the USB bank and to
// the same pipeline the phone uses: frames go in through
// server.Server.InjectMotionFrame.
func (a *App) usbHost() usbdev.Host {
	return usbdev.Host{
		Log:     a.logEvent,
		Changed: a.emitStateChange,
		// Optional (protocol Level 3): a device may self-identify. Mirrors the
		// phone's OnClientDevice -- same bank field, same "show it in the UI and
		// the profile's Device column" treatment.
		Name: func(name string) { a.usbBank.deviceName.Store(name) },
		Loss: func(gap int) {
			if a.usbBank != nil {
				a.usbBank.loss.ObserveUSB(gap)
			}
		},
		Motion: func(f server.MotionFrame) {
			if a.srv != nil {
				a.srv.InjectMotionFrame(f)
			}
		},
		// Mirror the phone transport's OnClientDisconnect: clear this bank's
		// connection status so the UI actually falls back to the "waiting for
		// device" screen instead of showing stale connected/frozen telemetry.
		Detached: func(forgetName bool) {
			a.usbBank.hasClient.Store(false)
			a.usbBank.clearConnected()
			if forgetName {
				a.usbBank.deviceName.Store("Controller")
			}
		},
		Status: func(s usbdev.Status) { a.broadcastLiveDebugJSON(s) },
	}
}
