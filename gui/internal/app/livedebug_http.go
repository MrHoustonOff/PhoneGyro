package app

import (
	"encoding/json"
	"io/fs"
	"math"
	"net/http"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"

	"phonegyro/pkg/server"

	"github.com/gorilla/websocket"
)

// serveLiveDebug adds the Live Debug window's routes to the app's HTTP and
// HTTPS servers: its page and files, status/theme/lang/font-scale/recenter
// endpoints, and the telemetry WebSocket.
func (a *App) serveLiveDebug(srv *server.Server) {
	subFS, err := fs.Sub(assets, "frontend/src")
	if err == nil {
		liveUpgrader := websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		}

		registerLiveDebug := func(mux *http.ServeMux) {
			// Files the Live Debug page loads by relative path, for the browser
			// fallback of OpenLiveDebugWindow (the --livedebug window serves them from
			// its own asset server). Without /js/ and /css/ the page loads bare.
			files := http.FileServer(http.FS(subFS))
			mux.Handle("/assets/", files)
			mux.Handle("/js/", files)
			mux.Handle("/css/", files)
			mux.Handle("/main.css", files)
			mux.Handle("/livedebug/assets/", http.StripPrefix("/livedebug", files))
			mux.HandleFunc("/livedebug", func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Access-Control-Allow-Origin", "*")
				w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "*")
				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusOK)
					return
				}
				data, err := fs.ReadFile(subFS, "livedebug.html")
				if err != nil {
					http.Error(w, "Not found", http.StatusNotFound)
					return
				}
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
				w.WriteHeader(http.StatusOK)
				w.Write(data)
			})
			mux.HandleFunc("/livedebug/", func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Access-Control-Allow-Origin", "*")
				w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "*")
				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusOK)
					return
				}
				if r.URL.Path == "/livedebug/" {
					data, err := fs.ReadFile(subFS, "livedebug.html")
					if err != nil {
						http.Error(w, "Not found", http.StatusNotFound)
						return
					}
					w.Header().Set("Content-Type", "text/html; charset=utf-8")
					w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
					w.WriteHeader(http.StatusOK)
					w.Write(data)
					return
				}
				http.NotFound(w, r)
			})
			mux.HandleFunc("/livedebug/ping", func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Access-Control-Allow-Origin", "*")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "*")
				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusOK)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				w.Write([]byte(`{"status":"ok"}`))
			})
			mux.HandleFunc("/livedebug/recenter", func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Access-Control-Allow-Origin", "*")
				w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "*")
				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusOK)
					return
				}
				if r.Method == http.MethodPost {
					a.ResetAHRS()
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				w.Write([]byte(`{"status":"ok"}`))
			})
			mux.HandleFunc("/livedebug/theme", func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Access-Control-Allow-Origin", "*")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "*")
				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusOK)
					return
				}
				val := r.URL.Query().Get("value")
				if val != "" {
					a.SetTheme(val)
				}
				a.themeMu.RLock()
				curT := a.currentTheme
				a.themeMu.RUnlock()
				if curT == "" {
					curT = "dark"
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				_ = json.NewEncoder(w).Encode(map[string]string{"theme": curT})
			})
			mux.HandleFunc("/livedebug/lang", func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Access-Control-Allow-Origin", "*")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "*")
				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusOK)
					return
				}
				val := r.URL.Query().Get("value")
				if val != "" {
					a.SetLang(val)
				}
				a.themeMu.RLock()
				curL := a.currentLang
				a.themeMu.RUnlock()
				if curL == "" {
					curL = "ru"
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				_ = json.NewEncoder(w).Encode(map[string]string{"lang": curL})
			})
			mux.HandleFunc("/livedebug/font-scale", func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Access-Control-Allow-Origin", "*")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "*")
				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusOK)
					return
				}
				val := r.URL.Query().Get("value")
				if val != "" {
					if scale, err := strconv.ParseFloat(val, 64); err == nil && scale >= 0.70 && scale <= 1.60 {
						a.SetFontScale(scale)
					}
				}
				curS := math.Float64frombits(a.fontScaleBits.Load())
				if curS < 0.70 || curS > 1.60 {
					curS = 1.00
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				_ = json.NewEncoder(w).Encode(map[string]float64{"fontScale": curS})
			})
			mux.HandleFunc("/livedebug/status", func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Access-Control-Allow-Origin", "*")
				w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "*")
				w.Header().Set("Access-Control-Allow-Private-Network", "true")
				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusOK)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				var dsuClients []DSUClientView
				dsuCount := 0
				if a.dsuSrv != nil {
					dsuClients = a.dsuClientViews()
					dsuCount = len(dsuClients)
				}
				_ = json.NewEncoder(w).Encode(map[string]any{
					"device_connected": a.activeBank().hasClient.Load(),
					"dsu_clients":      dsuCount,
					"dsu_client_list":  dsuClients,
				})
			})
			mux.HandleFunc("/livedebug/show-in-folder", func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Access-Control-Allow-Origin", "*")
				filePath := r.URL.Query().Get("path")
				if filePath != "" {
					go func() {
						_ = exec.Command("explorer.exe", "/select,", filepath.Clean(filePath)).Start()
					}()
				}
				w.WriteHeader(http.StatusOK)
			})
			mux.HandleFunc("/livedebug/ws", func(w http.ResponseWriter, r *http.Request) {
				conn, err := liveUpgrader.Upgrade(w, r, nil)
				if err != nil {
					return
				}

				// Send immediate initial theme, language, and device connection sync frame
				a.themeMu.RLock()
				curT := a.currentTheme
				curL := a.currentLang
				a.themeMu.RUnlock()
				if curT == "" {
					curT = "dark"
				}
				if curL == "" {
					curL = "ru"
				}
				var dsuClients []DSUClientView
				dsuCount := 0
				if a.dsuSrv != nil {
					dsuClients = a.dsuClientViews()
					dsuCount = len(dsuClients)
				}
				syncBytes, _ := json.Marshal(map[string]any{
					"type":             "sync",
					"theme":            curT,
					"lang":             curL,
					"device_connected": a.activeBank().hasClient.Load(),
					"dsu_clients":      dsuCount,
					"dsu_client_list":  dsuClients,
				})

				a.liveDebugMu.Lock()
				if a.liveDebugClients == nil {
					a.liveDebugClients = make(map[*websocket.Conn]struct{})
				}
				_ = conn.SetWriteDeadline(time.Now().Add(100 * time.Millisecond))
				_ = conn.WriteMessage(websocket.TextMessage, syncBytes)
				a.liveDebugClients[conn] = struct{}{}
				a.liveDebugMu.Unlock()

				go func(c *websocket.Conn) {
					defer func() {
						a.liveDebugMu.Lock()
						delete(a.liveDebugClients, c)
						a.liveDebugMu.Unlock()
						c.Close()
					}()

					for {
						_, msgBytes, err := c.ReadMessage()
						if err != nil {
							break
						}
						var req map[string]string
						if json.Unmarshal(msgBytes, &req) == nil {
							if req["action"] == "recenter" {
								a.ResetAHRS()
							}
						}
					}
				}(conn)
			})
		}

		registerLiveDebug(srv.HTTPMux)
		registerLiveDebug(srv.HTTPSMux)
	}
}
