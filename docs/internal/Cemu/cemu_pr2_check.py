"""Verification for CEMU_PR2_SOLUTION.md (companion to cemu_pr2_sim.py; same sample model and RNG order).

Columns:
  OLD           Mahony.h today (lifetime mean of samples < 0.35 rad/s, from 200 samples)
  V3 (doc)      V3 exactly as in CEMU_PR2_PROBLEM.md, bias 0 until the first rest (reproduces its table)
  V3+fall (doc) the same, old estimator until the first rest
  PR2 final     V3+fall + fixes: long rest counted only while far from the bias, gap >= 0.1 s is no rest,
                bit-identical non-zero gyro for > 1 s is no rest, mean limit 0.35 rad/s (= old gate),
                exact EW variance, DSU reset on device change ('RESET' marker)
  PR3 +windows  PR2 final + ungated 30 s window means before the first rest (optional follow-up)
Cell: final worst-axis bias error, deg/s | % of session time with a visible error (> 0.012 rad/s).
Also checks the coning formula and the Mahony tilt offset for a bias left uncorrected, reproduces rows of the
problem-doc table at 200 Hz (table P), and checks the length of the first rest and the accelerometer
criterion (table E).
Run: python cemu_pr2_check.py   (~2 min)
"""
import math, random, sys

D2R = math.pi / 180
VIS = 0.012


class Old:
    def __init__(s): s.sum = [0.0] * 3; s.n = 0; s.bias = [0.0] * 3
    def update(s, dt, g, a):
        if any(abs(v) >= 0.35 for v in g): return
        for i in range(3): s.sum[i] += g[i]
        s.n += 1
        if s.n >= 200: s.bias = [x / s.n for x in s.sum]


class Est:
    """V3 family. Defaults = V3 exactly as in the problem doc (checked against its table)."""
    GSTD, ASTD, AVG, SHORT, LONG, JUMP, FOLLOW = 0.01, 0.02, 0.25, 1.0, 3.0, 0.01, 3.0

    def __init__(s, fallback=False, max_bias=0.25, gap=None, far_timer=False, stale=None,
                 windows=None, dsu_reset=False, finch=False):
        s.use_fb, s.max_bias, s.gap, s.far_timer, s.finch = fallback, max_bias, gap, far_timer, finch
        s.stale, s.win, s.dsu_reset = stale, windows, dsu_reset
        s.reset()

    def reset(s):
        s.old = Old() if s.use_fb else None
        s.gAvg = None; s.gVar = [0.0] * 3; s.aVar = [0.0] * 3
        s.still = 0.0; s.bias = [0.0] * 3; s.rested = False; s.wasFar = False
        s.prevG = None; s.staleT = 0.0
        s.wSum = [0.0] * 3; s.wSq = 0.0; s.wT = 0.0; s.prevWin = None
        s.accSum = [0.0] * 3; s.accT = 0.0; s.winBias = None

    def on_reset(s):
        if s.dsu_reset: s.reset()

    def windows(s, dt, g):
        W, ACT, AGREE = s.win
        if dt > 0.1:
            s.wSum = [0.0] * 3; s.wSq = 0.0; s.wT = 0.0; s.prevWin = None; return
        for i in range(3): s.wSum[i] += g[i] * dt
        s.wSq += (g[0] * g[0] + g[1] * g[1] + g[2] * g[2]) * dt; s.wT += dt
        if s.wT < W: return
        mean = [x / s.wT for x in s.wSum]
        cur = (list(s.wSum), s.wT, mean) if math.sqrt(s.wSq / s.wT) <= ACT else None
        if cur and s.prevWin and max(abs(mean[i] - s.prevWin[2][i]) for i in range(3)) < AGREE:
            if s.accT == 0.0:
                for i in range(3): s.accSum[i] += s.prevWin[0][i]
                s.accT += s.prevWin[1]
            for i in range(3): s.accSum[i] += cur[0][i]
            s.accT += cur[1]
            s.winBias = [x / s.accT for x in s.accSum]
        s.prevWin = cur
        s.wSum = [0.0] * 3; s.wSq = 0.0; s.wT = 0.0

    def update(s, dt, g, a):
        dt = min(dt, 0.2)                                   # Mahony clamp happens before updateGyroBias
        if s.gAvg is None:
            s.gAvg = list(g); s.aAvg = list(a)
        k = min(dt / s.AVG, 1.0); ok = True
        for i in range(3):
            if s.finch:                                     # exact EW mean/variance (Finch 2009)
                d = g[i] - s.gAvg[i]; s.gAvg[i] += k * d; s.gVar[i] = (1 - k) * (s.gVar[i] + k * d * d)
                d = a[i] - s.aAvg[i]; s.aAvg[i] += k * d; s.aVar[i] = (1 - k) * (s.aVar[i] + k * d * d)
            else:
                s.gAvg[i] += (g[i] - s.gAvg[i]) * k; s.gVar[i] += ((g[i] - s.gAvg[i]) ** 2 - s.gVar[i]) * k
                s.aAvg[i] += (a[i] - s.aAvg[i]) * k; s.aVar[i] += ((a[i] - s.aAvg[i]) ** 2 - s.aVar[i]) * k
            if s.gVar[i] >= s.GSTD ** 2 or s.aVar[i] >= s.ASTD ** 2 or abs(s.gAvg[i]) >= s.max_bias:
                ok = False
        if s.gap is not None and dt >= s.gap:
            ok = False                                      # a sample after a gap is no evidence of rest
        if s.stale is not None:
            if s.prevG == g and any(v != 0.0 for v in g): s.staleT += dt
            else: s.staleT = 0.0
            s.prevG = list(g)
            if s.staleT > s.stale: ok = False
        if not s.rested:
            if s.win is not None: s.windows(dt, g)
            if s.old is not None: s.old.update(dt, g, a)
            if s.winBias is not None: s.bias = list(s.winBias)
            elif s.old is not None: s.bias = list(s.old.bias)
        if not ok:
            s.still = 0.0; s.wasFar = False; return
        s.still += dt
        far = s.rested and max(abs(s.gAvg[i] - s.bias[i]) for i in range(3)) >= s.JUMP
        if s.far_timer and far and not s.wasFar:
            s.still = dt                                    # the long rest is counted while far only
        s.wasFar = far
        if s.still < (s.LONG if far else s.SHORT): return
        kb = 1.0 if (far or not s.rested) else min(dt / s.FOLLOW, 1.0)
        for i in range(3): s.bias[i] += (s.gAvg[i] - s.bias[i]) * kb
        s.rested = True


