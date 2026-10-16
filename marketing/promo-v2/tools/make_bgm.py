# -*- coding: utf-8 -*-
"""
半步五子棋打谱 v1.1.8 宣传片 v2 配乐 —— 程序化合成
风格：黑白棋盘 / 算力 / 专注 · 冷调基础 + 段际爬升 + 峰值收束
BPM 100（4/4，拍 0.6s，小节 2.4s），与视频 30 小节对齐
输出：video/bgm.wav (44.1kHz 立体声 16bit)

分层：Pad / Bass / Arp / Bell / Drums(Kick·Hihat·Snare) / Riser / 母带
情绪弧线（对齐 SEGS）：
  0–5 冷寂聚焦(Pad+Bell) → 5–21.6 建立(Bass+Arp) → 21.6–45.6 推进(鼓组 21.6 进)
  → 45.6–60 峰值(全轨+军鼓) → 60–64.8 闪切保持 → 64.8–72 收束(Pad+Bell 余韵)
"""
import math, os, sys, wave
import numpy as np

SR = 44100
BPM = 100.0
DUR = float(os.environ.get("BGM_DUR", "72.0"))
OUT = os.environ.get("BGM_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "video", "bgm.wav"))
rng = np.random.default_rng(20260913)

BEAT = 60.0 / BPM          # 0.6s
BAR = BEAT * 4             # 2.4s
N = int(SR * DUR)
REF_L = np.zeros(N)
REF_R = np.zeros(N)


def midi(m):
    return 440.0 * (2.0 ** ((m - 69) / 12.0))


def env_adsr(n, a, d, s, r, sr=SR, sustain_level=0.72):
    a_n, d_n, r_n = int(a * sr), int(d * sr), int(r * sr)
    a_n = max(1, a_n); d_n = max(1, d_n); r_n = max(1, r_n)
    s_n = max(0, n - a_n - d_n - r_n)
    return np.concatenate([
        np.linspace(0, 1, a_n, endpoint=False),
        np.linspace(1, sustain_level, d_n, endpoint=False),
        np.full(s_n, sustain_level),
        np.linspace(sustain_level, 0, r_n),
    ])[:n]


# 和弦进行（D 小调，四小节循环）：Dm9 → BbM7 → FM7 → C(挂4)
CHORDS = [
    [50, 53, 57, 60],   # D3 F3 A3 D4
    [46, 50, 53, 57],   # Bb2 D3 F3 A3
    [41, 45, 48, 52],   # F2 A2 C3 E3
    [48, 52, 55, 57],   # C3 E3 G3 A3
]
CHORD_ROOT = [38, 34, 29, 36]   # 低音根音（D2 Bb1 F1 C2）


def intensity(t):
    """情绪强度 0-1（按视频段落）"""
    if t < 5:    return 0.34
    if t < 9.6:  return 0.48
    if t < 21.6: return 0.62
    if t < 37.2: return 0.76
    if t < 45.6: return 0.86
    if t < 60.0: return 0.98
    if t < 64.8: return 0.84
    if t < 68.5: return 0.62
    return 0.30


def bar_at(t):
    return int(t / BAR)


def add(sig, buf, pos, gain=1.0, pan=0.0):
    i0 = int(pos * SR)
    if i0 >= N:
        return
    seg = sig[: max(0, N - i0)]
    l = gain * math.sqrt((1 - pan) / 2) * 1.414 * 0.5
    r = gain * math.sqrt((1 + pan) / 2) * 1.414 * 0.5
    bufL = buf if buf is REF_L else (REF_L if buf is REF_R else buf)
    bufL[i0:i0 + len(seg)] += seg * l


def add2(sig, pos, gain=1.0, pan=0.0):
    i0 = int(pos * SR)
    if i0 >= N:
        return
    seg = sig[: max(0, N - i0)]
    l = gain * math.sqrt((1 - pan) / 2) * 1.414 * 0.5
    r = gain * math.sqrt((1 + pan) / 2) * 1.414 * 0.5
    REF_L[i0:i0 + len(seg)] += seg * l
    REF_R[i0:i0 + len(seg)] += seg * r


def tone(freq, n, wave="sine", detune=0.0):
    t = np.arange(n) / SR
    ph = 2 * np.pi * freq * t
    if wave == "sine":
        return np.sin(ph)
    if wave == "tri":
        return 2 / np.pi * np.arcsin(np.sin(ph))
    if wave == "noise":
        return rng.standard_normal(n)
    return np.sin(ph)


# ================= Pad（长音，轻微失谐） =================
for bar in range(int(DUR / BAR) + 1):
    t0 = bar * BAR
    if t0 > DUR: break
    chord = CHORDS[bar % 4]
    inten = intensity(t0 + BAR * .5)
    for k, m in enumerate(chord[::2]):
        f = midi(m)
        n = int(BAR * 1.8 * SR)
        e = env_adsr(n, .9, .8, .8, 1.2)
        sig = (tone(f, n) * .62 + tone(f * 1.002, n) * .38) * e
        add2(sig, t0 + k * BAR * .5, gain=.052 * inten, pan=.18)
    f = midi(chord[3] + 12)
    n = int(BAR * 1.4 * SR)
    e = env_adsr(n, .5, .4, .5, .9)
    add2(tone(f, n) * e, t0 + BAR * .5, gain=.016 * inten, pan=-.14)

# ================= Bass =================
for bar in range(int(DUR / BAR) + 1):
    t0 = bar * BAR
    if t0 >= DUR: break
    inten = intensity(t0)
    root = CHORD_ROOT[bar % 4]
    f = midi(root)
    n = int(BEAT * 2.2 * SR)
    e = env_adsr(n, .012, .35, .35, .28)
    sig = (tone(f, n) * .8 + tone(f * 2, n) * .2) * e
    if t0 >= 45.6 and t0 < 64.8:
        for b in range(1, 4):
            nb = int(BEAT * .9 * SR)
            eb = env_adsr(nb, .008, .2, .2, .2)
            add2(tone(f * 2, nb) * eb, t0 + b * BEAT, gain=.05 * inten, pan=0)
    add2(sig, t0, gain=.085 * inten + (.10 if t0 >= 45.6 else 0), pan=0)

# ================= Arp（8 分音符分解，6s 后进入） =================
STEP = BEAT / 2
for t0 in np.arange(6.0, DUR - .3, STEP):
    inten = intensity(t0)
    chord = CHORDS[bar_at(t0) % 4]
    idx = int(t0 / BAR * 8) % 8
    order = [0, 2, 1, 3, 0, 2, 1, 3]
    m = chord[order[idx]] + 12
    f = midi(m)
    n = int(STEP * 1.1 * SR)
    e = env_adsr(n, .006, .22, .2, .12)
    sig = (tone(f, n) * .7 + tone(f, n, "tri") * .3) * e
    add2(sig, t0, gain=.045 * inten, pan=0.22 if idx % 2 else -0.2)
    if t0 >= 45.6:
        add2(tone(f * 2, n) * e, t0, gain=.014 * inten, pan=.3)

# ================= Bell（关键节点高音装饰） =================
BELLS = [
    (0.0, 84), (4.8, 79), (9.6, 76), (14.4, 79), (21.6, 84),
    (30.0, 81), (37.2, 76), (45.6, 88), (52.8, 81), (60.0, 84),
    (64.8, 79), (68.5, 76), (72.0, 72),
]
for bt, m in BELLS:
    if bt > DUR: continue
    f = midi(m)
    n = int(2.6 * SR)
    e = env_adsr(n, .005, .5, .35, 2.0)
    sig = tone(f, n) * e + tone(f * 2.01, n) * .3 * e
    add2(sig, bt, gain=.09, pan=.3)

# ================= Drums（21.6s 进 kick+hihat，45.6s 加军鼓） =================
for t0 in np.arange(21.6, 64.8, BEAT):
    inten = intensity(t0)
    n = int(.5 * SR)
    f = np.linspace(150, 46, n)
    e = env_adsr(n, .002, .2, .18, .1)
    kick = np.sin(2 * np.pi * np.cumsum(f) / SR) * e
    add2(kick, t0, gain=.30 * inten, pan=0)
    if t0 >= 45.6:
        add2(kick * .8, t0, gain=.14, pan=0)
    for h in (0, .3):
        th = t0 + h
        if th >= 64.0: continue
        n = int(.12 * SR)
        e = env_adsr(n, .002, .06, 0, .05)
        add2(tone(0, n, "noise") * e, th, gain=.05 * inten * (1.6 if h > 0 else 1.0), pan=-.1)
    if t0 >= 45.6 and bar_at(t0) % 2 == 0:
        n = int(.22 * SR)
        e = env_adsr(n, .002, .12, .1, .08)
        sig = tone(0, n, "noise") * e * .8 + tone(180, n) * e * .2
        add2(sig, t0 + BEAT, gain=.16 * inten, pan=.12)

# ================= Riser（段边界前 1.2s 噪声爬升） =================
for edge in [4.8, 9.6, 14.4, 21.6, 30.0, 37.2, 45.6, 52.8, 60.0, 64.8]:
    n = int(1.2 * SR)
    env2 = np.linspace(0, 1, n) ** 2
    noise = tone(0, n, "noise")
    hp = np.diff(noise, prepend=0)
    sig = (noise * .4 + hp * .6) * env2
    add2(sig, edge - 1.2, gain=.05, pan=0)

# ================= 收尾渐隐（68.5s 起鼓组停，整体指数衰减） =================
cut = int(68.5 * SR)
for i in range(cut, N):
    k = (i - cut) / max(1, (N - cut))
    REF_L[i] *= (1 - k) ** 1.2
    REF_R[i] *= (1 - k) ** 1.2

# ================= 母带 =================
def softclip(x, k=1.18):
    return np.tanh(x * k) / np.tanh(k)


peak = max(np.max(np.abs(REF_L)), np.max(np.abs(REF_R)))
print(f"peak before: {peak:.3f}", file=sys.stderr)
g = 0.92 / max(peak, 1e-9)
REF_L[:] = softclip(REF_L * g)
REF_R[:] = softclip(REF_R * g)
fi = int(.25 * SR); fo = int(1.5 * SR)
REF_L[:fi] *= np.linspace(0, 1, fi)
REF_R[:fi] *= np.linspace(0, 1, fi)
REF_L[-fo:] *= np.linspace(1, 0, fo)
REF_R[-fo:] *= np.linspace(1, 0, fo)

pcm = np.empty(N * 2, dtype=np.int16)
pcm[0::2] = (REF_L * 32767).astype(np.int16)
pcm[1::2] = (REF_R * 32767).astype(np.int16)

os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
with wave.open(OUT, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(f"BGM OK: {OUT}  {DUR:.1f}s  {BPM:.0f}BPM  {os.path.getsize(OUT)/1e6:.1f}MB", file=sys.stderr)