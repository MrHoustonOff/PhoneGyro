package server

import (
	"sync"
	"time"
)

// Real round-trip time of the phone link, measured with the keepalive the
// server already runs: it sends "PING" (text frame) and the page answers "PONG"
// right away. A WebSocket is one ordered TCP stream, so every PONG answers the
// oldest PING still unanswered — a FIFO of send times is enough, no protocol
// change. The PONG travels in the same queue as the telemetry, so the RTT
// includes whatever queueing the sensor frames experience too.

// maxOutstandingPings: more unanswered pings than this means the link is dead
// or the page stopped answering; the FIFO is dropped rather than risk pairing a
// late PONG with the wrong PING.
const maxOutstandingPings = 16

type linkRTT struct {
	mu   sync.Mutex
	sent []time.Time // send times of unanswered PINGs, oldest first
	last time.Duration
	have bool
}

func (l *linkRTT) pingSent(now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.sent) >= maxOutstandingPings {
		l.sent = l.sent[:0]
		l.have = false
	}
	l.sent = append(l.sent, now)
}

func (l *linkRTT) pongReceived(now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.sent) == 0 {
		return // unsolicited or from before a reset: nothing to pair it with
	}
	l.last = now.Sub(l.sent[0])
	l.have = true
	l.sent = l.sent[1:]
}

// value returns the current RTT and whether one is known. While a PING is
// overdue, the time it has already waited is a lower bound of the RTT: report
// that instead of a stale value, so a stall shows as rising latency right away.
func (l *linkRTT) value(now time.Time) (time.Duration, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	rtt, ok := l.last, l.have
	if len(l.sent) > 0 {
		if age := now.Sub(l.sent[0]); age > rtt && (ok || age > time.Second) {
			rtt, ok = age, true
		}
	}
	return rtt, ok
}

// LinkRTT returns the round-trip time of the most recently connected phone
// WebSocket, or false when no phone is connected or nothing is measured yet.
func (s *Server) LinkRTT() (time.Duration, bool) {
	l := s.rtt.Load()
	if l == nil {
		return 0, false
	}
	return l.value(time.Now())
}
