# Cemu PR 2 — текст для GitHub

Ветка: `gyro-bias-at-rest` (2 коммита поверх upstream/main). Отладочный коммит из `gyro-playtest` в PR не входит.

Как пользоваться:
- **Title** и **Description** ниже копировать как есть. `#PR1` заменить номером PR 1 (например `#2080`).
- `<YOUTUBE_LINK_FIX>` заменить ссылкой на видео с исправлением.
- Раздел «Tested» поправить под то, что реально проверено к моменту подачи. Не писать того, что не проверяли.
- `#ISSUE` заменить номером issue (текст issue — `ISSUE.md` рядом).
- Если по правилам Cemu нужно раскрыть помощь ИИ, внизу есть необязательный абзац «AI disclosure». Решение за вами.

Почему текст устроен именно так:
- Сначала симптом, который мейнтейнер узнает (прицел уплывает, пока контроллер лежит), потом причина в одном абзаце.
- Сразу сказано, что для контроллера, который никогда не кладут, ничего не меняется. Это главный страх ревьюера: сломать Switch Pro, под который писался старый код.
- Числа только проверяемые: код, пороги, сценарии теста.
- Ограничения названы честно, до того как их найдёт ревьюер.
- Нет упоминаний настоящего VPAD и SDK, нет критики старого кода.

---

## Title

```
input: Only update the gyro bias while the controller is at rest
```

## Description

```markdown
Fixes #ISSUE

The gyro bias in `MahonySensorFusion` was the mean of all samples below 0.35 rad/s over the whole session, without forgetting. Aiming is usually asymmetric (slow pan one way, quick flick back): the slow part is averaged in, the fast return is filtered out. The estimate slowly moves towards the slow direction and stays there, so after a few minutes of play the aim keeps drifting while the controller lies still. Restarting Cemu clears it, reconnecting the controller does not.

This happens even with a source that is already calibrated and sends exact zeros at rest. Replaying a captured DSU stream through the old `updateGyroBias` gives +0.83 deg/s on one axis after a single slow pan.

### Change

The bias is now only updated while the controller is at rest:

- Rest = low spread of gyro **and** accelerometer, exponentially weighted over ~0.25 s: below 0.01 rad/s and 0.02 g on every axis, with the mean below 0.35 rad/s (same limit as before). A sample after a gap (>= 0.1 s) or a source repeating the same non-zero sample for over 1 s does not count as rest.
- The first estimate is taken after 1 s of rest.
- Later rests within 0.01 rad/s of the estimate are followed slowly (~3 s), e.g. for temperature changes.
- A larger change needs 3 s of rest at the new value. Slow movement without tremor (e.g. turning the controller while it rests on the knee) can look like rest for a moment, this keeps it from being taken as bias.
- All timing uses `deltaTime`, so 60 Hz and 1000 Hz sources behave the same.

**Until the controller has been at rest once, the previous estimator runs unchanged.** A controller with a large bias that is never put down (e.g. a Switch Pro held from the start) behaves exactly as before.

Second commit: DSU resets the motion state of a slot when the device MAC changes, so a new device does not inherit the bias of the previous one, and its packets are not dropped by the timestamp check for up to 10 s. Servers sending an all-zero MAC behave as before.

No interface changes: `getGyroBias`, `WiiUMotionHandler`, `MotionSample` and the providers (apart from the DSU reset) are untouched. All new state lives in `MahonySensorFusion`, which is only updated by the provider thread.

### Known limitations

- Smooth movement without any tremor that lasts longer than 3 s can still be taken as bias. It is corrected by the next real rest.
- A controller that is never at rest keeps the old behavior.

### Tested

Video: <YOUTUBE_LINK_FIX> (same steps as in the issue, with PhoneGyro and MotionSource on Android. The overlay in the top right corner is a local debug build to show the estimate, it is not part of this PR.)

- BotW, DSU source (MPU-6050), bow aiming for several minutes: bias stays at ~0, no drift at rest. Before: the aim drifted after a few minutes.
- Offline replay of synthetic sessions through the real `Mahony.h` (60/100/200/1000 Hz, calibrated and Switch Pro-like bias, never put down, slow smooth pans, temperature creep, stalled source, gap, no accelerometer): never worse than before, the drift is gone once the controller rested for 1 s.

Related: #PR1 (the gyroChange noise filter, which also hides small residual errors of the estimate).
```

## AI disclosure (необязательно)

```markdown
Disclosure: the design was worked out with the help of an AI model (analysis and simulation of the estimator). <Code written by me / Code drafted with AI assistance and reviewed by me> — I can explain every line.
```

Выберите вариант в угловых скобках, который соответствует правде на момент подачи.

---

## Проверить перед подачей

- [ ] Ветка поверх свежего `upstream/main` (при необходимости `git rebase upstream/main`).
- [ ] Сборка из командной строки, чистая, без предупреждений в `Mahony.h` и `DSUControllerProvider.*`.
- [ ] В BotW: смещение около 0 после 1 с покоя, прицел стоит (отладочная сборка `gyro-playtest`).
- [ ] Если есть: Switch Pro или DualSense через SDL, DS4Windows или BetterJoy через DSU. Не проверили — не писать в «Tested».
- [ ] Номер PR 1 вписан вместо `#PR1`.
