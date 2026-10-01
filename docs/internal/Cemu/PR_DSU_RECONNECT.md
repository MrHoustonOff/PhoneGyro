# Cemu PR: DSU переподключается сам — текст для GitHub

Ветка: `dsu-rerequest-pad-data` (1 коммит `06bdb5f` поверх upstream/main `c717fca`; **открыт как [#2077](https://github.com/cemu-project/Cemu/pull/2077)**). Постановка — `DSU_RECONNECT_PROBLEM.md`.
Независим от PR по гироскопу; слияние с `gyro-bias-at-rest` проверено — конфликтов нет.

## Title

```
input/DSU: Request pad data again while the server is silent
```

## Description

```markdown
Fixes #627

Cemu requests DSU pad data once when the controller connects and then again after every received packet. If the DSU server is started after Cemu, or is restarted while Cemu is running, no packet arrives, so no request is ever sent again: motion stays dead until the controller is re-added in the input settings or Cemu is restarted.

The writer thread now waits for jobs with a timeout (new `ConcurrentQueue::pop` overload with a timeout). Once a second it requests pad data again for every pad that was requested before and has not sent anything for a second. The check runs by time rather than only on timeout, so a silent pad is also found while another pad keeps the queue busy.

While the server streams, nothing changes: no extra requests, the writer thread only wakes up for its regular jobs. While it is gone, one small request per requested pad and second is sent. Dolphin (every second) and Citra/Azahar (every 3 s) re-register the same way.

Tested on Windows:
- Cemu started 10 s before the server: requests arrive every second, the pad is picked up as soon as the server starts. Cemu 2.6 sends nothing in the same test.
- Server stopped for 3 s and started again, three times in a row: Cemu is subscribed again within 1 s each time.
- Cemu still closes normally.
```

---

## Проверено (для себя)

- Сборка MSVC (RelWithDebInfo) без предупреждений; `ConcurrentQueue.h` и `std::array<std::atomic_bool>` дополнительно
  проверены g++ `-std=c++20 -Wall -Wextra -Wpedantic -Wconversion` — без предупреждений; тайм-аут очереди, готовый
  элемент и пробуждение `nullptr` из деструктора работают.
- Живой тест: фейковый слушатель на 26760 (`fakedsu.py`) и настоящий DSU-сервер PhoneGyro (`pkg/dsu`, 3 раунда
  остановки/запуска) против исправленного Cemu и Cemu 2.6.

## Известное, не в этом PR

- Флаг «слот запрашивали» не сбрасывается: после поиска контроллеров в настройках (ответы `PortInfo` по всем
  слотам) Cemu раз в секунду запрашивает и пустые слоты — до 8 пакетов по ~30 байт в секунду на localhost.
- `is_connected()` не устаревает (после пропажи сервера слот считается подключённым) — отдельная тема.
- Сервер, у которого метки времени начинаются с нуля и который проработал меньше 10 с до перезапуска, может
  «молчать» в Cemu до 10 с (`integrate_motion` отбрасывает пакеты с меньшей меткой). PhoneGyro не затронут.
- MotionSource 1.1.2 (Android, тот же сервер, что у автора #627) — проверен пользователем 2026-09-29, работает.
- Перед подачей: если будет возможность, проверить с DS4Windows/BetterJoy; не проверили — не писать в «Tested».
