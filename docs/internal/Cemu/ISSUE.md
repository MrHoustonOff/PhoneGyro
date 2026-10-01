# Cemu issue — текст для GitHub

Подавать **первым**, до обоих PR. Потом в PR писать `Fixes #<номер issue>`.

Как пользоваться:

- Открыть https://github.com/cemu-project/Cemu/issues/new. Если GitHub предложит шаблоны, выбрать «Bug report» и разложить текст по его полям; если шаблона нет — вставить целиком.
- `<YOUTUBE_LINK>` заменить ссылкой на видео.
- В «Environment» проверить версию Cemu и ОС.
- `#PR1` / `#PR2` вписать после открытия PR (issue можно отредактировать позже) или удалить строку «Fix».

---

## Title

```
Gyro aim slowly drifts after aiming, even when the controller is lying still
```

## Description

```markdown
### Summary

After a few minutes of gyro aiming, the aim keeps turning on its own while the controller lies completely still on the desk. It gets worse the longer you play. Restarting Cemu fixes it until it builds up again; reconnecting the controller does not.

Video: <YOUTUBE_LINK>

The video shows the same steps with two independent DSU servers:
1. [PhoneGyro](https://github.com/MrHoustonOff/PhoneGyro) (my own app) with an MPU-6050 based controller
2. MotionSource 1.1.2 for Android (`net.sshnuke.dsu.MotionSource`), not related to me

PadTest runs next to Cemu the whole time: while the aim drifts, it shows 0 deg/s on all axes, so the server sends no rotation.

### Steps to reproduce

1. Use a DSU motion source that is calibrated at rest (PadTest or a packet capture shows exactly 0 deg/s on all axes while the controller lies still).
2. Start BotW and aim with gyro for a few minutes. Typical bow aiming: slow pan in one direction, quick turn back.
3. Put the controller down on the desk.

**Expected:** the aim stays still.
**Actual:** the aim keeps drifting in the direction of the slow pans.

### Cause

`MahonySensorFusion::updateGyroBias` (`src/input/motion/Mahony.h`) estimates the gyro bias as the mean of **all** samples where every axis is below 0.35 rad/s, over the whole session, without ever forgetting.

Aiming is asymmetric: the slow part of the motion is below 0.35 rad/s and gets averaged in, the fast return is above it and gets filtered out. So the "bias" moves towards the direction of the slow pans and stays there. At rest the game then receives `-bias` in VPAD gyroChange, and above 0.015 rad/s the orientation drifts as well. The same `MotionSample` also feeds the emulated Wii Remote MotionPlus.

Replaying a captured DSU stream through `updateGyroBias` gives +0.83 deg/s on one axis after a single slow pan.

Separately, the noise filter in `MotionSample::getVPADGyroChange` never had any effect: it checks the output array before anything is written to it and then overwrites it with the unfiltered values.

### Environment

- Cemu: 2.6 and current main (c717fca)
- OS: Windows 11
- Game: The Legend of Zelda: Breath of the Wild (EU, v208)
- Motion source: DSU. PhoneGyro (my own app) with an MPU-6050 based controller, and MotionSource 1.1.2 on Android

### Fix

I have fixes for both and will open two small PRs:
- #PR1 — gyroChange noise filter
- #PR2 — only update the gyro bias while the controller is at rest

Possibly related: #1825
```

---

## Перед подачей

- [ ] Видео загружено, ссылка вставлена вместо `<YOUTUBE_LINK>`. Видео «Не в списке» (Unlisted) подойдёт.
- [ ] На видео видно: контроллер лежит, прицел при этом уплывает. Хорошо, если в кадре или в описании видно, что Cemu обычный (не наша отладочная сборка).
- [ ] Версия Cemu и ОС в «Environment» правдивы.
- [ ] Строку «Possibly related: #1825» оставить: там похожий дрейф у клона Switch Pro через SDL.
