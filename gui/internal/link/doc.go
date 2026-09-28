// Package link keeps honest statistics of the active input link: frames lost by
// sequence number on USB, merged and lost sensor samples on the phone (loss.go),
// and decides when a real data-loss problem deserves the quiet warning sound
// (alarm.go).
package link
