"""Original 112 BPM score and sound design for the 78-second v1.1.9 film."""

from __future__ import annotations

import json
import math
from pathlib import Path
import subprocess
import tempfile
import wave

import numpy as np

SR = 48000
DURATION = 78.0
BPM = 112.0
BEAT = 60.0 / BPM
BAR = 4 * BEAT
N = round(SR * DURATION)
OUT = Path(__file__).resolve().parent.parent / "video" / "bgm-v2.wav"
FFMPEG = Path("C:/Tools/ffmpeg.exe")
FFPROBE = Path("C:/Tools/ffprobe.exe")
RNG = np.random.default_rng(1191005)
CHAPTERS = [0, 4, 11, 17, 24, 31, 42, 51, 58, 65, 73]

# Drums and low bass stay in the centre; pitched reflections form the width.
BUS = {name: np.zeros((N, 2), dtype=np.float32) for name in (
    "drums", "bass", "chords", "sequence", "motif", "fx"
)}


def note(number):
    return 440.0 * 2.0 ** ((number - 69) / 12.0)


def time_axis(seconds):
    return np.arange(round(seconds * SR), dtype=np.float64) / SR


def fft_filter(x, low=0, high=24000, slope=3):
    frequencies = np.fft.rfftfreq(len(x), 1 / SR)
    response = np.ones(len(frequencies))
    if low > 0:
        response *= 1 - 1 / np.sqrt(1 + (frequencies / low) ** (2 * slope))
    if high < SR / 2:
        response *= 1 / np.sqrt(1 + (frequencies / high) ** (2 * slope))
    return np.fft.irfft(np.fft.rfft(x) * response, len(x)).astype(np.float32)


def fade(x, attack=0.003, release=0.03):
    x = np.array(x, dtype=np.float32, copy=True)
    a = min(len(x), max(1, round(attack * SR)))
    r = min(len(x), max(1, round(release * SR)))
    x[:a] *= np.sin(np.linspace(0, np.pi / 2, a)) ** 2
    x[-r:] *= np.cos(np.linspace(0, np.pi / 2, r)) ** 2
    return x


def add(bus, signal, start, gain=1.0, pan=0.0, echoes=()):
    signal = np.asarray(signal, dtype=np.float32)
    a = round(start * SR)
    offset = max(0, -a)
    a = max(0, a)
    end = min(N, a + len(signal) - offset)
    if end <= a:
        return
    segment = signal[offset:offset + end - a]
    angle = (np.clip(pan, -1, 1) + 1) * np.pi / 4
    BUS[bus][a:end, 0] += segment * (gain * np.cos(angle))
    BUS[bus][a:end, 1] += segment * (gain * np.sin(angle))
    for delay, level, direction in echoes:
        add(bus, fft_filter(signal, 180, 5400), start + delay,
            gain * level, direction)


def harmonic(number, seconds, detune=0.0, brightness=9, shape="saw"):
    t = time_axis(seconds)
    f = note(number) * 2 ** (detune / 1200)
    x = np.zeros(len(t))
    for h in range(1, brightness + 1):
        if f * h > SR * 0.43:
            break
        if shape == "triangle" and h % 2 == 0:
            continue
        amplitude = 1 / h ** (1.0 if shape == "saw" else 1.7)
        phase = (0.17 * h * h) if shape == "saw" else 0
        x += amplitude * np.sin(2 * np.pi * f * h * t + phase)
    return (x / 2.2).astype(np.float32)


def pulse_bass(number, seconds=0.27):
    t = time_axis(seconds)
    tone = harmonic(number, seconds, brightness=8, shape="triangle")
    grit = harmonic(number + 12, seconds, detune=-3, brightness=10)
    envelope = (1 - np.exp(-t / 0.003)) * np.exp(-t / 0.13)
    body = fft_filter(tone * 0.85 + grit * 0.18, 28, 1350)
    return fade(np.tanh(body * 1.9) * envelope, 0.002, 0.040)


def kick():
    t = time_axis(0.37)
    f = 43 + 142 * np.exp(-t / 0.025)
    phase = np.cumsum(f) * (2 * np.pi / SR)
    body = np.sin(phase) * np.exp(-t / 0.094)
    attack = fft_filter(RNG.standard_normal(len(t)), 2500, 9000)
    attack *= np.exp(-t / 0.006) * 0.32
    return fade(np.tanh((body + attack) * 1.32) * 0.82, 0.001, 0.025)


