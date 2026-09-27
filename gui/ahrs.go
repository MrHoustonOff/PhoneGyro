package main

import (
	"math"
	"sync"
)

// AHRS — комплементарный фильтр ориентации на SO(3) (схема Mahony, P-звено):
// гироскоп интегрируется точной экспонентой, акселерометр подтягивает только
// наклон (pitch/roll) через векторное произведение «измеренный верх × оценка верха».
//
// Полный перенос из M:\00_Coding\00_Projects\тема (песочница, где алгоритм был
// найден, воспроизведён на реальных логах и проверен вживую против PadTest) —
// заменяет прежний "Madgwick из PadTest". Почему:
//
//  1. Главная причина «залипания» ориентации после резкого движения — ЗЕРКАЛЬНАЯ
//     конвенция гироскопа. Старый маппинг gx,gy,gz = -rotX,-rotY,-rotZ имеет
//     неверную хиральность: инверсия всех трёх осей — это отражение (det=-1), а
//     не поворот, и при интегрировании последовательных поворотов они складываются
//     в обратном порядке. Для одноосевых движений это незаметно, а после сложного
//     движения «туда-обратно» ошибка не сходится: чистое интегрирование гироскопа
//     по реальным логам с резким поворотом давало 38-40° вместо нуля. С физически
//     согласованным маппингом ω = (+rotX, -rotY, -rotZ) те же данные замыкаются в
//     2-5° — и именно этот маппинг совпадает с акселерометром (подобран перебором
//     всех 48 вариантов знаков/перестановок, а не угадан). Yaw акселерометр
//     исправить не может в принципе — это физика, не баг.
//  2. Старый градиент Madgwick нормализовался до единичного вектора перед
//     умножением на beta, поэтому коррекция всегда била на полную мощность
//     (~2·beta) даже когда реальная ошибка ориентации уже ничтожна — в покое это
//     давало постоянный паразитный "пинок" в случайную сторону (шум акселерометра,
//     а не сигнал). Комплементарный фильтр ниже использует некалиброванную
//     (не нормированную) ошибку e = u×v, чья величина = sin(угла ошибки) и сама
//     стремится к нулю — никакого пинка в покое по построению.
//
// Кадр тела здесь = кадр вывода DSU (как приходит rotX/Y/Z, accX/Y/Z), мир — Y
// вверх. Наружу отдаём тот же контракт: вход (rotX/Y/Z в °/с, accX/Y/Z в g, dt в
// секундах) → кватернион [Q0,Q1,Q2,Q3].
type AHRS struct {
	mu sync.Mutex
	Q0 float32
	Q1 float32
	Q2 float32
	Q3 float32

	// Коэффициенты коррекции наклона, 1/с (≈ 1/постоянная времени).
	KpStill float32 // когда пад почти неподвижен — быстро возвращаемся к истине
	KpMove  float32 // во время движения — акселерометру (с центробежкой) верим меньше

	initialized bool

	// Диагностика последнего Update() — на будущее, для подробных логов/дебага.
	LastDt            float32
	LastEffectiveBeta float32 // фактически применённый Kp, 1/с
	LastOmegaMagDeg   float32 // |ω после коррекции| в °/с
}

const (
	ahrsStillRateDeg = 20.0 // ниже этой скорости поворота считаем пад «почти неподвижным»
	ahrsAccTolerance = 0.25 // | |acc|-1g | при котором доверие к акселерометру падает до нуля
	ahrsDeg2Rad      = math.Pi / 180.0
)

// NewAHRS создаёт фильтр в единичной ориентации с параметрами коррекции,
// подобранными и проверенными в песочнице "тема" (не угадано, не тронуто).
func NewAHRS() *AHRS {
	return &AHRS{Q0: 1, KpStill: 2.0, KpMove: 0.3}
}

// Reset resets the filter to identity orientation.
func (m *AHRS) Reset() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Q0, m.Q1, m.Q2, m.Q3 = 1, 0, 0, 0
	m.initialized = false
}

