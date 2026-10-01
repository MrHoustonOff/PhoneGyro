"""PR2 design study: Cemu gyro bias estimators on the hard cases.

OLD      : Mahony.h today (lifetime mean of samples < 0.35 rad/s, from 200 samples).
A_STILL  : learn only at rest (gyro + accel steady for STILL_TIME), first rest taken as is, then slow follow.
B_FALLBK : A, but until the first rest the OLD estimator runs (unchanged behaviour until the pad has rested once).
Metric: the bias error (deg/s) = how fast the aim drifts while the controller is held still.
"""
import math, random

D2R = math.pi / 180

class Old:
    def __init__(s): s.sum = [0.0] * 3; s.n = 0; s.bias = [0.0] * 3
    def update(s, dt, g, a):
        if any(abs(v) >= 0.35 for v in g): return
        for i in range(3): s.sum[i] += g[i]
        s.n += 1
        if s.n >= 200: s.bias = [x / s.n for x in s.sum]

class Still:
    GYRO_DEV, ACC_DEV, MAX_BIAS = 0.03, 0.03, 0.25
    AVG_TIME, STILL_TIME, FOLLOW_TIME = 0.25, 1.0, 5.0
    def __init__(s, fallback=False):
        s.gAvg = [0.0] * 3; s.aAvg = [0.0] * 3; s.still = 0.0
        s.bias = [0.0] * 3; s.rested = False
        s.old = Old() if fallback else None
    def update(s, dt, g, a):
        k = min(dt / s.AVG_TIME, 1.0); ok = True
        for i in range(3):
            s.gAvg[i] += (g[i] - s.gAvg[i]) * k
            s.aAvg[i] += (a[i] - s.aAvg[i]) * k
            if abs(g[i] - s.gAvg[i]) >= s.GYRO_DEV or abs(a[i] - s.aAvg[i]) >= s.ACC_DEV or abs(s.gAvg[i]) >= s.MAX_BIAS:
                ok = False
        if s.old is not None and not s.rested:
            s.old.update(dt, g, a); s.bias = list(s.old.bias)
        if not ok:
            s.still = 0.0; return
        s.still += dt
        if s.still < s.STILL_TIME: return
        kb = 1.0 if not s.rested else min(dt / s.FOLLOW_TIME, 1.0)
        for i in range(3): s.bias[i] += (s.gAvg[i] - s.bias[i]) * kb
        s.rested = True


class V3:
    """Still = low spread (std over ~0.25 s), not low peaks. A bias close to the current one is
    followed after a short rest; a big change needs a long rest (a real bias does not jump, a slow
    smooth pan on the knee does). Before the first rest: 0 (fallback=False) or the old mean (True)."""
    GYRO_STD, ACC_STD, MAX_BIAS = 0.01, 0.02, 0.25   # rad/s, g, rad/s
    AVG_TIME = 0.25
    SHORT_REST, LONG_REST = 1.0, 3.0                  # s
    JUMP = 0.01                                        # rad/s (0.57 deg/s)
    FOLLOW_TIME = 3.0
    def __init__(s, fallback=False):
        s.gAvg=None; s.gVar=[0.0]*3; s.aVar=[0.0]*3
        s.still=0.0; s.bias=[0.0]*3; s.rested=False; s.old=Old() if fallback else None
    def update(s, dt, g, a):
        if s.gAvg is None:
            s.gAvg=list(g); s.aAvg=list(a)
        k=min(dt/s.AVG_TIME,1.0); ok=True
        for i in range(3):
            s.gAvg[i]+=(g[i]-s.gAvg[i])*k; s.gVar[i]+=((g[i]-s.gAvg[i])**2-s.gVar[i])*k
            s.aAvg[i]+=(a[i]-s.aAvg[i])*k; s.aVar[i]+=((a[i]-s.aAvg[i])**2-s.aVar[i])*k
            if s.gVar[i]>=s.GYRO_STD**2 or s.aVar[i]>=s.ACC_STD**2 or abs(s.gAvg[i])>=s.MAX_BIAS: ok=False
        if s.old is not None and not s.rested:
            s.old.update(dt,g,a); s.bias=list(s.old.bias)
        if not ok:
            s.still=0.0; return
        s.still+=dt
        # nothing to protect before the first rest: it is taken after a short rest
        jump = s.rested and max(abs(s.gAvg[i]-s.bias[i]) for i in range(3)) >= s.JUMP
        if s.still < (s.LONG_REST if jump else s.SHORT_REST): return
        kb = 1.0 if (jump or not s.rested) else min(dt/s.FOLLOW_TIME,1.0)
        for i in range(3): s.bias[i]+=(s.gAvg[i]-s.bias[i])*kb
        s.rested=True

