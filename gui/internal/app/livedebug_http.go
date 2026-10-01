package app

import (
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"time"

	"phonegyro/pkg/server"

	"github.com/gorilla/websocket"
)

// serveLiveDebug adds the telemetry WebSocket of the Stats screen
// (js/screens/stats/telemetry.js) to the app's HTTP and HTTPS servers. Those
// servers face the LAN for the phone, so the socket only answers this PC, and
// only the app's own window: a web page open in a browser cannot read it.
func (a *App) serveLiveDebug(srv *server.Server) {
	liveUpgrader := websocket.Upgrader{CheckOrigin: appOrigin}

	registerLiveDebug := func(mux *http.ServeMux) {
		mux.HandleFunc("/livedebug/ws", func(w http.ResponseWriter, r *http.Request) {
			if !loopback(r.RemoteAddr) {
				http.NotFound(w, r)
				return
			}
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

// loopback: the request comes from this PC.
func loopback(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// appOrigin: the WebSocket is opened by the app's WebView2 window (or by
// wails dev on localhost), not by some site in a browser.
func appOrigin(r *http.Request) bool {
	o := r.Header.Get("Origin")
	if o == "" {
		return true
	}
	u, err := url.Parse(o)
	if err != nil {
		return false
	}
	switch u.Hostname() {
	case "wails.localhost", "wails", "localhost", "127.0.0.1", "::1":
		return true
	}
	return false
}
