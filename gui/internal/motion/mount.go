package motion

import "math"

// Поправка на наклон установки датчика — ТОЛЬКО для USB-контроллеров.
//
// У самодельного USB-пада плата с IMU может стоять в корпусе под углом. Тогда
// оси датчика не совпадают с осями корпуса, и страдают две вещи:
//   - нейтраль: лежащий ровно пад читается как наклонённый;
//   - оси гироскопа: горизонтальный поворот частично уходит в pitch/roll
//     (≈ sin(угла), при 8° это ~14%) — прицел гироскопом уходит по диагонали.
//
// Лечится одним постоянным поворотом R, применённым ОДИНАКОВО к гироскопу и
// акселерометру (так их согласованность — то, на что опираются AHRS в PadTest,
// играх и наш ahrs.go — сохраняется). Сдвигать акселерометр константой нельзя:
// это верно только в одной позе и ломает согласованность с гироскопом.
//
// Откуда берём R:
//   - наклон (2 угла) — из гравитации шага покоя калибровки: R — минимальный
//     поворот, переводящий «верх» датчика в мировой Y. Поворот вокруг вертикали
//     R не вносит: жесты руки слишком неточны, чтобы его честно измерить
//     (на реальных USB-логах ось жеста «крен» гуляла на 2-15° между сессиями);
//   - проверка — ось жеста «вперёд» (вращение вокруг X корпуса). X корпуса в
//     покое горизонтален, значит эта ось должна быть перпендикулярна гравитации
//     покоя. Если наклон — настоящий наклон установки, так и будет (на реальных
//     логах 0.8-2.8°); если это смещение нуля акселерометра (у MPU-6050 до
//     ±50-80 mg ≈ 3-5°), гироскоп его не видит и ось останется на старом месте —
//     поправку тогда НЕ применяем: поворот внёс бы гироскопу несуществующую ошибку.
//
// Телефону не нужно: у него IMU заводски выровнен с корпусом (доли градуса), а
// видимый наклон — настоящая поза (камера, чехол), которую исправлять нельзя.
//
// Всё считается в физическом кадре DSU-выхода — том же, что в ahrs.go:
// X вправо, Y вверх, Z к пользователю; ω = (RotX, -RotY, -RotZ), «верх» = -Acc.

const (
	mountMinTiltDeg  = 1.0  // меньше — поправлять нечего
	mountMaxTiltDeg  = 25.0 // больше — это не установка, а неровно положенный пад
	mountMaxCheckDeg = 4.0  // допуск перпендикулярности оси «вперёд» к гравитации покоя
	mountMinRateDeg  = 20.0 // сэмплы жеста медленнее этого не участвуют в поиске оси
)

// Статусы MountCorrection.Status.
const (
	MountOK           = "ok"           // измерено, проверено — можно применять
	MountSmall        = "small"        // наклон < mountMinTiltDeg, поправка не нужна
	MountTooLarge     = "too_large"    // наклон > mountMaxTiltDeg — пад лежал неровно
	MountInconsistent = "inconsistent" // гироскоп не подтвердил наклон (скорее bias акселерометра)
	MountNoData       = "no_data"      // нет покоя или жеста «вперёд» в этой калибровке
)

// MountCorrection хранится в профиле USB-пада.
type MountCorrection struct {
	Status  string `json:"status"`
	Enabled bool   `json:"enabled"` // пользовательский выключатель; действует только при Status == ok
	// R — поворот в физическом кадре DSU-выхода: up_корпус = R · up_датчик.
	R [3][3]float64 `json:"r"`
	// Как лежащий ровно пад читался бы без поправки (знаки как у LEVEL / GetEulerAngles).
	TiltDeg    float64 `json:"tiltDeg"`
	ForwardDeg float64 `json:"forwardDeg"` // > 0 — завален вперёд
	RightDeg   float64 `json:"rightDeg"`   // > 0 — завален вправо
	// Отклонение оси жеста «вперёд» от горизонта покоя (проверка, см. выше).
	CheckDeg float64 `json:"checkDeg"`
}

// Active — применять ли поправку к живому потоку.
func (m *MountCorrection) Active() bool {
	return m != nil && m.Status == MountOK && m.Enabled
}

// ComputeMountCorrection: upRest — «верх» в покое (−Acc) в физическом кадре,
// pitchOmega — угловые скорости жеста «вперёд» в том же кадре, °/с.
func ComputeMountCorrection(upRest [3]float64, pitchOmega [][3]float64) MountCorrection {
	res := MountCorrection{Status: MountNoData, R: Identity3()}
	n := Norm3(upRest)
	if n < 0.5 {
		return res
	}
	u := [3]float64{upRest[0] / n, upRest[1] / n, upRest[2] / n}
	res.TiltDeg = math.Acos(clamp1(u[1])) * 180 / math.Pi
	// «Верх» к пользователю (+Z) = дальний край ниже = наклон вперёд; «верх»
	// вправо (+X) = правый край выше = наклон влево.
	res.ForwardDeg = math.Atan2(u[2], u[1]) * 180 / math.Pi
	res.RightDeg = math.Atan2(-u[0], u[1]) * 180 / math.Pi

	axis, ok := principalAxis(pitchOmega, mountMinRateDeg)
	if !ok {
		return res
	}
	res.CheckDeg = math.Abs(math.Asin(clamp1(axis[0]*u[0]+axis[1]*u[1]+axis[2]*u[2]))) * 180 / math.Pi

	switch {
	case res.TiltDeg < mountMinTiltDeg:
		res.Status = MountSmall
	case res.TiltDeg > mountMaxTiltDeg:
		res.Status = MountTooLarge
	case res.CheckDeg > mountMaxCheckDeg:
		res.Status = MountInconsistent
	default:
		res.Status = MountOK
		res.Enabled = true
		res.R = rotationBetween(u, [3]float64{0, 1, 0})
	}
	return res
}

