"""Synthesize the demo soundtrack (music bed + UI sound effects) from out/events.json."""
import json
import wave
from pathlib import Path

import numpy as np

SR = 48000
DUR = 30.0
OUT = Path(__file__).parent / "out"
rng = np.random.default_rng(7)

N = int(SR * DUR)
music = np.zeros((N, 2))
sfx = np.zeros((N, 2))


def t_axis(sec):
    return np.arange(int(SR * sec)) / SR


def place(buf, t, sig, gain=1.0, pan=0.0):
    i = int(round(t * SR))
    if i >= N or i + len(sig) <= 0:
        return
    if sig.ndim == 1:
        sig = np.stack([sig * np.sqrt(0.5 * (1 - pan)), sig * np.sqrt(0.5 * (1 + pan))], axis=1) * np.sqrt(2)
    j = max(0, i)
    s = sig[j - i: min(len(sig), N - i)]
    buf[j: j + len(s)] += s * gain


def onepole_lp(x, fc):
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x)
    acc = 0.0
    for n, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        y[n] = acc
    return y


def hp(x, fc):
    return x - onepole_lp(x, fc)


def bp(x, lo, hi):
    return onepole_lp(hp(x, lo), hi)


def env_exp(n, tau):
    return np.exp(-np.arange(n) / SR / tau)


def fade_in(sig, sec):
    k = min(len(sig), int(sec * SR))
    sig[:k] *= np.linspace(0, 1, k)
    return sig


def note_hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


# ---------------- instruments ----------------
def kick(gain=1.0):
    t = t_axis(0.5)
    f = 48 + 110 * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * env_exp(len(t), 0.22)
    click = hp(rng.standard_normal(len(t)), 1500) * env_exp(len(t), 0.004) * 0.25
    return (body + click) * gain


def clap():
    t = t_axis(0.35)
    n = rng.standard_normal(len(t))
    e = np.zeros(len(t))
    for k, d in enumerate([0, 0.011, 0.022]):
        i = int(d * SR)
        e[i:] += env_exp(len(t) - i, 0.006 if k < 2 else 0.09)
    tone = np.sin(2 * np.pi * 190 * t) * env_exp(len(t), 0.05) * 0.4
    return bp(bp(n, 700, 3000), 700, 3000) * e * 1.4 + tone


def hat(open_=False):
    t = t_axis(0.3 if open_ else 0.08)
    n = rng.standard_normal(len(t))
    return hp(hp(n, 7000), 7000) * env_exp(len(t), 0.09 if open_ else 0.018) * 0.5


def ep_note(midi, sec, vel=1.0):
    t = t_axis(sec)
    f = note_hz(midi)
    out = np.zeros((len(t), 2))
    for k, amp in enumerate([1.0, 0.45, 0.22, 0.12, 0.05], start=1):
        decay = env_exp(len(t), 1.6 / k)
        for ch, det in enumerate([-0.0018, 0.0018]):
            out[:, ch] += amp * np.sin(2 * np.pi * f * k * (1 + det) * t + ch * 0.7) * decay
    trem = 1 + 0.08 * np.sin(2 * np.pi * 4.2 * t)
    out *= (trem * vel)[:, None]
    out[: int(0.004 * SR)] *= np.linspace(0, 1, int(0.004 * SR))[:, None]
    rel = int(0.08 * SR)
    out[-rel:] *= np.linspace(1, 0, rel)[:, None]
    return out


def bass_note(midi, sec):
    t = t_axis(sec)
    f = note_hz(midi)
    s = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) + 0.12 * np.sin(6 * np.pi * f * t)
    e = np.minimum(1, t / 0.008) * np.exp(-t / 0.9)
    rel = int(0.05 * SR)
    e[-rel:] *= np.linspace(1, 0, rel)
    return s * e


# ---------------- music bed ----------------
BAR0 = 1.9
OUTRO = 25.5
BEAT = (OUTRO - BAR0) / 40
CHORDS = [  # Am9, Fmaj7, Cmaj7, G6 (midi voicings)
    (45, [57, 60, 64, 67, 71]),
    (41, [57, 60, 64, 65, 69]),
    (36, [55, 59, 60, 64, 67]),
    (43, [55, 59, 62, 64, 67]),
]

