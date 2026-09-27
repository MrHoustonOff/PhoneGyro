package main

import (
	"math"
	"testing"
)

// TestPreviewUsesWizardGravity: реальный iPhone с чистой установки (матрица, кадр
// датчика и гравитация покоя — из сохранённого после калибровки профиля). До
// сохранения у профиля гравитации нет; превью обязано взять ту, что мастер только
// что измерил, иначе знак акселерометра неверный и модель «лежит вверх ногами».
func TestPreviewUsesWizardGravity(t *testing.T) {
	mat := [3][3]float64{{1, 0, 0}, {0, 1, 0}, {0, 0, -1}}
	sf := sensorFrame{Q: [3][3]float64{{0, 1, 0}, {0, 0, 1}, {1, 0, 0}}, H: -1}
	rest := [3]float64{-0.02796, -0.01334, -0.99952} // шаг «Покой», телефон экраном вверх

	dsuAccY := func(calGravity [3]float64, s sensorFrame) float64 {
		accMat, _ := buildOutputMapping(mat, s, calGravity)
		return float64(dsuAccSign[1]) * mulVec3(accMat, rest)[1]
	}

	// Как было: превью брало гравитацию профиля, а её ещё нет.
	if y := dsuAccY([3]float64{}, sf); y < 0.9 {
		t.Fatalf("precondition: without rest gravity the preview should read AccY≈+1 (the bug), got %.3f", y)
	}

	b := newMotionBank()
	b.wizardGravity, b.wizardGravityValid = rest, true
	gotSF, _, g := b.outputFrameInputs(true, sf, true, [3]float64{})
	if y := dsuAccY(g, gotSF); math.Abs(y+1) > 0.01 {
		t.Fatalf("preview AccY = %.3f, want -1 (flat, screen up)", y)
	}
	// Вне превью ничего не меняется.
	if _, _, g2 := b.outputFrameInputs(false, sf, true, [3]float64{}); g2 != ([3]float64{}) {
		t.Fatalf("outside preview the profile gravity must be used as is, got %v", g2)
	}
}