class Session:
    def __init__(s, bias, rate=100, seed=1, noise=0.004, acc=True, clip=None):
        s.bias = list(bias); s.dt = 1.0 / rate; s.rnd = random.Random(seed)
        s.noise, s.acc, s.clip = noise, acc, clip
        s.out = []; s.pend = 0.0

    def sample(s, w, held, tremor=0.02):
        r = s.rnd
        g = [s.bias[i] + r.gauss(0, s.noise) + (r.gauss(0, tremor) if held else 0) + w[i] for i in range(3)]
        if s.clip: g = [max(-s.clip, min(s.clip, v)) for v in g]
        a = [((-1.0 if i == 1 else 0.0) + r.gauss(0, 0.004) + (r.gauss(0, 0.03) if held else 0)) if s.acc else 0.0
             for i in range(3)]
        s.out.append((s.dt + s.pend, g, a, tuple(s.bias))); s.pend = 0.0

    def n(s, sec): return int(sec / s.dt + 1e-6)

    def emit(s, sec, dps=0.0, held=True, tremor=0.02, axis=1):
        for _ in range(s.n(sec)):
            w = [0.0] * 3; w[axis] = dps * D2R; s.sample(w, held, tremor)
        return s

    def ramp(s, sec, d0, d1, held=False, axis=1):
        m = s.n(sec)
        for j in range(m):
            w = [0.0] * 3; w[axis] = (d0 + (d1 - d0) * j / m) * D2R; s.sample(w, held)
        return s

    def coning(s, sec, alpha_deg, hz):
        om = 2 * math.pi * hz; al = alpha_deg * D2R
        for j in range(s.n(sec)):
            t = j * s.dt
            w = [om * (1 - math.cos(al)), om * math.sin(al) * math.cos(om * t), om * math.sin(al) * math.sin(om * t)]
            s.sample(w, True)
        return s

    def gap(s, sec): s.pend += sec; return s

    def stale(s, sec):
        dt, g, a, tb = s.out[-1]
        for _ in range(s.n(sec)): s.out.append((s.dt, list(g), list(a), tb))
        return s

    def reset(s): s.out.append('RESET'); return s

    def bow(s, minutes, pan=10.0, back=-80.0, back_t=0.5):
        t = 0
        while t < minutes * 60:
            s.emit(4, pan); s.emit(back_t, back); s.emit(3); t += 7 + back_t
        return s


