package motion

// DeadbandScale возвращает множитель для вектора угловой скорости с модулем speed.
func DeadbandScale(speed, threshold float64) float64 {
	if threshold <= 0 {
		return 1
	}
	if speed <= threshold {
		return 0
	}
	if speed >= 2*threshold {
		return 1
	}
	// t ∈ (0,1): выход = порог·p(t), p(t) = 5t² − 3t³:
	// p(0)=0, p'(0)=0 (плавный выход из нуля), p(1)=2, p'(1)=1 (стык с тождеством).
	t := (speed - threshold) / threshold
	out := threshold * t * t * (5 - 3*t)
	return out / speed
}