kick_env = np.zeros(N)
k_s = kick()
c_s = clap()
for bar in range(10):
    t_bar = BAR0 + bar * 4 * BEAT
    root, voicing = CHORDS[bar % 4]
    full = bar >= 1
    for b, g in [(0, 1.0), (1.5, 0.7), (2.5, 0.85)] if full else [(0, 0.9), (2.5, 0.7)]:
        place(music, t_bar + b * BEAT, k_s, 0.85 * g)
        i = int((t_bar + b * BEAT) * SR)
        kick_env[i: i + int(0.25 * SR)] = np.maximum(kick_env[i: i + int(0.25 * SR)], env_exp(min(int(0.25 * SR), N - i), 0.09))
    if full:
        for b in (1, 3):
            place(music, t_bar + b * BEAT, c_s, 0.3)
    for e8 in range(8):
        swing = 0.06 * BEAT if e8 % 2 else 0
        vel = 0.5 if e8 % 2 else 0.8
        place(music, t_bar + e8 * BEAT / 2 + swing, hat(open_=(e8 == 7 and bar % 2 == 1)), 0.2 * vel, pan=0.25)
    chord = sum(ep_note(m, 4 * BEAT + 0.4, 0.9) for m in voicing)
    place(music, t_bar, chord, 0.075)
    stab = sum(ep_note(m + 12, 1.2 * BEAT, 0.7) for m in voicing[1:4])
    place(music, t_bar + 2.5 * BEAT, stab, 0.035, pan=-0.2)
    place(music, t_bar, bass_note(root + 12, 1.4 * BEAT), 0.22)
    place(music, t_bar + 1.5 * BEAT, bass_note(root + 12, 0.45 * BEAT), 0.14)
    place(music, t_bar + 2.5 * BEAT, bass_note(root + 12, 1.4 * BEAT), 0.19)

duck = 1 - 0.35 * kick_env
music *= duck[:, None]

# Outro: one big downbeat hit and a long Am9 ring-out.
place(music, OUTRO, kick(1.25), 1.0)
sub = np.sin(2 * np.pi * 44 * t_axis(2.5)) * env_exp(int(2.5 * SR), 0.8)
place(music, OUTRO, fade_in(sub, 0.01), 0.45)
crash = hp(hp(rng.standard_normal(int(3 * SR)), 4000), 4000) * env_exp(int(3 * SR), 0.9)
place(music, OUTRO, crash, 0.06)
ring = sum(ep_note(m, 4.5, 1.0) for m in [45, 57, 60, 64, 67, 71, 76])
place(music, OUTRO, ring, 0.075)


# ---------------- sound effects ----------------
def bounce(gain):
    t = t_axis(0.45)
    f = 95 + 140 * np.exp(-t / 0.02)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(len(t), 0.11)
    ring = np.sin(2 * np.pi * 330 * t) * env_exp(len(t), 0.05) * 0.18
    slap = bp(rng.standard_normal(len(t)), 600, 3500) * env_exp(len(t), 0.006) * 0.5
    return (body + ring + slap) * gain


def whoosh(sec, peak=0.6, lo=300, hi=5000):
    n = int(sec * SR)
    x = rng.standard_normal(n)
    u = np.linspace(0, 1, n)
    shape = np.sin(np.pi * u ** 0.8) ** 2
    fc = lo + (hi - lo) * np.sin(np.pi * np.clip(u / peak, 0, 1) * 0.5) ** 2
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty(n)
    acc = 0.0
    for i in range(n):
        acc = (1 - a[i]) * x[i] + a[i] * acc
        y[i] = acc
    return hp(y, 150) * shape * 2.5


def blip(f0, f1, sec=0.09, tau=0.05):
    t = t_axis(sec)
    f = f0 + (f1 - f0) * np.minimum(1, t / (sec * 0.6))
    s = np.sin(2 * np.pi * np.cumsum(f) / SR)
    return fade_in(s * env_exp(len(t), tau), 0.003)


def pop(base):
    a = blip(base, base * 1.5, 0.08, 0.035)
    b = blip(base * 1.5, base * 2, 0.12, 0.05)
    out = np.zeros(int(0.2 * SR))
    out[: len(a)] += a
    i = int(0.055 * SR)
    out[i: i + len(b)] += b * 0.8
    return out


