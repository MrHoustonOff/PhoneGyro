package main

import "time"

// Тихий звук при сильной потере данных (звук «loss» в микшере настроек).
//
// Решение принимается по настоящим счётчикам канала (linkloss.go) за скользящее
// окно, а не по одному событию, и с защитой от ложных срабатываний:
//   - USB: потеряно ≥ 5% кадров и не меньше 10 штук (единичный сбой CRC — не повод);
//   - телефон: была настоящая потеря поворота (пауза связи > 0.85 с) или ≥ 60%
//     замеров датчика пришли склеенными (Wi-Fi не успевает, движение дёргается);
//   - не раньше чем через 3 с после подключения (переходные процессы), не на
//     паузе, не чаще раза в 15 с. Полное отключение — это другой звук.

const (
	lossWindow        = 3 * time.Second
	lossGrace         = 3 * time.Second
	lossCooldown      = 15 * time.Second
	lossMinSpan       = time.Second // окно короче этого ещё не показательно
	lossUSBMinLost    = 10
	lossUSBMinRatio   = 0.05
	lossPhoneMinTotal = 60 // ~1 с замеров при 60 Гц
	lossPhoneMerged   = 0.60
)

type lossSnap struct {
	t                   time.Time
	total, merged, lost uint64
}

type lossAlarm struct {
	kind      string
	hist      []lossSnap
	lastAlert time.Time
}

// check вызывается периодически. active — источник подключён и вывод не на
// паузе; connectedFor — сколько он уже подключён. Возвращает причину ("usb" /
// "phone_lost" / "phone_merged") и true, когда пора подать звук.
func (d *lossAlarm) check(now time.Time, active bool, connectedFor time.Duration,
	kind string, total, merged, lost uint64) (string, bool) {
	if !active || kind == "" || connectedFor < lossGrace {
		d.hist = d.hist[:0]
		return "", false
	}
	if kind != d.kind || (len(d.hist) > 0 && total < d.hist[len(d.hist)-1].total) {
		d.kind = kind
		d.hist = d.hist[:0] // другой источник или счётчики начались заново
	}
	d.hist = append(d.hist, lossSnap{now, total, merged, lost})
	for len(d.hist) > 1 && now.Sub(d.hist[0].t) > lossWindow {
		d.hist = d.hist[1:]
	}
	base := d.hist[0]
	if now.Sub(base.t) < lossMinSpan {
		return "", false
	}
	dTotal, dMerged, dLost := total-base.total, merged-base.merged, lost-base.lost

	reason := ""
	switch kind {
	case "usb":
		if dLost >= lossUSBMinLost && float64(dLost) >= lossUSBMinRatio*float64(dTotal) {
			reason = "usb"
		}
	case "phone":
		if dLost > 0 {
			reason = "phone_lost"
		} else if dTotal >= lossPhoneMinTotal && float64(dMerged) >= lossPhoneMerged*float64(dTotal) {
			reason = "phone_merged"
		}
	}
	if reason == "" {
		return "", false
	}
	// Одно и то же ухудшение не должно звучать повторно: окно начинается заново.
	d.hist = d.hist[:0]
	if !d.lastAlert.IsZero() && now.Sub(d.lastAlert) < lossCooldown {
		return "", false
	}
	d.lastAlert = now
	return reason, true
}