class Session:
    """Builds a sample stream. held=True adds hand tremor to gyro and accel."""
    def __init__(s, bias, rate, seed=1, noise=0.004, acc=True):
        s.bias, s.dt, s.rnd, s.noise, s.acc = bias, 1.0 / rate, random.Random(seed), noise, acc
        s.out = []
    def emit(s, sec, yaw_dps=0.0, held=True, tremor=0.02):
        r = s.rnd
        for _ in range(int(sec / s.dt)):
            g = [s.bias[i] + r.gauss(0, s.noise) + (r.gauss(0, tremor) if held else 0) + (yaw_dps * D2R if i == 1 else 0) for i in range(3)]
            a = [((-1.0 if i == 1 else 0.0) + r.gauss(0, 0.004) + (r.gauss(0, 0.03) if held else 0)) if s.acc else 0.0 for i in range(3)]
            s.out.append((s.dt, g, a))
        return s
    def bow(s, minutes, pan=10.0):
        """BotW bow: aim slowly one way, flick back fast, hold."""
        t = 0
        while t < minutes * 60:
            s.emit(4, pan); s.emit(0.5, -pan * 8); s.emit(3); t += 7.5
        return s

def run(name, stream, true_bias):
    res = []
    for est in (Old(), Still(), V3(), V3(fallback=True)):
        for dt, g, a in stream: est.update(dt, g, a)
        res.append(max(abs(est.bias[i] - true_bias[i]) for i in range(3)) / D2R)
    print('%-58s %8.3f %8.3f %8.3f %8.3f' % (name, *res))

ZERO = [0.0, 0.0, 0.0]
PRO = [-0.0933, 0.0619, 0.0179]  # the Switch Pro in Mahony.h's comment, rad/s
print('%-58s %8s %8s %8s %8s' % ('scenario (worst-axis bias error, deg/s)', 'OLD', 'draft', 'V3', 'V3+fall'))
for rate in (60, 1000):
    run(f'{rate:4d} Hz: calibrated source, desk at start, 10 min bow', Session(ZERO, rate).emit(3, held=False).bow(10).out, ZERO)
run('200 Hz: Switch Pro bias, desk at start, 10 min bow', Session(PRO, 200).emit(3, held=False).bow(10).out, PRO)
run('200 Hz: Switch Pro bias, NEVER put down, 10 min bow', Session(PRO, 200).bow(10).out, PRO)
run('200 Hz: calibrated source, NEVER put down, 10 min bow', Session(ZERO, 200).bow(10).out, ZERO)
run('200 Hz: Switch Pro, never down, but held calmly (no bow)', Session(PRO, 200).emit(600).out, PRO)
# lap: resting on the knee while panning slowly and smoothly (no tremor), then still on the knee
lap = Session(ZERO, 200).emit(3, held=False)
for _ in range(20): lap.emit(3, 3.0, held=False).emit(0.4, -22.5, held=True).emit(2, held=False)
lap_end = list(lap.out)
run('200 Hz: slow smooth pans on the knee, ends at rest', lap_end, ZERO)
lap2 = Session(ZERO, 200).emit(3, held=False)
for _ in range(20): lap2.emit(2, held=False).emit(3, 3.0, held=False).emit(0.4, -22.5, held=True)
run('200 Hz: slow smooth pans on the knee, ends right after pan', lap2.out, ZERO)
run('200 Hz: no accelerometer in the source, desk at start', Session(ZERO, 200, acc=False).emit(3, held=False).bow(10).out, ZERO)
run('200 Hz: real MPU-6050 noise (0.0025 rad/s)', Session(PRO, 200, noise=0.0025).emit(3, held=False).bow(10).out, PRO)
run('200 Hz: 2x noisier than MPU-6050 (0.005 rad/s)', Session(PRO, 200, noise=0.005).emit(3, held=False).bow(10).out, PRO)
# temperature: bias creeps 0.5 deg/s over 10 minutes, short rests now and then
temp = Session(list(PRO), 200).emit(3, held=False)
for k in range(40):
    temp.bias = [PRO[0] + 0.5 * D2R * k / 40, PRO[1], PRO[2]]
    temp.bow(0.1)
    if k % 8 == 7: temp.emit(3, held=False)
run('200 Hz: bias creeps +0.5 deg/s (temperature), rests sometimes', temp.out, temp.bias)

slow = Session(ZERO, 200).emit(3, held=False)
for _ in range(20): slow.emit(3, 0.5, held=False).emit(0.4, -3.75, held=True).emit(2, held=False)
run('200 Hz: very slow 0.5 deg/s smooth pans on the knee', slow.out, ZERO)
calm = Session(ZERO, 200).emit(3, held=False).emit(600, tremor=0.006)
run('200 Hz: very calm hand (tremor 0.006 rad/s), 10 min', calm.out, ZERO)
swap = Session(ZERO, 200).emit(3, held=False).bow(1)
swap.bias = [0.0, 2*D2R, 0.0]
swap.emit(5, held=False).bow(1).emit(1, held=False)
run('200 Hz: other device on the slot (bias 0 -> 2 deg/s), 5 s desk', swap.out, swap.bias)