def chime(notes, step=0.07, tau=0.35):
    out = np.zeros(int((step * len(notes) + 1.0) * SR))
    for k, m in enumerate(notes):
        t = t_axis(1.0)
        f = note_hz(m)
        s = (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t)) * env_exp(len(t), tau)
        i = int(k * step * SR)
        out[i: i + len(s)] += fade_in(s, 0.002)
    return out


def tick(f=2600, gain=1.0):
    t = t_axis(0.03)
    s = np.sin(2 * np.pi * f * t) * env_exp(len(t), 0.004)
    n = hp(rng.standard_normal(len(t)), 3000) * env_exp(len(t), 0.002) * 0.6
    return (s + n) * gain


for tb, g in [(0.42, 1.0), (0.74, 0.6), (0.94, 0.35)]:
    place(sfx, tb, bounce(g), 0.75)
place(sfx, 0.5, chime([69, 76], step=0.09, tau=0.6), 0.05, pan=0.1)
place(sfx, 1.45, whoosh(1.0, peak=0.55), 0.22)
place(sfx, 25.0, whoosh(0.7, peak=0.4, lo=200, hi=2500), 0.2)
for tb, g in [(26.4, 0.55), (26.68, 0.3)]:
    place(sfx, tb, bounce(g), 0.6, pan=-0.25)

events = json.loads((OUT / "events.json").read_text())
ALERT_PITCH = {"BIRTHDAY": 784, "PREGAME": 698, "CONFLICT": 523, "FOLLOW UP": 659, "LIFE UPDATE": 740}
for e in events:
    t = e["t"]
    if e["type"] == "click":
        place(sfx, t, tick(2400, 1.0), 0.16)
        if e["target"] in ("fullReport", "integrations"):
            place(sfx, t + 0.02, whoosh(0.35, peak=0.3, lo=400, hi=3500), 0.12)
    elif e["type"] == "key":
        place(sfx, t, tick(1800 + rng.uniform(-300, 300), 0.8), 0.07, pan=rng.uniform(-0.2, 0.2))
    elif e["type"] == "enter":
        place(sfx, t, tick(1500, 1.2), 0.14)
    elif e["type"] == "agent" and t > 2:
        place(sfx, t, blip(520, 780, 0.12, 0.06), 0.11, pan=-0.15)
    elif e["type"] == "alert":
        kind = e.get("kind", "")
        if kind in ("SENT", "SYNCED"):
            notes = [76, 81, 88] if t > 23.5 else [76, 83]
            place(sfx, t + 0.03, chime(notes, step=0.075), 0.085 if t > 23.5 else 0.06, pan=0.3)
        elif t < 25:
            place(sfx, t, pop(ALERT_PITCH.get(kind, 700)), 0.1, pan=0.35)


# ---------------- mix ----------------
def reverb(x, sec=1.4, mix=0.18):
    n = int(sec * SR)
    ir = rng.standard_normal((n, 2)) * env_exp(n, sec / 5)[:, None]
    ir[: int(0.01 * SR)] = 0
    size = 1 << int(np.ceil(np.log2(len(x) + n)))
    wet = np.stack([np.fft.irfft(np.fft.rfft(x[:, c], size) * np.fft.rfft(ir[:, c], size), size)[: len(x)] for c in range(2)], axis=1)
    wet *= np.sqrt(np.mean(x ** 2) / max(1e-12, np.mean(wet ** 2)))
    return x * (1 - mix) + wet * mix


music = reverb(music, 1.6, 0.16)
sfx = reverb(sfx, 1.0, 0.12)
mix = music * 0.5 + sfx * 1.6
tt = np.arange(N) / SR
mix *= np.clip((DUR - tt) / 0.7, 0, 1)[:, None]
mix *= np.clip(tt / 0.02, 0, 1)[:, None]
mix = np.tanh(mix * 1.6) / np.tanh(1.6)
mix *= 0.7 / np.max(np.abs(mix))

pcm = (mix * 32767).astype("<i2")
with wave.open(str(OUT / "audio.wav"), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("wrote", OUT / "audio.wav")