// Update: rotX/Y/Z в °/с (DSU: Pitch/Yaw/Roll), accX/Y/Z в g, dt — реальный
// измеренный интервал в секундах с прошлого пакета (считается у вызывающего
// кода из таймстампа пакета, см. app.go).
func (m *AHRS) Update(rotX, rotY, rotZ, accX, accY, accZ, dt float32) (float32, float32, float32, float32) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Угловая скорость в кадре тела (правая тройка, см. комментарий к типу).
	gx := float64(rotX) * ahrsDeg2Rad
	gy := -float64(rotY) * ahrsDeg2Rad
	gz := -float64(rotZ) * ahrsDeg2Rad

	// DSU acc — направление гравитации (лежащий пад: accY=-1), «верх» = -acc.
	ux, uy, uz := -float64(accX), -float64(accY), -float64(accZ)
	accNorm := math.Sqrt(ux*ux + uy*uy + uz*uz)

	w, x, y, z := float64(m.Q0), float64(m.Q1), float64(m.Q2), float64(m.Q3)

	// Первый кадр: сразу ставим наклон по акселерометру (yaw = 0), чтобы вьюер
	// с первого пакета совпадал с падом, а не «приезжал» из единичной ориентации.
	if !m.initialized && accNorm > 0.5 && accNorm < 1.5 {
		w, x, y, z = quatFromUp(ux/accNorm, uy/accNorm, uz/accNorm)
		m.initialized = true
		m.store(w, x, y, z)
		m.LastDt, m.LastEffectiveBeta, m.LastOmegaMagDeg = dt, 0, 0
		return m.Q0, m.Q1, m.Q2, m.Q3
	}

	rawRateDeg := math.Sqrt(gx*gx+gy*gy+gz*gz) / ahrsDeg2Rad

	var kp float64
	if accNorm > 1e-3 {
		// Доверие к акселерометру: 1 при |acc|=1g, линейно до 0 при отклонении accTolerance.
		trust := 1 - math.Abs(accNorm-1)/ahrsAccTolerance
		if trust < 0 {
			trust = 0
		}
		// Плавный переход KpMove → KpStill по мере успокоения гироскопа.
		still := 1 - rawRateDeg/ahrsStillRateDeg
		if still < 0 {
			still = 0
		}
		kp = trust * (float64(m.KpMove) + (float64(m.KpStill)-float64(m.KpMove))*still)

		if kp > 0 {
			ux, uy, uz = ux/accNorm, uy/accNorm, uz/accNorm
			// Оценка «верха» в кадре тела: R(q)^T · (0,1,0).
			vx := 2 * (x*y + w*z)
			vy := 1 - 2*(x*x+z*z)
			vz := 2 * (y*z - w*x)
			// Ошибка e = u × v; её модуль = sin(угла ошибки), т.е. в покое → 0,
			// никакого постоянного пинка шумом, как было с нормированным градиентом.
			ex := uy*vz - uz*vy
			ey := uz*vx - ux*vz
			ez := ux*vy - uy*vx
			// Ошибка > 90°: sin начинает убывать — не даём коррекции ослабнуть.
			if ux*vx+uy*vy+uz*vz < 0 {
				if en := math.Sqrt(ex*ex + ey*ey + ez*ez); en > 1e-9 {
					ex, ey, ez = ex/en, ey/en, ez/en
				}
			}
			gx += kp * ex
			gy += kp * ey
			gz += kp * ez
		}
	}

	m.LastDt = dt
	m.LastEffectiveBeta = float32(kp)
	omega := math.Sqrt(gx*gx + gy*gy + gz*gz)
	m.LastOmegaMagDeg = float32(omega / ahrsDeg2Rad)

	// Точный шаг на группе: q ← q ⊗ exp(ω·dt/2), ω в кадре тела.
	if omega > 1e-9 && dt > 0 {
		half := omega * float64(dt) * 0.5
		s := math.Sin(half) / omega
		dw, dx, dy, dz := math.Cos(half), gx*s, gy*s, gz*s
		w, x, y, z = w*dw-x*dx-y*dy-z*dz,
			w*dx+x*dw+y*dz-z*dy,
			w*dy-x*dz+y*dw+z*dx,
			w*dz+x*dy-y*dx+z*dw
		m.store(w, x, y, z)
	}

	return m.Q0, m.Q1, m.Q2, m.Q3
}

func (m *AHRS) store(w, x, y, z float64) {
	n := math.Sqrt(w*w + x*x + y*y + z*z)
	if n < 1e-9 {
		return
	}
	if w < 0 { // один и тот же поворот — держим w ≥ 0, чтобы лог не прыгал знаком
		n = -n
	}
	m.Q0, m.Q1, m.Q2, m.Q3 = float32(w/n), float32(x/n), float32(y/n), float32(z/n)
}