def run_one(stream, make, dt_scale=1.0, acc_scale=1.0):
    est = make(); T = vis = 0.0; err = 0.0
    for item in stream:
        if item == 'RESET':
            if hasattr(est, 'on_reset'): est.on_reset()
            continue
        dt, g, a, tb = item
        est.update(dt * dt_scale, g, a if acc_scale == 1.0 else [x * acc_scale for x in a])
        err = max(abs(est.bias[i] - tb[i]) for i in range(3))
        T += dt
        if err > VIS: vis += dt
    return err / D2R, 100.0 * vis / T


WIN = (30.0, 0.5, 0.5 * D2R)
FINAL = dict(fallback=True, max_bias=0.35, gap=0.1, far_timer=True, stale=1.0, dsu_reset=True, finch=True)
ESTS = [
    ('OLD', lambda: Old()),
    ('V3 (doc)', lambda: Est()),
    ('V3+fall (doc)', lambda: Est(fallback=True)),
    ('PR2 final', lambda: Est(**FINAL)),
    ('PR3 +windows', lambda: Est(windows=WIN, **FINAL)),
]


def table(title, rows, ests=ESTS):
    print('\n' + title)
    print('%-60s' % 'scenario  [final deg/s | % time visible]' + ''.join('%17s' % n for n, _ in ests))
    for name, stream, kw in rows:
        cells = []
        for _, make in ests:
            e, v = run_one(stream, make, **kw)
            cells.append('%7.3f |%5.1f%%' % (e, v))
        print('%-60s' % name + ''.join('%17s' % c for c in cells)); sys.stdout.flush()


ZERO = [0.0, 0.0, 0.0]
PRO = [-0.0933, 0.0619, 0.0179]