def snare():
    t = time_axis(0.24)
    noise = fft_filter(RNG.standard_normal(len(t)), 1150, 11200)
    noise *= np.exp(-t / 0.052)
    body = np.sin(2 * np.pi * 185 * t) * np.exp(-t / 0.026)
    clap = np.zeros(len(t), dtype=np.float32)
    for delay in (0.007, 0.016, 0.029):
        shift = round(delay * SR)
        tap = fft_filter(RNG.standard_normal(len(t) - shift), 1400, 6400)
        clap[shift:] += tap * np.exp(-t[:len(t) - shift] / 0.023) * 0.32
    return fade(noise * 0.39 + body * 0.23 + clap, 0.001, 0.04)


def hat(open_hat=False):
    seconds = 0.21 if open_hat else 0.08
    t = time_axis(seconds)
    x = fft_filter(RNG.standard_normal(len(t)), 6400, 15400)
    decay = 0.053 if open_hat else 0.012
    return fade(x * np.exp(-t / decay), 0.001, 0.018)


def wood_click(pitch=0):
    t = time_axis(0.12)
    x = fft_filter(RNG.standard_normal(len(t)), 600, 6800)
    x *= np.exp(-t / 0.008) * 0.39
    for frequency, level, decay in ((670, .38, .016), (1180, .18, .012),
                                    (2090, .09, .007)):
        x += np.sin(2 * np.pi * frequency * 2 ** (pitch / 12) * t) \
            * np.exp(-t / decay) * level
    return fade(x, 0.0008, 0.024)


def pluck(number, seconds=0.64, bright=8):
    t = time_axis(seconds)
    a = harmonic(number, seconds, detune=2.7, brightness=bright)
    b = harmonic(number, seconds, detune=-4.2, brightness=bright, shape="triangle")
    env = (1 - np.exp(-t / 0.0022)) * np.exp(-t / 0.105)
    transient = fft_filter(RNG.standard_normal(len(t)), 2200, 7500)
    x = (a * .65 + b * .35) * env + transient * np.exp(-t / .005) * .017
    return fade(fft_filter(x, 190, 4800), .0015, .08)


def chord(notes, seconds, side):
    t = time_axis(seconds)
    x = np.zeros(len(t))
    for k, number in enumerate(notes):
        detune = (k - 2) * 2.8 + side * 4.1
        voice = harmonic(number, seconds, detune, brightness=12)
        x += voice * (0.19 if k < 4 else 0.12)
    env = (1 - np.exp(-t / .12)) * np.exp(-t / 1.02)
    shimmer = .84 + .16 * np.sin(2 * np.pi * .78 * t + side)
    return fade(fft_filter(x * env * shimmer, 210, 2400), .035, .45)


def whoosh(start, duration, gain=.14, direction=1):
    t = time_axis(duration)
    p = t / duration
    # Three spectral bands cross over as the camera travels through the grid.
    noise = RNG.standard_normal(len(t))
    lo = fft_filter(noise, 240, 950)
    mid = fft_filter(noise, 1100, 4200)
    hi = fft_filter(noise, 6400, 13200)
    envelope = np.sin(np.pi * p) ** 1.9
    signal = (lo * (1 - p) + mid * .8 + hi * p * .42) * envelope
    a = round(start * SR)
    for channel, sign in ((0, -1), (1, 1)):
        balance = .78 + sign * direction * (p - .5) * .62
        end = min(N, a + len(t))
        if a >= 0 and end > a:
            BUS["fx"][a:end, channel] += signal[:end-a] * balance[:end-a] * gain


def impact(start, size=1.0):
    t = time_axis(.62)
    f = 37 + 86 * np.exp(-t / .028)
    phase = np.cumsum(f) * 2 * np.pi / SR
    low = np.sin(phase) * np.exp(-t / .13) * .52
    noise = fft_filter(RNG.standard_normal(len(t)), 250, 5100)
    noise *= np.exp(-t / .035) * .22
    add("fx", fade(low + noise, .001, .08), start, size)
    add("fx", wood_click(-5), start + .018, .25 * size,
        echoes=((.07, .15, -.6), (.13, .09, .6)))


# A new C-minor/add9 voicing cycle, independent of the previous score.
PROGRESSION = [
    (36, [60, 63, 67, 70, 74]),
    (32, [56, 60, 63, 67, 70]),
    (39, [58, 62, 67, 70, 75]),
    (34, [58, 60, 65, 69, 72]),
]


