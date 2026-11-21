"""Mixes the reel audio: voiceover + original music bed (ducked under the voice) + UI sound effects.
Output: reel-audio.wav (48 kHz stereo). Needs numpy + scipy and vo48.wav (the voiceover resampled to 48 kHz):
  ffmpeg -i voiceover.wav -ar 48000 -ac 1 vo48.wav && python3 mix.py
"""
import os
import numpy as np
from scipy.signal import butter, sosfilt
from scipy.io import wavfile

HERE = os.path.dirname(os.path.abspath(__file__))
SR = 48000
DUR = 59.2
N = int(SR * DUR)
rng = np.random.default_rng(3)
tx = lambda s: np.arange(int(SR * s)) / SR
lp = lambda x, f, o=2: sosfilt(butter(o, f, 'low', fs=SR, output='sos'), x)
hp = lambda x, f, o=2: sosfilt(butter(o, f, 'high', fs=SR, output='sos'), x)
bp = lambda x, a, b, o=2: sosfilt(butter(o, [a, b], 'band', fs=SR, output='sos'), x)
NOTE = lambda m: 440 * 2 ** ((m - 69) / 12)


def place(buf, sig, at, g=1.0):
    i = int(at * SR)
    if i >= len(buf) or i < 0:
        return
    n = min(len(sig), len(buf) - i)
    buf[i:i + n] += sig[:n] * g


# ---------------- music bed (original, ~96 BPM, F–C–G–Am) ----------------
BEAT = 60 / 96
PROG = [(53, [65, 69, 72]), (48, [64, 67, 72]), (55, [62, 67, 71]), (57, [64, 69, 72])]


def tri(f, s):
    ph = (f * tx(s)) % 1
    return 4 * np.abs(ph - .5) - 1


def music():
    L = np.zeros(N + SR); R = np.zeros(N + SR)
    bar = BEAT * 4
    for b in range(int(DUR / bar) + 1):
        root, chord = PROG[b % 4]
        t0 = b * bar
        # soft pad (detuned triangles, slow swell)
        e = np.minimum(1, tx(bar) / .6) * np.minimum(1, (bar - tx(bar)) / .4)
        pad = sum(tri(NOTE(m) * d, bar) for m in chord for d in (.997, 1.003)) * e * .035
        place(L, pad * .9, t0); place(R, pad * 1.1, t0)
        # bass on beats 1 and 3
        for k in (0, 2):
            s = np.sin(2 * np.pi * NOTE(root - 12) * tx(BEAT * 1.8)) * np.exp(-tx(BEAT * 1.8) * 2.5) * .22
            place(L, s, t0 + k * BEAT); place(R, s, t0 + k * BEAT)
        # pluck arp (8ths)
        seq = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[1] + 12]
        for k in range(8):
            s = lp(tri(NOTE(seq[k % 4]), .3), 3000) * np.exp(-tx(.3) * 14) * .05
            pan = .3 if k % 2 else -.3
            place(L, s * (1 - pan), t0 + k * BEAT / 2); place(R, s * (1 + pan), t0 + k * BEAT / 2)
        # soft beat: kick, rim, shaker
        for k in range(4):
            ts = t0 + k * BEAT
            kt = tx(.3); kick = np.sin(2 * np.pi * np.cumsum(48 + 70 * np.exp(-kt * 35)) / SR) * np.exp(-kt * 9) * .35
            if k in (0, 2):
                place(L, kick, ts); place(R, kick, ts)
            else:
                rim = bp(rng.standard_normal(int(.08 * SR)), 1500, 5000) * np.exp(-tx(.08) * 50) * .12
                place(L, rim, ts); place(R, rim, ts)
            sh = hp(rng.standard_normal(int(.05 * SR)), 6000) * np.exp(-tx(.05) * 70) * .05
            place(L, sh, ts + BEAT / 2); place(R, sh, ts + BEAT / 2)
    return np.stack([L[:N], R[:N]], 1)


