# -*- coding: utf-8 -*-
"""
半步五子棋 v1.1.8 宣传片配乐 —— 程序化合成
风格：现代科技感 / 沉稳推进 / 不抢解说
输出：video/bgm.wav  (44.1kHz, 立体声, 16bit)

分层：Sub Bass / Pad / Arp / Bell / Percussion / Riser
"""
import math, os, sys, wave
import numpy as np

SR = 44100
DUR = float(os.environ.get("BGM_DUR", "82"))
N = int(SR * DUR)
OUT = os.environ.get("BGM_OUT", os.path.join(os.path.dirname(__file__), "..", "video", "bgm.wav"))

rng = np.random.default_rng(20260911)

def midi(m):
    return 440.0 * (2.0 ** ((m - 69) / 12.0))

def env_adsr(n, a, d, s, r, sr=SR, sustain_level=0.7):
    a_n, d_n, r_n = int(a*sr), int(d*sr), int(r*sr)
    a_n = max(1, a_n); d_n = max(1, d_n); r_n = max(1, r_n)
    s_n = max(0, n - a_n - d_n - r_n)
    e = np.concatenate([
        np.linspace(0, 1, a_n, endpoint=False),
        np.linspace(1, sustain_level, d_n, endpoint=False),
        np.full(s_n, sustain_level),
        np.linspace(sustain_level, 0, r_n),
    ])
    if len(e) < n: e = np.pad(e, (0, n-len(e)))
    return e[:n]

def add(buf, sig, at):
    i = int(at * SR)
    if i >= len(buf): return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[:j-i]

def saw(f, n, detune=0.0):
    t = np.arange(n) / SR
    sig = np.zeros(n)
    for k in range(1, 13):
        sig += ((-1) ** (k+1)) / k * np.sin(2*np.pi*(f*(1+detune))*k*t)
    return sig * (2/np.pi)

def sine(f, n, phase=0.0):
    return np.sin(2*np.pi*f*np.arange(n)/SR + phase)

def tri(f, n):
    t = np.arange(n) / SR
    return 2/np.pi * np.arcsin(np.sin(2*np.pi*f*t))

def lowpass(x, cutoff, sr=SR, order=2):
    """朴素双极点低通（一阶串联 order 次）"""
    a = math.exp(-2*math.pi*cutoff/sr)
    y = x.copy()
    for _ in range(order):
        out = np.empty_like(y)
        acc = 0.0
        # 向量化近似：用 lfilter 风格循环较慢，改用 scipy-free 的 IIR 近似
        b = 1 - a
        prev = 0.0
        # 使用累积法（一阶指数平滑，向量化不可行）——对 7M 点较慢，故降采样处理
        out = np.empty_like(y)
        alpha = a
        # 分段递推（每段用 numpy 无法消除依赖），用 Python 循环代价高；改用 FFT 频域滤波
        return freq_filter(x, cutoff, sr, "low")
    return y

def freq_filter(x, cutoff, sr=SR, kind="low", order=2):
    n = len(x)
    X = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(n, 1/sr)
    with np.errstate(divide="ignore"):
        if kind == "low":
            H = 1.0 / np.sqrt(1.0 + (freqs/cutoff) ** (2*order))
        else:
            H = 1.0 / np.sqrt(1.0 + (cutoff/np.maximum(freqs, 1e-6)) ** (2*order))
    return np.fft.irfft(X * H, n)

def reverb(x, decay=1.9, mix=0.26, seed=7):
    """简化 Schroeder：4 梳状 + 2 全通"""
    r = np.random.default_rng(seed)
    combs = [1116, 1188, 1277, 1356]
    allp  = [556, 441]
    wet = np.zeros_like(x)
    for c in combs:
        d = int(c * SR / 44100)
        g = 0.78
        buf = np.zeros(len(x) + d + 1)
        buf[:len(x)] = x
        # 向量化替代：延迟叠加
        fb = x.copy()
        acc = np.zeros_like(x)
        amp = g
        k = 1
        while amp > 0.02 and k * d < len(x):
            acc[k*d:] += fb[:len(x)-k*d] * amp
            amp *= g
            k += 1
        wet += acc / len(combs)
    for c in allp:
        d = int(c * SR / 44100)
        acc = wet.copy()
        acc[d:] += -0.5 * wet[:len(wet)-d]
        wet = acc
    # 指数衰减尾
    tail = np.exp(-np.arange(len(x)) / (decay * SR * 0.5))
    wet *= tail
    return x * (1 - mix) + wet * mix

