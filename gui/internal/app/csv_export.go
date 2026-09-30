package app

import (
	"fmt"
	"os"
	"strings"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// SaveCSVFile opens a native save dialog and writes the telemetry recording there
// (the Stats & 3D screen's "Save .csv"; WebView2 does not reliably save Blob downloads).
// It returns the saved path, or "" when the user cancelled.
func (a *App) SaveCSVFile(defaultName string, content string) (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("context not initialized")
	}
	savePath, err := wailsRuntime.SaveFileDialog(a.ctx, wailsRuntime.SaveDialogOptions{
		DefaultFilename: defaultName,
		Title:           "Save telemetry recording",
		Filters: []wailsRuntime.FileFilter{
			{DisplayName: "CSV (*.csv)", Pattern: "*.csv"},
			{DisplayName: "All files (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil || savePath == "" {
		return "", err
	}
	if !strings.HasSuffix(strings.ToLower(savePath), ".csv") {
		savePath += ".csv"
	}
	if err := os.WriteFile(savePath, []byte(content), 0o644); err != nil {
		return "", err
	}
	return savePath, nil
}
