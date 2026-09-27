package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestLinkRTT_FIFOPairing(t *testing.T) {
	var l linkRTT
	t0 := time.Unix(0, 0)
	l.pingSent(t0)
	l.pingSent(t0.Add(1 * time.Second))
	// Replies come back in order: first PONG answers the first PING.
	l.pongReceived(t0.Add(40 * time.Millisecond))
	if rtt, ok := l.value(t0.Add(40 * time.Millisecond)); !ok || rtt != 40*time.Millisecond {
		t.Fatalf("first RTT %v %v, want 40ms", rtt, ok)
	}
	l.pongReceived(t0.Add(1*time.Second + 12*time.Millisecond))
	if rtt, ok := l.value(t0.Add(1*time.Second + 12*time.Millisecond)); !ok || rtt != 12*time.Millisecond {
		t.Fatalf("second RTT %v %v, want 12ms", rtt, ok)
	}
}

func TestLinkRTT_NothingBeforeFirstPong(t *testing.T) {
	var l linkRTT
	t0 := time.Unix(0, 0)
	if _, ok := l.value(t0); ok {
		t.Fatal("RTT reported with nothing measured")
	}
	l.pingSent(t0)
	// A normal in-flight PING is not an RTT yet.
	if _, ok := l.value(t0.Add(30 * time.Millisecond)); ok {
		t.Fatal("in-flight ping reported as RTT")
	}
	// But one overdue for over a second is at least that slow.
	if rtt, ok := l.value(t0.Add(1500 * time.Millisecond)); !ok || rtt != 1500*time.Millisecond {
		t.Fatalf("overdue first ping: %v %v, want 1.5s lower bound", rtt, ok)
	}
}

func TestLinkRTT_StallShowsRisingLatency(t *testing.T) {
	var l linkRTT
	t0 := time.Unix(0, 0)
	l.pingSent(t0)
	l.pongReceived(t0.Add(10 * time.Millisecond))
	l.pingSent(t0.Add(time.Second))
	// Wi-Fi stall: the second PONG is 300 ms late. Report the wait, not the stale 10 ms.
	if rtt, _ := l.value(t0.Add(time.Second + 300*time.Millisecond)); rtt != 300*time.Millisecond {
		t.Fatalf("during stall: %v, want 300ms", rtt)
	}
	// Still a fresh ping in flight shorter than last RTT: the measured value stands.
	l.pongReceived(t0.Add(time.Second + 320*time.Millisecond))
	l.pingSent(t0.Add(2 * time.Second))
	if rtt, _ := l.value(t0.Add(2*time.Second + 5*time.Millisecond)); rtt != 320*time.Millisecond {
		t.Fatalf("after stall: %v, want the measured 320ms", rtt)
	}
}

func TestLinkRTT_UnansweredOverflowResets(t *testing.T) {
	var l linkRTT
	t0 := time.Unix(0, 0)
	l.pingSent(t0)
	l.pongReceived(t0.Add(5 * time.Millisecond))
	for i := 0; i < maxOutstandingPings; i++ {
		l.pingSent(t0.Add(time.Duration(i+1) * time.Second))
	}
	l.pingSent(t0.Add(time.Duration(maxOutstandingPings+1) * time.Second)) // overflow -> reset
	l.pongReceived(t0.Add(time.Duration(maxOutstandingPings+1)*time.Second + 7*time.Millisecond))
	if rtt, ok := l.value(t0.Add(time.Duration(maxOutstandingPings+1)*time.Second + 7*time.Millisecond)); !ok || rtt != 7*time.Millisecond {
		t.Fatalf("after overflow reset: %v %v, want 7ms", rtt, ok)
	}
	// An unsolicited PONG with an empty FIFO is ignored.
	l.pongReceived(t0.Add(100 * time.Second))
	if rtt, _ := l.value(t0.Add(100 * time.Second)); rtt != 7*time.Millisecond {
		t.Fatalf("unsolicited pong changed RTT to %v", rtt)
	}
}

// TestLinkRTT_OverRealWebSocket: настоящий WebSocket, клиент отвечает на PING
// с задержкой 25 мс — сервер должен намерить RTT около этого значения, а после
// отключения перестать что-либо сообщать.
func TestLinkRTT_OverRealWebSocket(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", srv.handleWebSocket)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	const replyDelay = 25 * time.Millisecond
	go func() {
		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if string(msg) == "PING" {
				time.Sleep(replyDelay)
				_ = conn.WriteMessage(websocket.TextMessage, []byte("PONG"))
			}
		}
	}()

	deadline := time.Now().Add(3 * time.Second)
	var rtt time.Duration
	var ok bool
	for time.Now().Before(deadline) {
		if rtt, ok = srv.LinkRTT(); ok {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !ok || rtt < replyDelay || rtt > replyDelay+50*time.Millisecond {
		t.Fatalf("measured RTT %v (ok=%v), want ~%v", rtt, ok, replyDelay)
	}
	t.Logf("намеренный RTT: %v (клиент отвечал через %v)", rtt, replyDelay)

	conn.Close()
	time.Sleep(200 * time.Millisecond)
	if _, ok := srv.LinkRTT(); ok {
		t.Fatal("RTT still reported after the phone disconnected")
	}
}