# ---------------- sfx ----------------
def whoosh(s=.45, up=True):
    n = int(s * SR); x = rng.standard_normal(n); out = np.zeros(n); blk = 1024
    for i in range(0, n, blk):
        p = i / n; p = p if up else 1 - p
        f = 400 + 4500 * p ** 1.5
        out[i:i + blk] = bp(x[i:i + blk], f * .6, min(f * 1.6, 20000))
    env = np.sin(np.pi * np.linspace(0, 1, n)) ** 1.5
    return out * env * .5


def pop(f=900):
    t = tx(.12)
    return np.sin(2 * np.pi * (f + 900 * np.exp(-t * 40)) * t) * np.exp(-t * 35) * .5


def tick():
    t = tx(.03)
    return np.sin(2 * np.pi * 3200 * t) * np.exp(-t * 250) * .35


def key():
    t = tx(.04)
    return (hp(rng.standard_normal(len(t)), 2500) * .25 + np.sin(2 * np.pi * 180 * t) * .3) * np.exp(-t * 140)


def chime(notes, gap=.06, s=1.0):
    out = np.zeros(int((s + gap * len(notes)) * SR))
    for i, m in enumerate(notes):
        t = tx(s)
        b = sum(a * np.sin(2 * np.pi * NOTE(m) * r * t) * np.exp(-t * d) for r, a, d in [(1, 1, 4), (2, .4, 6), (3, .2, 9)])
        place(out, b * np.minimum(1, t * 300) * .18, i * gap)
    return out


def click():
    t = tx(.05)
    return np.sin(2 * np.pi * 1800 * t) * np.exp(-t * 120) * .4 + np.sin(2 * np.pi * 120 * t) * np.exp(-t * 60) * .3


fx = np.zeros(N)
cuts = [2.85, 5.8, 10.85, 19.7, 28.1, 34.75, 42.3, 48.1, 51.7]
for c in cuts:
    place(fx, whoosh(.5), c - .25, .55)
for k in range(22):                                    # timer ticks
    place(fx, tick(), .15 + k * .12, .5)
place(fx, chime([72, 76, 79]), 3.1, .9)                # "৫টি"
for i in range(5):
    place(fx, pop(700 + i * 120), 3.9 + i * .22, .35)
for k in range(14):                                    # typing the prompt
    place(fx, key(), 6.2 + k * .085, .45)
place(fx, pop(1100), 7.45, .3)
place(fx, chime([79, 84], .08, .8), 9.45, .8)          # "চলুন শুরু করি!"
for n in [11.07, 19.94, 28.39, 35.01, 42.51]:          # numbers
    place(fx, pop(600), n, .55)
for n in [48.6]:
    place(fx, chime([76, 83], .1, .9), n, .7)
for k in range(3):
    place(fx, pop(1000 + k * 150), 49.4 + k * .55, .3)
for k in range(4):                                     # typing "ক্লড"
    place(fx, key(), 53.55 + k * .16, .5)
place(fx, whoosh(.35), 54.45, .5)
for k in range(8):                                     # likes
    place(fx, pop(1300 + (k % 3) * 200), 54.7 + k * .17, .18)
place(fx, click(), 56.95, .8)
place(fx, chime([76, 79, 84], .07, 1.0), 57.0, .8)

# ---------------- voice ----------------
sr, vo = wavfile.read(os.path.join(HERE, 'vo48.wav'))
vo = vo.astype(float) / 32768
vo = hp(vo, 70)
vo /= np.abs(vo).max() / .8
voice = np.zeros(N); place(voice, vo, 0)

# duck the music under the voice
env = np.sqrt(np.abs(lp(voice ** 2, 6)))
duck = 1 - .6 * np.clip(env / (env.max() * .25), 0, 1)
duck = lp(duck, 3)
mus = music() * duck[:, None]
mus *= np.clip(tx(DUR) / .5, 0, 1)[:, None] * np.clip((DUR - tx(DUR)) / 1.2, 0, 1)[:, None]

mix = mus * .9 + (voice * 1.0)[:, None] + (fx * .8)[:, None]
mix = np.tanh(mix * 1.2) / np.tanh(1.2)
mix /= np.abs(mix).max() / .9
wavfile.write(os.path.join(HERE, 'reel-audio.wav'), SR, (mix * 32767).astype(np.int16))
print('wrote reel-audio.wav', DUR)
