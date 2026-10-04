package app

import "testing"

// TestUSBHostFeedsTheUSBBank: what the USB transport reports lands in the USB
// bank -- the loss counters (через переполнение SEQ; 1 и 2 потеряны), the device
// name, and the cleared link state after a disconnect.
func TestUSBHostFeedsTheUSBBank(t *testing.T) {
	app := &App{usbBank: newMotionBank()}
	h := app.usbHost()
	for _, gap := range []int{1, 1, 1, 3} {
		h.Loss(gap)
	}
	if _, total, _, lost := app.usbBank.loss.Snapshot(); total != 6 || lost != 2 {
		t.Fatalf("total=%d lost=%d, want 6 and 2", total, lost)
	}

	h.Name("Nano MPU-6050")
	if app.usbBank.deviceName.Load() != "Nano MPU-6050" {
		t.Fatalf("name %v", app.usbBank.deviceName.Load())
	}

	app.usbBank.hasClient.Store(true)
	app.usbBank.markConnected()
	h.Detached(false) // Stop: the name stays
	if app.usbBank.hasClient.Load() || !app.usbBank.connectedSince().IsZero() || app.usbBank.deviceName.Load() != "Nano MPU-6050" {
		t.Fatal("Stop did not clear the link, or forgot the name")
	}
	h.Detached(true) // unplugged
	if app.usbBank.deviceName.Load() != "Controller" {
		t.Fatalf("name after unplugging: %v", app.usbBank.deviceName.Load())
	}
}