// quatFromUp — ориентация тело→мир по одной гравитации (старт и «Центрировать»):
// «верх» тела u переходит в мировой Y, а курс выбирается так, чтобы туда, куда
// смотрит пад (его ось вперёд, −Z тела, спроецированная на горизонт), смотрел и
// мировой −Z. Раньше брался минимальный поворот u→Y: при наклоне сразу по двум
// осям он добавлял лишний поворот вокруг вертикали, и после возврата пада в
// ровное положение модель оставалась развёрнутой (8° при 30°+30°, 27° при
// 60°+45°). Если ось вперёд почти вертикальна, курс не определён — тогда
// остаётся минимальный поворот.
func quatFromUp(ux, uy, uz float64) (w, x, y, z float64) {
	// Горизонтальная проекция оси вперёд тела f = (0,0,-1): h = f - (f·u)u.
	hx, hy, hz := uz*ux, uz*uy, -1+uz*uz
	if hn := math.Sqrt(hx*hx + hy*hy + hz*hz); hn > 0.2 {
		hx, hy, hz = hx/hn, hy/hn, hz/hn
		// Строки матрицы тело→мир — мировые оси в координатах тела:
		// Y = u, Z = −h, X = Y × Z.
		zx, zy, zz := -hx, -hy, -hz
		xx, xy, xz := uy*zz-uz*zy, uz*zx-ux*zz, ux*zy-uy*zx
		return quatFromRows([3][3]float64{{xx, xy, xz}, {ux, uy, uz}, {zx, zy, zz}})
	}
	// q = (1 + u·Y, u × Y), нормируется в store(); u × Y = (-uz, 0, ux).
	w, x, y, z = 1+uy, -uz, 0, ux
	if w < 1e-6 { // вверх ногами: 180° вокруг X
		return 0, 1, 0, 0
	}
	n := math.Sqrt(w*w + x*x + z*z)
	return w / n, x / n, 0, z / n
}

// quatFromRows — кватернион (w,x,y,z) поворота с матрицей m (тело→мир).
func quatFromRows(m [3][3]float64) (w, x, y, z float64) {
	tr := m[0][0] + m[1][1] + m[2][2]
	switch {
	case tr > 0:
		s := math.Sqrt(tr+1) * 2
		w, x, y, z = s/4, (m[2][1]-m[1][2])/s, (m[0][2]-m[2][0])/s, (m[1][0]-m[0][1])/s
	case m[0][0] > m[1][1] && m[0][0] > m[2][2]:
		s := math.Sqrt(1+m[0][0]-m[1][1]-m[2][2]) * 2
		w, x, y, z = (m[2][1]-m[1][2])/s, s/4, (m[0][1]+m[1][0])/s, (m[0][2]+m[2][0])/s
	case m[1][1] > m[2][2]:
		s := math.Sqrt(1+m[1][1]-m[0][0]-m[2][2]) * 2
		w, x, y, z = (m[0][2]-m[2][0])/s, (m[0][1]+m[1][0])/s, s/4, (m[1][2]+m[2][1])/s
	default:
		s := math.Sqrt(1+m[2][2]-m[0][0]-m[1][1]) * 2
		w, x, y, z = (m[1][0]-m[0][1])/s, (m[0][2]+m[2][0])/s, (m[1][2]+m[2][1])/s, s/4
	}
	if w < 0 {
		w, x, y, z = -w, -x, -y, -z
	}
	return
}

// GetEulerAngles returns pitch, roll, yaw in degrees from the AHRS quaternion.
// Кадр AHRS (см. комментарий к типу): X вправо, Y вверх, Z к пользователю;
// пад лежит экраном вверх. Знаки -- те, что ждёт LEVEL-HUD (index.html,
// startInclinometerLoop) и остальной UI (закреплено в TestEulerSigns):
//   Pitch > 0: наклон вперёд (дальний край вниз)   -> шарик вверх
//   Roll  > 0: наклон вправо (правый край вниз)    -> шарик вправо
//   Yaw   > 0: поворот по часовой (вид сверху)     -> стрелка вправо
// Поворот +θ вокруг X поднимает дальний край, а +θ вокруг Y -- это против
// часовой при взгляде сверху, поэтому у pitch и yaw знак минус.
func (m *AHRS) GetEulerAngles() (pitch, roll, yaw float64) {
	m.mu.Lock()
	q0, q1, q2, q3 := float64(m.Q0), float64(m.Q1), float64(m.Q2), float64(m.Q3)
	m.mu.Unlock()

	sq1 := q1 * q1
	sq2 := q2 * q2
	sq3 := q3 * q3

	const rad2deg = 180.0 / math.Pi

	pitchSin := 2.0 * (q0*q1 - q2*q3)
	pitch = -math.Asin(math.Max(-1.0, math.Min(1.0, pitchSin))) * rad2deg

	roll = -math.Atan2(2.0*(q0*q3+q1*q2), 1.0-2.0*(sq1+sq3)) * rad2deg

	yaw = -math.Atan2(2.0*(q0*q2+q1*q3), 1.0-2.0*(sq1+sq2)) * rad2deg

	return pitch, roll, yaw
}