def check_coning():
    """Numerical check of the coning DC term: R(t) = Rz(wt) Rx(a) Rz(-wt), body rate = vee(R^T dR)."""
    def mul(A, B): return [[sum(A[i][k] * B[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
    def rz(t): c, s_ = math.cos(t), math.sin(t); return [[c, -s_, 0], [s_, c, 0], [0, 0, 1]]
    def rx(t): c, s_ = math.cos(t), math.sin(t); return [[1, 0, 0], [0, c, -s_], [0, s_, c]]
    def T(A): return [[A[j][i] for j in range(3)] for i in range(3)]
    for alpha, hz in ((15, 1.0), (15, 0.25), (5, 1.0)):
        om, al, h, N = 2 * math.pi * hz, alpha * D2R, 1e-5, 2000
        acc = [0.0, 0.0, 0.0]
        for j in range(N):
            t = j / N / hz
            R1 = mul(mul(rz(om * t), rx(al)), rz(-om * t)); R2 = mul(mul(rz(om * (t + h)), rx(al)), rz(-om * (t + h)))
            D = mul(T(R1), R2)
            w = [(D[2][1] - D[1][2]) / (2 * h), (D[0][2] - D[2][0]) / (2 * h), (D[1][0] - D[0][1]) / (2 * h)]
            for i in range(3): acc[i] += w[i] / N
        print('coning %2d deg @ %.2f Hz: numeric mean body rate z = %6.2f deg/s, formula Om(1-cos a) = %6.2f deg/s'
              % (alpha, hz, acc[2] / D2R, om * (1 - math.cos(al)) / D2R))


def check_tilt():
    """Mahony.h updateIMU replica (Kp via 0.5 * GetVectorZ, per-axis 0.015 zone), bias estimate kept at 0:
    steady tilt error and yaw drift for the Switch Pro bias from the Mahony.h comment."""
    w, x, y, z = math.sqrt(0.5), math.sqrt(0.5), 0.0, 0.0
    def vz(w, x, y, z): return (2 * (x * z - w * y), 2 * (y * z + w * x), 2 * (w * w + z * z) - 1)
    acc = vz(w, x, y, z)                                  # at rest in the default pose
    b, dt = PRO, 0.01
    for step in range(int(120 / dt)):
        gv = [0.0 if abs(v) < 0.015 else v for v in b]
        gx, gy, gz = vz(w, x, y, z); gx, gy, gz = 0.5 * gx, 0.5 * gy, 0.5 * gz
        ax, ay, az = acc
        e = (gy * az - gz * ay, gz * ax - gx * az, gx * ay - gy * ax)
        gv = [(gv[i] - e[i]) * 0.5 * dt for i in range(3)]
        dw = -x * gv[0] - y * gv[1] - z * gv[2]
        dx = w * gv[0] + y * gv[2] - z * gv[1]
        dy = w * gv[1] - x * gv[2] + z * gv[0]
        dz = w * gv[2] + x * gv[1] - y * gv[0]
        w, x, y, z = w + dw, x + dx, y + dy, z + dz
        n = math.sqrt(w * w + x * x + y * y + z * z); w, x, y, z = w / n, x / n, y / n, z / n
        if step in (int(30 / dt), int(120 / dt) - 1):
            v = vz(w, x, y, z)
            tilt = math.degrees(math.acos(max(-1.0, min(1.0, sum(v[i] * acc[i] for i in range(3))))))
            print('Mahony replica, Switch Pro bias, estimate 0, t=%3.0f s: tilt error %.1f deg' % (step * dt, tilt))
    perp = math.sqrt(b[0] ** 2 + b[2] ** 2)
    print('  prediction asin(|b_perp|/0.5) = %.1f deg (gravity along sensor Y)' % math.degrees(math.asin(perp / 0.5)))


if __name__ == '__main__':
    check_coning()
    check_tilt()
    port = [('200 Hz: Switch Pro bias, desk at start, 10 min bow', Session(PRO, 200).emit(3, held=False).bow(10).out, {}),
            ('200 Hz: calibrated source, NEVER put down, 10 min bow', Session(ZERO, 200).bow(10).out, {}),
            ('200 Hz: Switch Pro, never down, held calmly', Session(PRO, 200).emit(600).out, {})]
    p = Session(ZERO, 200).emit(3, held=False)
    for _ in range(20): p.emit(3, 3.0, held=False).emit(0.4, -22.5).emit(2, held=False)
    port.append(('200 Hz: slow smooth pans on the knee, ends at rest', p.out, {}))
    p = Session(ZERO, 200).emit(3, held=False)
    for _ in range(20): p.emit(3, 0.5, held=False).emit(0.4, -3.75).emit(2, held=False)
    port.append(('200 Hz: very slow 0.5 deg/s smooth pans on the knee', p.out, {}))
    table('P. Port check: V3 (doc) must give 0.015 / 0.000 / 5.346 / 0.015 / 0.455 as in CEMU_PR2_PROBLEM.md',
          port, ESTS[:4])
    R = 100
    base = [
        ('calibrated, desk at start, 10 min bow', Session(ZERO, R).emit(3, held=False).bow(10).out, {}),
        ('Switch Pro bias, desk at start, 10 min bow', Session(PRO, R).emit(3, held=False).bow(10).out, {}),
        ('Switch Pro, NEVER put down, 10 min bow', Session(PRO, R).bow(10).out, {}),
        ('calibrated, NEVER put down, 10 min bow', Session(ZERO, R).bow(10).out, {}),
        ('Switch Pro, never put down, held calmly 10 min', Session(PRO, R).emit(600).out, {}),
    ]
    lap = Session(ZERO, R).emit(3, held=False)
    for _ in range(20): lap.emit(3, 3.0, held=False).emit(0.4, -22.5).emit(2, held=False)
    base.append(('knee: slow smooth pans 3 deg/s, ends at rest', lap.out, {}))
    temp = Session(list(PRO), R).emit(3, held=False)
    for k in range(40):
        temp.bias = [PRO[0] + 0.5 * D2R * k / 40, PRO[1], PRO[2]]; temp.bow(0.1)
        if k % 8 == 7: temp.emit(3, held=False)
    base.append(('temperature creep +0.5 deg/s, rests sometimes', temp.out, {}))
    base.append(('very calm hand (tremor 0.006), 10 min', Session(ZERO, R).emit(3, held=False).emit(600, tremor=0.006).out, {}))
    sw = Session(ZERO, R).emit(3, held=False).bow(1); sw.reset(); sw.bias = [0.0, 2 * D2R, 0.0]
    sw.emit(5, held=False).bow(1).emit(1, held=False)
    base.append(('DSU slot: other device (0 -> 2 deg/s), 5 s desk', sw.out, {}))
    sw2 = Session(PRO, R).emit(3, held=False).bow(1); sw2.reset(); sw2.bias = list(ZERO); sw2.bow(3)
    base.append(('DSU slot: Switch Pro -> calibrated phone, never rested', sw2.out, {}))
    table('A. Scenarios from the problem doc (100 Hz) + swap without rest', base)

    adv = []
    s = Session(ZERO, R).emit(10, held=False).ramp(2, 0, 3).emit(1, 3.0, held=False).emit(0.3, -30).bow(2)
    adv.append(('long rest, smooth ramp 0->3 deg/s (2 s) + 1 s pan, bow', s.emit(5, held=False).bow(1).out, {}))
    s = Session(ZERO, R).emit(10, held=False).ramp(2, 0, 3).emit(4, 3.0, held=False).emit(0.3, -30).bow(2)
    adv.append(('long rest, smooth ramp 0->3 deg/s (2 s) + 4 s pan, bow', s.emit(5, held=False).bow(1).out, {}))
    s = Session(ZERO, R).emit(10, held=False).gap(0.3).emit(0.01, 2.0, held=False).bow(2)
    adv.append(('long rest, 0.3 s gap, first sample 2 deg/s, then bow', s.out, {}))
    s = Session(ZERO, R).emit(0.9, held=False).gap(0.3).emit(0.01, 3.0, held=False).bow(2)
    adv.append(('0.9 s on desk (first rest), gap, 3 deg/s sample, bow', s.out, {}))
    s = Session(ZERO, R).emit(3, held=False).bow(1).emit(2, 10.0).stale(5).bow(2)
    adv.append(('stalled DSU source repeats a 10 deg/s sample for 5 s', s.out, {}))
    s = Session(ZERO, R).emit(3, held=False).bow(1).emit(2, 10.0).stale(1.5).bow(2)
    adv.append(('stalled source 1.5 s', s.out, {}))
    src = Session(PRO, R).emit(3, held=False).bow(5).out
    adv.append(('timestamps in ms instead of us (dt x 0.001), Switch Pro', src, {'dt_scale': 0.001}))
    adv.append(('accelerometer in m/s^2 instead of g, Switch Pro', src, {'acc_scale': 9.81}))
    adv.append(('vibrating desk (noise 0.012 rad/s), Switch Pro, desk 60 s',
                Session(PRO, R, noise=0.012).emit(60, held=False).bow(5).out, {}))
    for d in (10, 18):
        s = Session(ZERO, R).emit(0.3, held=False).emit(2.5, d, held=False).emit(0.5, held=False).bow(3)
        adv.append(('turning the pad on the desk %d deg/s for 2 s at start' % d, s.emit(5, held=False).bow(2).out, {}))
    big = [0.0, 0.30, 0.0]
    adv.append(('bias 0.30 rad/s (17 deg/s) clone, desk at start, bow',
                Session(big, R).emit(3, held=False).bow(5).out, {}))
    stair = Session(ZERO, R).emit(3, held=False)
    for _ in range(8): stair.ramp(20, 0.0, 3.0).emit(0.4, -30.0).emit(2, held=False)
    adv.append(('knee: speed ramps 0->3 deg/s over 20 s, no tremor (x8)', stair.out, {}))
    s = Session(ZERO, R).emit(3, held=False).bow(1).emit(2, 10.0).stale(30).bow(2)
    adv.append(('stalled source 30 s', s.out, {}))
    adv.append(('exact-zero source at rest (PhoneGyro), desk, bow',
                Session(ZERO, R, noise=0.0).emit(3, held=False).bow(5).emit(3, held=False).out, {}))
    for rate in (60, 1000):
        adv.append(('%d Hz: Switch Pro, desk at start, 10 min bow' % rate,
                    Session(PRO, rate).emit(3, held=False).bow(10).out, {}))
    table('B. Adversarial scenarios for the rest-based estimator (100 Hz unless noted)', adv)

    nev = []
    nev.append(('calibrated, never down: coning 15 deg @0.25 Hz 90 s',
                Session(ZERO, R).bow(3).coning(90, 15, 0.25).bow(3).out, {}))
    nev.append(('calibrated, never down: coning 15 deg @1 Hz 90 s',
                Session(ZERO, R).bow(3).coning(90, 15, 1.0).bow(3).out, {}))
    nev.append(('calibrated, never down: one fast 360 roll flip',
                Session(ZERO, R).bow(2).emit(1, 360, axis=0).bow(6).out, {}))
    nev.append(('calibrated, never down: slow 360 turn (30 deg/s)',
                Session(ZERO, R).bow(2).emit(12, 30).bow(6).out, {}))
    nev.append(('calibrated, never down: two 360 turns 30 s apart',
                Session(ZERO, R).bow(2).emit(12, 30).bow(0.5).emit(12, 30).bow(6).out, {}))
    nev.append(('calibrated, never down: +-250 deg/s clip, -400 deg/s flicks',
                Session(ZERO, R, clip=250 * D2R).bow(8, back=-400.0, back_t=0.1).out, {}))
    nev.append(('Switch Pro, never down, bow, 60 Hz', Session(PRO, 60).bow(8).out, {}))
    nev.append(('Switch Pro, never down, bow, 1000 Hz', Session(PRO, 1000).bow(8).out, {}))
    nev.append(('calibrated, never down, bow, 60 Hz', Session(ZERO, 60).bow(8).out, {}))
    for hz in (0.2, 1 / 3.0):
        nev.append(('calibrated, never down: coning 15 deg @%.2f Hz 120 s' % hz,
                    Session(ZERO, R).bow(3).coning(120, 15, hz).bow(3).out, {}))
    nev.append(('calibrated, never down: 90 deg turn, keeps new heading', Session(ZERO, R).bow(2).emit(9, 10).bow(6).out, {}))
    nev.append(('calibrated, never down: heading creeps 0.4 deg/s 3 min', Session(ZERO, R).bow(2).emit(180, 0.4).bow(4).out, {}))
    nev.append(('calibrated, never down: keeps turning 2 deg/s 3 min', Session(ZERO, R).bow(2).emit(180, 2.0).bow(4).out, {}))
    table('C. Never-rested sessions: stress for the window fallback', nev)

    class Est2(Est):
        """PR2 final with a different length of the first rest, or without the accelerometer criterion."""
        def __init__(s, first=None, no_acc=False, **kw):
            s.first = first
            super().__init__(**kw)
            if no_acc: s.ASTD = 1e9
        def update(s, dt, g, a):
            if s.first is None or s.rested: return super().update(dt, g, a)
            saved = s.SHORT; s.SHORT = s.first
            try: return super().update(dt, g, a)
            finally: s.SHORT = saved
    E = [('OLD', lambda: Old()), ('PR2 final', lambda: Est2(**FINAL)), ('first rest 2 s', lambda: Est2(first=2.0, **FINAL)),
         ('first rest 3 s', lambda: Est2(first=3.0, **FINAL)), ('no acc check', lambda: Est2(no_acc=True, **FINAL))]
    ex = [('Switch Pro, desk 3 s at start, 10 min bow', Session(PRO, R).emit(3, held=False).bow(10).out, {}),
          ('Switch Pro, desk 1.5 s at start, bow, desk 5 s later',
           Session(PRO, R).emit(1.5, held=False).bow(3).emit(5, held=False).bow(2).out, {}),
          ('very calm hand (tremor 0.006), 10 min', Session(ZERO, R).emit(3, held=False).emit(600, tremor=0.006).out, {})]
    cp = Session(ZERO, R).emit(3, held=False)
    for _ in range(40): cp.emit(5, 2.0, tremor=0.006).emit(0.3, -33.3).emit(3, tremor=0.006)
    ex.append(('calm hand + slow 2 deg/s pans 5 s (x40)', cp.out, {}))
    ex.append(('temperature creep +0.5 deg/s, rests 3 s sometimes', temp.out, {}))
    table('E. Length of the first rest and the accelerometer criterion (100 Hz)', ex, E)
