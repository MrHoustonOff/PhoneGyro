package app

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
	sysw "golang.org/x/sys/windows"
)

// The debug window: PhoneGyro.exe --debugwin --port=N --parent=PID, started by
// the main process (debughub.go). It shows debug.html, which reads the hub's
// event stream; it closes itself when the main process exits.

// DebugWinApp is bound in the debug window process.
type DebugWinApp struct {
	ctx    context.Context
	port   int
	parent int
}

// HubPort is where debug.html finds the event stream.
func (d *DebugWinApp) HubPort() int { return d.port }

// SetOnTop keeps the window above every other one (e.g. over Cemu while playing).
func (d *DebugWinApp) SetOnTop(on bool) {
	if d.ctx != nil {
		wailsRuntime.WindowSetAlwaysOnTop(d.ctx, on)
	}
}

// CloseAndDisable is the window's own close: the debug settings go off in the
// main process, then this window quits.
func (d *DebugWinApp) CloseAndDisable() {
	c := http.Client{Timeout: time.Second}
	if resp, err := c.Post("http://127.0.0.1:"+strconv.Itoa(d.port)+"/disable", "text/plain", nil); err == nil {
		resp.Body.Close()
	}
	if d.ctx != nil {
		wailsRuntime.Quit(d.ctx)
	}
}

// watchParent quits when the main process ends.
func (d *DebugWinApp) watchParent() {
	h, err := sysw.OpenProcess(sysw.SYNCHRONIZE, false, uint32(d.parent))
	if err != nil {
		return
	}
	defer sysw.CloseHandle(h)
	_, _ = sysw.WaitForSingleObject(h, sysw.INFINITE)
	if d.ctx != nil {
		wailsRuntime.Quit(d.ctx)
	}
}

func argInt(name string) int {
	for _, a := range os.Args[1:] {
		if v, ok := strings.CutPrefix(a, "--"+name+"="); ok {
			n, _ := strconv.Atoi(v)
			return n
		}
	}
	return 0
}

func runDebugWindow() {
	d := &DebugWinApp{port: argInt("port"), parent: argInt("parent")}
	err := wails.Run(&options.App{
		Title:            "PhoneGyro Debug",
		Width:            980,
		Height:           720,
		MinWidth:         560,
		MinHeight:        420,
		BackgroundColour: &options.RGBA{R: 0x0b, G: 0x0b, B: 0x0b, A: 0xff},
		AssetServer: &assetserver.Options{
			Assets: assets,
			Middleware: func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if p := strings.TrimPrefix(r.URL.Path, "/"); p == "" || p == "index.html" {
						r.URL.Path = "/debug.html"
					}
					next.ServeHTTP(w, r)
				})
			},
		},
		OnStartup: func(ctx context.Context) {
			d.ctx = ctx
			if d.parent > 0 {
				go d.watchParent()
			}
		},
		OnBeforeClose: func(ctx context.Context) bool {
			go d.CloseAndDisable() // the cross turns the debug settings off
			return false
		},
		SingleInstanceLock: &options.SingleInstanceLock{UniqueId: "phonegyro-debug-window-lock-uuid"},
		Bind:               []interface{}{d},
		Windows: &windows.Options{
			WebviewUserDataPath:  filepath.Join(os.Getenv("APPDATA"), "PhoneGyro", "WebView2_Debug"),
			IsZoomControlEnabled: false,
			Theme:                windows.Dark,
		},
	})
	if err != nil {
		println("Debug window error:", err.Error())
	}
}