# ---------------- 和声进行 ----------------
# Am - F - C - G  (vi IV I V)，沉稳推进
PROG = [
    ("Am", [57, 60, 64, 69]),
    ("F",  [53, 57, 60, 65]),
    ("C",  [48, 55, 60, 64]),
    ("G",  [55, 59, 62, 67]),
]
BPM = 112.0
BEAT = 60.0 / BPM
BAR = BEAT * 4
CHORD_BARS = 2                    # 每个和弦 2 小节
CHORD_LEN = BAR * CHORD_BARS

def chords_until(t):
    out = []
    t0 = 0.0
    i = 0
    while t0 < t:
        name, notes = PROG[i % len(PROG)]
        out.append((t0, min(t0 + CHORD_LEN, t), name, notes))
        t0 += CHORD_LEN
        i += 1
    return out

CHORDS = chords_until(DUR)

REF_DUR = 157.0          # 曲线原始基准时长
SCALE = DUR / REF_DUR    # 实际时长按比例映射，换时长无需重调曲线


def intensity(t):
    """整体力度曲线：0..1（时间轴按实际时长等比缩放）"""
    t = t / SCALE
    if t < 9:    return 0.30
    if t < 21:   return 0.52
    if t < 37:   return 0.70
    if t < 59:   return 0.78
    if t < 79:   return 0.80
    if t < 97:   return 0.76
    if t < 119:  return 0.86
    if t < 133:  return 0.80
    if t < 147:  return 0.78
    return 0.42

# ---------------- 音轨 ----------------
padL = np.zeros(N); padR = np.zeros(N)
bass = np.zeros(N)
arp  = np.zeros(N)
bell = np.zeros(N)
kick = np.zeros(N)
hat  = np.zeros(N)
riser = np.zeros(N)

# Pad：每和弦铺一层
for (t0, t1, name, notes) in CHORDS:
    ln = int((t1 - t0) * SR)
    if ln <= 0: continue
    inten = intensity(t0)
    layer = np.zeros(ln)
    for k, m in enumerate(notes[:4]):
        f = midi(m + 12)
        det = (k - 1.5) * 0.0016
        voice = (saw(f, ln, +det) + saw(f, ln, -det)) * 0.5
        e = env_adsr(ln, a=1.5, d=0.9, s=0.0, r=min(1.6, (t1-t0)*0.35), sustain_level=0.55)
        layer += voice * e * (0.30 if k < 3 else 0.16)
    layer = freq_filter(layer, 1650, order=2)
    layer *= 0.20 * inten
    # 立体声展宽
    d = int(0.012 * SR)
    L = layer.copy(); R = layer.copy()
    R[d:] += layer[:-d] * 0.25
    L[:-d] += layer[d:] * 0.25
    add(padL, L, t0); add(padR, R, t0)

# Sub Bass：根音 + 五度交替
for (t0, t1, name, notes) in CHORDS:
    root = notes[0] - 12
    n_bars = int(round((t1 - t0) / BAR))
    for b in range(n_bars):
        bt = t0 + b * BAR
        ln = int(BAR * 0.96 * SR)
        if ln <= 0: continue
        m = root if b % 2 == 0 else root + 7
        f = midi(m)
        s = sine(f, ln) * 0.9 + tri(f*2, ln) * 0.12
        e = env_adsr(ln, a=0.02, d=0.35, s=0.0, r=0.30, sustain_level=0.62)
        add(bass, s * e * 0.26 * intensity(bt), bt)

