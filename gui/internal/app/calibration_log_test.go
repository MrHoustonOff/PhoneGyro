package app

import (
	"os"
	"path/filepath"
	"testing"
)

// TestWriteDebugCSV_FreshInstall: на чистой установке папки USB-банка ещё нет
// (она появляется при первом сохранении профиля). Шаг калибровки всё равно
// должен попасть в память — от него зависит поправка наклона установки, — и
// журнал должен создаться вместе с папкой.
func TestWriteDebugCSV_FreshInstall(t *testing.T) {
	root := t.TempDir()
	app := &App{profilesDir: root, inputMode: "usb"}
	bank := newMotionBank()
	usbDir := filepath.Join(root, "usb")
	if _, err := os.Stat(usbDir); !os.IsNotExist(err) {
		t.Fatalf("precondition: %s must not exist yet", usbDir)
	}

	samples := []captureSample{{rot: [3]float64{1, 2, 3}, acc: [3]float64{0, -1, 0}}}
	app.writeDebugCSV(bank, 1, samples, CaptureResult{Success: true})

	bank.calLogMu.Lock()
	log, ok := bank.calStepLogs[1]
	bank.calLogMu.Unlock()
	if !ok || len(log.Samples) != 1 || !log.Result.Success {
		t.Fatalf("step log not kept in memory on a fresh install: ok=%v log=%+v", ok, log)
	}
	if _, err := os.Stat(filepath.Join(usbDir, "gyro_debug_capture.csv")); err != nil {
		t.Fatalf("capture CSV not created: %v", err)
	}
}
