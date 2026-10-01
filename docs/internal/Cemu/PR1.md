# Cemu PR 1 — текст для GitHub

Ветка: `fix-vpad-gyro-deadzone` (1 коммит поверх upstream/main). Подавать после issue, `#ISSUE` заменить номером.

## Title

```
input: Fix gyro noise filter in VPAD gyroChange
```

## Description

```markdown
Fixes #ISSUE (part 1)

getVPADGyroChange() compared the output array against the 0.012 rad/s threshold before writing to it, then overwrote it with the unfiltered rates, so the filter never had any effect.

This applies the threshold to the rates before converting them. Note that it is a small behavior change: a per-axis dead zone of ~0.69 deg/s now applies to VPAD gyroChange and to the emulated MotionPlus rate (same function). For comparison, Dolphin's default gyro dead zone is 2 deg/s.

Tested in BotW with a DSU motion source.
```