def harmony(at):
    return PROGRESSION[max(0, int((at - 4) // (2 * BAR))) % len(PROGRESSION)]


def energy(at):
    if at < 4: return .15
    if at < 11: return .66
    if at < 17: return .78
    if at < 24: return .51
    if at < 31: return .85
    if at < 42: return .91
    if at < 51: return .98
    if at < 58: return .83
    if at < 65: return .49
    if at < 73: return 1.0
    return .25


def in_drop(at):
    return any(a <= at < b for a, b in ((17, 19.9), (31, 32.9),
                                         (58, 60.9), (73, 78)))


def arrange():
    drum_kick, drum_snare = kick(), snare()
    # Restrained intro: discrete stone sounds and a wide, rising harmonic bed.
    for at, pitch, level in ((.65, 0, .27), (1.4, -3, .44),
                             (2.2, 2, .22), (3.15, 5, .18)):
        add("fx", wood_click(pitch), at, level, .0,
            echoes=((.11, .17, -.75), (.23, .10, .75)))
    for side in (-1, 1):
        add("chords", chord([60, 67, 74], 3.8, side), .16, .12, side * .85)
    whoosh(2.85, 1.18, .15)

    # Two-bar chord breaths sit behind the rhythm rather than forming a drone.
    at, index = 4.0, 0
    while at < 73:
        _, notes = harmony(at)
        for side in (-1, 1):
            add("chords", chord(notes, 3.7, side), at,
                .30 * energy(at), side * .82,
                echoes=((BEAT * .75, .13, -side * .8),
                        (BEAT * 1.5, .07, side * .9)))
        at += BAR * 2
        index += 1

    # Syncopated short-note bass, avoiding sustained sub oscillators.
    at, step = 4.0, 0
    bass_pattern = [0, None, 0, 12, None, 0, 7, None,
                    0, None, 10, None, 7, 0, None, 12]
    while at < 73:
        root, _ = harmony(at)
        offset = bass_pattern[step % len(bass_pattern)]
        if offset is not None and not in_drop(at):
            length = .24 if step % 4 else .32
            add("bass", pulse_bass(root + offset, length), at,
                .55 * energy(at) * (1 if step % 4 == 0 else .79))
        step += 1
        at = 4 + step * BEAT / 2

    # Clean four-on-the-floor in the main engine / AI sections; broken elsewhere.
    at, beat_index = 4.0, 0
    while at < 73:
        e = energy(at)
        downbeat = beat_index % 4
        if not in_drop(at):
            full = 24 <= at < 58 or at >= 65
            if full or downbeat in (0, 2):
                add("drums", drum_kick, at, .68 * e)
            if downbeat in (1, 3):
                add("drums", drum_snare, at, .54 * e,
                    -.025 if downbeat == 1 else .025)
            for subdivision in range(4):
                stamp = at + subdivision * BEAT / 4
                if in_drop(stamp) or stamp >= 73:
                    continue
                if e < .7 and subdivision % 2:
                    continue
                accent = (1.0, .35, .64, .43)[subdivision]
                add("drums", hat(), stamp, .125 * e * accent,
                    (-.35, .27, .39, -.22)[subdivision])
            if full and downbeat in (0, 2):
                add("drums", hat(True), at + BEAT / 2, .08 * e, .48)
            if beat_index % 8 == 7 and e > .8:
                for part in (.5, .75):
                    add("drums", drum_snare, at + BEAT * part, .10 * e, -.2)
        beat_index += 1
        at = 4 + beat_index * BEAT

    # A sparse pluck lattice with stereo ping-pong reflections.
    at, step = 4.0, 0
    sequence = [0, 2, None, 4, 1, None, 3, 2, 0, None, 4, 2, 1, 3, None, 2]
    while at < 73:
        _, notes = harmony(at)
        pick = sequence[step % len(sequence)]
        if pick is not None:
            dropping = in_drop(at)
            if not dropping or step % 4 == 0:
                p = (-.43, .33, -.22, .52)[step % 4]
                amp = .17 * energy(at) * (.66 if dropping else 1)
                if 51 <= at < 58:
                    amp *= 1.25
                add("sequence", pluck(notes[pick] + 12), at, amp, p,
                    echoes=((BEAT * .75, .30, -p),
                            (BEAT * 1.5, .15, p),
                            (BEAT * 2.25, .07, -p)))
        step += 1
        at = 4 + step * BEAT / 2

    # A four-note identity returns at training, AI and the closing montage.
    for origin, amount in ((7.0, .7), (24.5, .8), (43.0, .75),
                            (52.1, .7), (65.1, 1.0), (69.3, .75)):
        for delay, number, strength in ((0, 72, .9), (BEAT * .75, 79, .68),
                                        (BEAT * 1.75, 82, .70),
                                        (BEAT * 3.0, 74, .78)):
            add("motif", pluck(number, .86, 6), origin + delay,
                .20 * strength * amount, -.18 if number % 2 else .18,
                echoes=((BEAT * .75, .28, -.7), (BEAT * 1.5, .12, .7)))

    # Chapters use exact picture timings; the underlying musical grid stays 112.
    for i, cut in enumerate(CHAPTERS[1:]):
        strength = .62 if cut in (17, 58, 73) else .84
        whoosh(cut - .53, .53, .11 if cut != 31 else .16,
               1 if i % 2 == 0 else -1)
        impact(cut, strength)
        add("fx", pluck(79 if i % 2 else 74, .54, 5), cut + .05,
            .115, .6 if i % 2 else -.6,
            echoes=((.15, .26, -.6), (.28, .13, .6)))

    # Picture sync: stone drops, format snaps, VCF error/success, engine ignition.
    for at, pitch, gain, pan in (
        (5.6, 0, .24, -.2), (8.1, 2, .23, .2),
        (11.5, 5, .18, -.6), (11.77, 3, .18, -.3), (12.04, 7, .18, .3),
        (12.31, 10, .18, .6), (19.2, 0, .20, -.4), (20.5, 2, .23, .35),
        (26.6, -5, .22, -.3), (28.1, 7, .27, .3),
        (44.8, 0, .25, 0), (46.9, 2, .27, .1), (49.1, -2, .24, -.1),
        (51.5, 7, .17, -.55), (52.6, 3, .17, .55),
        (53.7, 10, .17, -.35), (54.8, 5, .17, .35), (56.0, 2, .17, 0),
        (61.0, 0, .22, 0), (74.2, -3, .43, 0)
    ):
        add("fx", wood_click(pitch), at, gain, pan,
            echoes=((.085, .13, -pan),))

    # A noise-driven motor rise precedes the engine drop, rather than a siren.
    for origin, duration in ((31.15, 1.73), (63.1, 1.82)):
        t = time_axis(duration)
        p = t / duration
        noise = fft_filter(RNG.standard_normal(len(t)), 900, 8100)
        gate = .42 + .58 * (np.sin(2 * np.pi * (9 + 11 * p) * t) ** 2)
        add("fx", fade(noise * p ** 1.8 * gate, .05, .03), origin, .08, -.1)
        impact(origin + duration, .68)

    # Resolution has room for the title and logo, with a dry final stone.
    for side in (-1, 1):
        add("chords", chord([60, 63, 67, 74, 79], 4.6, side), 73.12,
            .22, side * .83, echoes=((.19, .18, -side * .8), (.41, .1, side * .8)))
    add("motif", pluck(72, 1.2, 5), 74.2, .15, 0,
        echoes=((.26, .26, -.7), (.52, .11, .7)))


def mix():
    # Sidechain the harmonic layers against each kick; keep FX transients intact.
    duck = np.ones(N, dtype=np.float32)
    for beat_index in range(round((73 - 4) / BEAT) + 1):
        at = 4 + beat_index * BEAT
        if in_drop(at):
            continue
        full = 24 <= at < 58 or at >= 65
        if not full and beat_index % 4 not in (0, 2):
            continue
        n = round(.25 * SR)
        a, b = round(at * SR), min(N, round(at * SR) + n)
        duck[a:b] = np.minimum(duck[a:b],
            .48 + .52 * (1 - np.exp(-np.arange(b - a) / (SR * .069))))
    for name in ("chords", "sequence", "motif"):
        BUS[name] *= duck[:, None]
    BUS["bass"] *= (.72 + .28 * duck[:, None])
    result = sum(BUS.values())
    # Very light saturation creates peak headroom without flattening drum attacks.
    result = np.tanh(result * 1.10) / 1.10
    # Remove DC and only the inaudible bottom octave.
    for channel in range(2):
        result[:, channel] = fft_filter(result[:, channel], 22, 19800)
    # Widen the mid/high design layer while keeping the bass and transients
    # mostly centred.  This is deliberately below the edge of audible phase
    # smear, so phone speakers still collapse cleanly to mono.
    mid = (result[:, 0] + result[:, 1]) * .5
    side = (result[:, 0] - result[:, 1]) * .5
    side = fft_filter(side, 185, 17000) * 3.0
    result[:, 0] = mid + side
    result[:, 1] = mid - side
    result[:round(.10 * SR)] *= np.linspace(0, 1, round(.10 * SR))[:, None]
    result[-round(1.55 * SR):] *= np.cos(np.linspace(0, np.pi / 2,
                                                  round(1.55 * SR)))[:, None] ** 2
    peak = float(np.max(np.abs(result)))
    result *= .88 / max(peak, 1e-9)
    return result.astype(np.float32)


def write_pcm(path, audio):
    with wave.open(str(path), "wb") as output:
        output.setnchannels(2)
        output.setsampwidth(3)
        output.setframerate(SR)
        integer = np.rint(np.clip(audio, -1, 1) * 8388607).astype(np.int32).reshape(-1)
        packed = np.empty((len(integer), 3), dtype=np.uint8)
        packed[:, 0] = integer & 255
        packed[:, 1] = (integer >> 8) & 255
        packed[:, 2] = (integer >> 16) & 255
        output.writeframes(packed.tobytes())


def run(command):
    result = subprocess.run([str(x) for x in command], capture_output=True,
                            text=True, encoding="utf-8", errors="replace", check=True)
    return result.stdout + result.stderr


def loudness_json(log):
    start, end = log.rfind("{"), log.rfind("}")
    if start < 0 or end < start:
        raise RuntimeError("FFmpeg did not return loudness measurements")
    return json.loads(log[start:end + 1])


def master(raw_path):
    first = loudness_json(run([FFMPEG, "-hide_banner", "-i", raw_path,
        "-af", "loudnorm=I=-16:TP=-1.2:LRA=9:print_format=json",
        "-f", "null", "-"]))
    settings = (
        "loudnorm=I=-16:TP=-1.2:LRA=9:"
        f"measured_I={first['input_i']}:measured_TP={first['input_tp']}:"
        f"measured_LRA={first['input_lra']}:measured_thresh={first['input_thresh']}:"
        f"offset={first['target_offset']}:linear=true:print_format=json"
    )
    run([FFMPEG, "-hide_banner", "-y", "-i", raw_path, "-af", settings,
         "-ar", SR, "-ac", 2, "-c:a", "pcm_s24le", OUT])
    checked = loudness_json(run([FFMPEG, "-hide_banner", "-i", OUT,
        "-af", "loudnorm=I=-16:TP=-1:LRA=9:print_format=json",
        "-f", "null", "-"]))
    probe = json.loads(run([FFPROBE, "-v", "error", "-show_entries",
        "format=duration,size:stream=codec_name,sample_rate,channels,bits_per_sample",
        "-of", "json", OUT]))
    return checked, probe


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    print("Synthesizing original v1.1.9 score: 78 s / 112 BPM / 48 kHz stereo", flush=True)
    arrange()
    audio = mix()
    mid = (audio[:, 0] + audio[:, 1]) * .5
    side = (audio[:, 0] - audio[:, 1]) * .5
    correlation = float(np.corrcoef(audio[:, 0], audio[:, 1])[0, 1])
    stereo_ratio = float(np.sqrt(np.mean(side ** 2)) / np.sqrt(np.mean(mid ** 2)))
    with tempfile.TemporaryDirectory(prefix="banbu-bgm-v2-") as directory:
        raw_path = Path(directory) / "score-raw.wav"
        write_pcm(raw_path, audio)
        print("Applying two-pass loudness normalization and checking output", flush=True)
        checked, probe = master(raw_path)
    metrics = {
        "output": str(OUT), "duration_seconds": DURATION, "bpm": BPM,
        "chapters_seconds": CHAPTERS,
        "integrated_lufs": float(checked["input_i"]),
        "true_peak_dbtp": float(checked["input_tp"]),
        "loudness_range_lu": float(checked["input_lra"]),
        "stereo_correlation": round(correlation, 4),
        "side_mid_rms_ratio": round(stereo_ratio, 4),
        "technical": probe,
    }
    print(json.dumps(metrics, ensure_ascii=False, indent=2), flush=True)
    if abs(metrics["integrated_lufs"] + 16) > .3:
        raise RuntimeError("Integrated loudness missed the -16 LUFS target")
    if metrics["true_peak_dbtp"] > -1:
        raise RuntimeError("True peak exceeds -1 dBTP")


if __name__ == "__main__":
    main()