// ApplyToDSU поворачивает DSU-поля (RotX/Y/Z в °/с, AccX/Y/Z в g). Гироскоп
// в физическом кадре — P·Rot, P = diag(1,-1,-1), поэтому Rot' = P·R·P·Rot;
// акселерометр — линейный (−Acc = up), Acc' = R·Acc.
func (m *MountCorrection) ApplyToDSU(rot, acc [3]float64) (rotOut, accOut [3]float64) {
	p := [3]float64{1, -1, -1}
	var w [3]float64
	for i := 0; i < 3; i++ {
		w[i] = p[i] * rot[i]
	}
	w = MulVec3(m.R, w)
	for i := 0; i < 3; i++ {
		rotOut[i] = p[i] * w[i]
	}
	return rotOut, MulVec3(m.R, acc)
}

// principalAxis — главная ось вращения (собственный вектор Σωωᵀ с наибольшим
// собственным числом) по сэмплам быстрее minRate. Знак — к +X.
func principalAxis(omega [][3]float64, minRate float64) ([3]float64, bool) {
	var m [3][3]float64
	count := 0
	for _, w := range omega {
		if Norm3(w) < minRate {
			continue
		}
		count++
		for i := 0; i < 3; i++ {
			for j := 0; j < 3; j++ {
				m[i][j] += w[i] * w[j]
			}
		}
	}
	if count < 10 {
		return [3]float64{}, false
	}
	// Степенной метод: матрица симметричная неотрицательная, главная ось
	// доминирует (жест — вращение в основном вокруг одной оси).
	v := [3]float64{1, 0.3, 0.2}
	for it := 0; it < 100; it++ {
		nv := MulVec3(m, v)
		n := Norm3(nv)
		if n < 1e-12 {
			return [3]float64{}, false
		}
		v = [3]float64{nv[0] / n, nv[1] / n, nv[2] / n}
	}
	if v[0] < 0 {
		v = [3]float64{-v[0], -v[1], -v[2]}
	}
	return v, true
}

// rotationBetween — минимальный поворот, переводящий единичный a в единичный b.
func rotationBetween(a, b [3]float64) [3][3]float64 {
	v := [3]float64{a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]}
	c := a[0]*b[0] + a[1]*b[1] + a[2]*b[2]
	if c < -0.999999 {
		return Identity3() // противоположные векторы сюда не доходят (наклон ≤ mountMaxTiltDeg)
	}
	// R = I + [v]× + [v]×² / (1 + c)
	k := 1 / (1 + c)
	vx := [3][3]float64{{0, -v[2], v[1]}, {v[2], 0, -v[0]}, {-v[1], v[0], 0}}
	r := Identity3()
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			sq := 0.0
			for t := 0; t < 3; t++ {
				sq += vx[i][t] * vx[t][j]
			}
			r[i][j] += vx[i][j] + sq*k
		}
	}
	return r
}

func clamp1(x float64) float64 {
	return math.Max(-1, math.Min(1, x))
}

// MountFromCalibration переводит сырые данные калибровки (гравитация покоя в
// сырых осях акселерометра, сэмплы жеста «вперёд» в сырых осях гироскопа, °/с,
// уже без bias, только скорости поворота) в физический кадр DSU-выхода — ровно тем же путём, что живой
// конвейер в startup(): mat, yawSign, DSUYawSign для гироскопа; accMat и
// DSUAccSign для акселерометра.
func MountFromCalibration(mat [3][3]float64, sf SensorFrame, gravityRaw [3]float64, pitchRot [][3]float64) MountCorrection {
	accMat, yawSign := BuildOutputMapping(mat, sf, gravityRaw)
	acc := MulVec3(accMat, gravityRaw)
	up := [3]float64{
		-float64(DSUAccSign[0]) * acc[0],
		-float64(DSUAccSign[1]) * acc[1],
		-float64(DSUAccSign[2]) * acc[2],
	}
	omega := make([][3]float64, 0, len(pitchRot))
	for _, rot := range pitchRot {
		r := MulVec3(mat, rot)
		r[1] *= yawSign * float64(DSUYawSign)
		omega = append(omega, [3]float64{r[0], -r[1], -r[2]}) // ω = P·Rot
	}
	return ComputeMountCorrection(up, omega)
}