# Arp：八分音符琶音（带 Haas 展宽）
eighth = BEAT / 2
t = 0.0
step_i = 0
while t < DUR:
    idx = int(t // CHORD_LEN)
    if idx < len(CHORDS):
        t0, t1, name, notes = CHORDS[idx]
        seq = [notes[1], notes[2], notes[3], notes[2], notes[0]+12, notes[2], notes[3], notes[1]]
        m = seq[step_i % len(seq)]
        ln = int(min(0.55, eighth*1.7) * SR)
        f = midi(m + 12)
        s = sine(f, ln) * 0.7 + sine(f*2, ln) * 0.16 + sine(f*3, ln) * 0.06
        e = env_adsr(ln, a=0.004, d=0.10, s=0.0, r=min(0.42, ln/SR*0.7), sustain_level=0.30)
        amp = 0.115 * intensity(t) * (0.62 if step_i % 4 == 0 else 1.0)
        add(arp, s * e * amp, t)
    step_i += 1
    t += eighth
arp = freq_filter(arp, 5200, order=1)
# 延迟（1/8 附点）
for dly, g in [(eighth*1.5, 0.30), (eighth*3, 0.14)]:
    add(arp, np.concatenate([np.zeros(int(dly*SR)), arp[:N-int(dly*SR)]]) * g, 0)

# Bell：稀疏高音点
_bell_ref = [1.6, 6.0, 12.6, 18.2, 25.0, 33.0, 41.0, 50.0, 62.0, 71.5, 82.0, 90.0,
              99.0, 108.0, 116.0, 124.0, 130.0, 138.0, 143.0, 149.0]
bell_times = [round(x * SCALE, 2) for x in _bell_ref]
scale = [76, 79, 81, 84, 81, 79, 76, 72]
for i, bt in enumerate(bell_times):
    ln = int(2.2 * SR)
    if ln <= 0: continue
    m = scale[i % len(scale)]
    f = midi(m)
    s = sine(f, ln) * 0.7 + sine(f*2.76, ln) * 0.22 + sine(f*5.4, ln) * 0.08
    e = np.exp(-np.arange(ln) / (SR * 0.42))
    e[:int(0.006*SR)] *= np.linspace(0, 1, int(0.006*SR))
    add(bell, s * e * 0.085 * intensity(bt), bt)

# Percussion
t = 0.0
bi = 0
while t < DUR:
    inten = intensity(t)
    beat_in_bar = bi % 4
    # Kick：1、3 拍
    if beat_in_bar in (0, 2) and t > 8.5:
        ln = int(0.32 * SR)
        f = np.linspace(96, 44, ln)
        ph = np.cumsum(2*np.pi*f/SR)
        s = np.sin(ph) * np.exp(-np.arange(ln)/(SR*0.085))
        add(kick, s * 0.5 * inten, t)
    # Hat：八分
    for sub in (0.0, 0.5):
        ht = t + sub*BEAT
        if ht <= 9.5 or ht > DUR: continue
        ln = int(0.06 * SR)
        s = rng.standard_normal(ln) * np.exp(-np.arange(ln)/(SR*0.012))
        s = freq_filter(s, 7200, order=1)
        amp = (0.075 if sub == 0.0 else 0.045) * intensity(ht)
        add(hat, s * amp, ht)
    bi += 1
    t += BEAT

# Riser：段落切换处的气声推进
_riser_ref = [8.0, 20.5, 36.5, 58.5, 78.5, 96.5, 118.5, 132.5, 146.0]
riser_at = [round(x * SCALE, 2) for x in _riser_ref]
for rt in riser_at:
    ln = int(2.0 * SR)
    s = rng.standard_normal(ln)
    ramp = np.linspace(0, 1, ln) ** 2.2
    s = freq_filter(s * ramp, 900, order=2)
    # 逐渐升高
    hi = freq_filter(rng.standard_normal(ln) * ramp, 6000, order=1)
    s = s*0.7 + hi*0.12
    e = np.exp(-np.arange(ln)/(SR*1.4)) * np.linspace(1, .1, ln)
    add(riser, s * e * 0.085, rt)

# ---------------- 混音 ----------------
padL[:] = reverb(padL, mix=0.30)
padR[:] = reverb(padR, mix=0.30)
arp_r = reverb(arp, mix=0.34)

L = padL + bass*0.98 + arp*0.72 + arp_r*0.28 + bell*0.62 + kick*0.95 + hat*0.85 + riser
R = padR + bass*0.98 + arp*0.52 + arp_r*0.48 + bell*0.78 + kick*0.95 + hat*0.80 + riser*1.05

# 轻微立体声相位
d = int(0.0075 * SR)
Ls = L.copy(); Rs = R.copy()
Rs[d:] += L[:-d]*0.10; Ls[:-d] += R[d:]*0.10
L, R = Ls, Rs

# 总线：软压缩 + 淡入淡出
def soft_compress(x, th=0.72, ratio=3.4):
    a = np.abs(x)
    over = a > th
    if over.any():
        x = x.copy()
        x[over] = np.sign(x[over]) * (th + (a[over]-th)/ratio)
    return x
L = soft_compress(L); R = soft_compress(R)
peak = max(np.abs(L).max(), np.abs(R).max())
L *= 0.86/peak; R *= 0.86/peak
fade_in = int(min(2.2, DUR*0.035)*SR)
fade_out = int(min(4.5, DUR*0.075)*SR)
L[:fade_in] *= np.linspace(0,1,fade_in); R[:fade_in] *= np.linspace(0,1,fade_in)
L[-fade_out:] *= np.linspace(1,0,fade_out); R[-fade_out:] *= np.linspace(1,0,fade_out)

stereo = np.stack([L, R], axis=1)
pcm = np.clip(stereo, -1, 1)
pcm16 = (pcm * 32767).astype("<i2")

os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
with wave.open(OUT, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(pcm16.tobytes())

print(f"OK -> {os.path.abspath(OUT)}  {DUR:.1f}s  {len(pcm16)*4/1e6:.1f}MB")
