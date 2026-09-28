package link

import "sync"

// Честная статистика потерь канала для карточки «Потери» в Live Debug.
//
// Раньше там считались разрывы в собственном счётчике сообщений Live Debug —
// то есть доставка до окна отладки, а не телефона или USB-пада. Теперь:
//
//   - USB: настоящие потерянные кадры по SEQ прошивки (сюда же попадают кадры,
//     отброшенные по CRC). total — сколько кадров устройство отправило.
//   - Телефон: по TCP пакеты не теряются, а когда сокет занят, страница копит
//     поворот и шлёт один пакет за несколько замеров датчика. merged — замеры,
//     не получившие свой пакет (поворот при этом сохранён, но это прямой признак
//     перегруженного Wi-Fi); lost — замеры, выброшенные при паузе дольше 0.85 с
//     (реальная потеря поворота). total — все замеры датчика.
//
// Счётчики накопительные; окно (последние 60 с) считает страница Live Debug по
// разностям.

type Loss struct {
	mu     sync.Mutex
	kind   string // "usb", "phone" или "" (нет данных: старая страница телефона)
	total  uint64
	merged uint64
	lost   uint64

	// Телефон: предыдущие значения накопительных счётчиков страницы.
	lastEvents, lastDropped uint32
	haveBase                bool
}

// maxPlausibleEvents — больше событий между двумя пакетами (≈ 28 мин при 60 Гц)
// не бывает: это перезагрузка страницы (счётчики начались заново), а не пропуск.
const maxPlausibleEvents = 100_000

// ObserveUSB учитывает кадр USB; gap — расстояние по SEQ от предыдущего кадра
// (1 — без пропусков).
func (l *Loss) ObserveUSB(gap int) {
	if gap < 1 {
		gap = 1
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.kind = "usb"
	l.total += uint64(gap)
	l.lost += uint64(gap - 1)
}

// ObservePhone учитывает пакет телефона с накопительными счётчиками страницы.
func (l *Loss) ObservePhone(events, dropped uint32) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.kind = "phone"
	dE := events - l.lastEvents   // uint32: переполнение счётчика не ломает разность
	dD := dropped - l.lastDropped // выброшенные замеры тоже входят в dE
	if !l.haveBase || dE > maxPlausibleEvents || dD > dE {
		l.lastEvents, l.lastDropped, l.haveBase = events, dropped, true
		return
	}
	l.lastEvents, l.lastDropped = events, dropped
	if dE == 0 {
		return // keep-alive: новых замеров нет
	}
	if carried := dE - dD; carried > 0 {
		l.merged += uint64(carried - 1) // замеры, усреднённые в этот пакет, кроме одного
	}
	l.lost += uint64(dD)
	l.total += uint64(dE)
}

// MarkNoData — источник не сообщает счётчиков (старая страница телефона).
func (l *Loss) MarkNoData() {
	l.mu.Lock()
	l.kind = ""
	l.haveBase = false
	l.mu.Unlock()
}

func (l *Loss) Snapshot() (kind string, total, merged, lost uint64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.kind, l.total, l.merged, l.lost
}
