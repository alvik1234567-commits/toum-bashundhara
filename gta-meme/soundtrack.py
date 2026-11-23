"""Synthesizes the ad's soundtrack (original music + SFX) to soundtrack.wav.

Everything is generated from scratch (no samples), timed to the animation in index.html.
Usage: python3 soundtrack.py   (needs numpy + scipy)
"""
import numpy as np
from scipy.signal import butter, sosfilt
from scipy.io import wavfile
import os

SR = 48000
# Real-time map of the animation (must match TMAP in index.html): [coreStart, coreEnd, realDuration]
TMAP = [(0, 8.5, 8.5), (8.5, 9.4, 1.6), (9.4, 10.1, .7), (10.1, 10.1, 2.6), (10.1, 13.7, 3.6), (13.7, 14.6, 2.9), (14.6, 17.2, 2.6), (17.2, 19, 3.8)]
DUR = sum(r[2] for r in TMAP) + .04
BUST = (8.5 + 1.6 + .7, 8.5 + 1.6 + .7 + 2.6)


def R(core):
    """animation time -> real (video) time; a hold row maps to its end"""
    acc = 0
    for a, b, d in TMAP:
        if b > a and a <= core <= b:
            return acc + (core - a) / (b - a) * d
        acc += d
    return acc
N = int(SR * DUR)
rng = np.random.default_rng(7)


def t_axis(sec):
    return np.arange(int(SR * sec)) / SR


def lp(x, f, order=2):
    return sosfilt(butter(order, f, 'low', fs=SR, output='sos'), x)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, 'high', fs=SR, output='sos'), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], 'band', fs=SR, output='sos'), x)


def place(buf, sig, at, gain=1.0):
    i = int(at * SR)
    if i >= len(buf):
        return
    n = min(len(sig), len(buf) - i)
    if sig.ndim == 1 and buf.ndim == 2:
        sig = np.stack([sig, sig], 1)
    buf[i:i + n] += sig[:n] * gain


def saw(freq, sec, detune=0.0):
    t = t_axis(sec)
    ph = (freq * (1 + detune)) * t
    return 2 * (ph - np.floor(ph + .5))


def env_adsr(sec, a=.005, d=.1, s=.6, r=.1):
    n = int(sec * SR)
    e = np.ones(n) * s
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    e[:na] = np.linspace(0, 1, na) if na else e[:na]
    e[na:na + nd] = np.linspace(1, s, len(e[na:na + nd]))
    if nr:
        e[-nr:] *= np.linspace(1, 0, len(e[-nr:]))
    return e


# ---------------------------------------------------------------- music
BEAT = (15.05 - 10.62) / 8           # 8 beats from the TV switching on to the end-card drop (~108 BPM)
NOTE = lambda m: 440 * 2 ** ((m - 69) / 12)
PROG = [(57, [57, 60, 64]), (53, [53, 57, 60]), (60, [60, 64, 67]), (55, [55, 59, 62])]  # Am F C G


def kick():
    t = t_axis(.45)
    f = 45 + 95 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7) * 1.0


def snare():
    t = t_axis(.25)
    n = bp(rng.standard_normal(len(t)), 1200, 7000) * np.exp(-t * 18)
    tone = np.sin(2 * np.pi * 185 * t) * np.exp(-t * 25)
    return (n * .7 + tone * .5)


def hat():
    t = t_axis(.06)
    return hp(rng.standard_normal(len(t)), 7000) * np.exp(-t * 80) * .35


def music(sec, drums_from=0.0, arp_from=0.0):
    """Synthwave loop, `sec` long. Drums/arp enter at the given times (seconds into the track)."""
    out = np.zeros((int(sec * SR) + SR, 2))
    bar = BEAT * 4
    nbars = int(np.ceil(sec / bar)) + 1
    for b in range(nbars):
        root, chord = PROG[b % 4]
        t0 = b * bar
        # pad: detuned saws, slow attack
        pad = sum(saw(NOTE(m), bar, d) for m in chord for d in (-.006, .006))
        pad = lp(pad, 1800) * env_adsr(bar, a=.25, d=.3, s=.8, r=.25) * .06
        place(out, np.stack([pad * .9, pad * 1.1], 1), t0)
        # bass: 8th-note pulses
        for k in range(8):
            ts = t0 + k * BEAT / 2
            s = lp(saw(NOTE(root - 24), BEAT / 2 * .9), 500) * env_adsr(BEAT / 2 * .9, a=.003, d=.08, s=.5, r=.04)
            place(out, s * .32, ts)
        # arp: 16ths over chord tones, with echo
        if t0 + bar > arp_from:
            seq = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[1] + 24]
            for k in range(16):
                ts = t0 + k * BEAT / 4
                if ts < arp_from:
                    continue
                m = seq[k % 4]
                s = lp(saw(NOTE(m), .16), 3500) * np.exp(-t_axis(.16) * 22) * .07
                pan = .35 if k % 2 else -.35
                place(out, np.stack([s * (1 - pan), s * (1 + pan)], 1), ts)
                place(out, np.stack([s * (1 + pan), s * (1 - pan)], 1) * .35, ts + BEAT * .75)
        # drums
        for k in range(4):
            ts = t0 + k * BEAT
            if ts < drums_from:
                continue
            place(out, kick(), ts, .55)
            if k % 2 == 1:
                place(out, snare(), ts, .32)
            place(out, hat(), ts + BEAT / 2, .5)
            place(out, hat(), ts + BEAT / 4 * 3, .25)
    return out[:int(sec * SR)]


# ---------------------------------------------------------------- sfx
def click(pitch=1.0):
    t = t_axis(.06)
    s = np.sin(2 * np.pi * 2600 * pitch * t) * np.exp(-t * 160) * .5
    s += hp(rng.standard_normal(len(t)), 2000) * np.exp(-t * 300) * .35
    s += np.sin(2 * np.pi * 140 * t) * np.exp(-t * 60) * .4
    return s


def bell(freq, sec=1.2):
    t = t_axis(sec)
    s = sum(a * np.sin(2 * np.pi * freq * r * t) * np.exp(-t * dcy)
            for r, a, dcy in [(1, 1, 3), (2.01, .45, 5), (3.02, .25, 7), (4.2, .12, 10)])
    return s * np.minimum(1, t * 400)


def cheat_chime():
    out = np.zeros(int(1.6 * SR))
    for i, m in enumerate([76, 79, 83, 88]):          # E5 G5 B5 E6 sparkle
        s = bell(NOTE(m), 1.3)
        i0 = int(i * .07 * SR)
        out[i0:i0 + len(s)] += s[:len(out) - i0] * .22
    return out


def whoosh(sec):
    n = int(sec * SR)
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    blk = 1024
    for i in range(0, n, blk):
        p = i / n
        f = 300 + 5000 * p ** 2
        seg = bp(noise[i:i + blk], f * .7, min(f * 1.4, 20000))
        out[i:i + blk] = seg
    return out * np.linspace(0, 1, n) ** 2 * .6


def boom():
    t = t_axis(2.0)
    f = 28 + 70 * np.exp(-t * 6)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.2) * 1.0
    s += lp(rng.standard_normal(len(t)), 900) * np.exp(-t * 5) * .8
    sparkle = sum(np.sin(2 * np.pi * (3000 + 1500 * k) * t * (1 + t * .5)) * np.exp(-t * (6 + k)) for k in range(3)) * .05
    return s + sparkle


def jet_engine(sec):
    t = t_axis(sec)
    brown = np.cumsum(rng.standard_normal(len(t)))
    brown = hp(brown, 25) / 400
    rumble = lp(brown, 400) * 2.5
    roar = bp(rng.standard_normal(len(t)), 500, 3000) * .25
    whine = np.sin(2 * np.pi * (2900 + 40 * np.sin(2 * np.pi * 3.3 * t)) * t) * .03
    flutter = 1 + .15 * np.sin(2 * np.pi * 17 * t)
    s = (rumble + roar * flutter + whine)
    return s


def crt_off():
    t = t_axis(.45)
    f = 9000 * np.exp(-t * 14) + 120
    zap = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 6) * .25
    thunk = np.sin(2 * np.pi * 70 * t) * np.exp(-t * 18) * .7
    crackle = hp(rng.standard_normal(len(t)), 3000) * np.exp(-t * 30) * .3
    return zap + thunk + crackle


def tv_on():
    t = t_axis(.9)
    static = bp(rng.standard_normal(len(t)), 800, 9000) * np.exp(-t * 6) * .55
    thump = np.sin(2 * np.pi * 60 * t) * np.exp(-t * 14) * .6
    whine = np.sin(2 * np.pi * 15700 * t) * np.exp(-t * 3) * .02
    return static + thump + whine


# ---------------------------------------------------------------- mix
mix = np.zeros((N, 2))
OFF = R(9.45)                      # TV switches off

# scenes 1-2: the game's music, muffled as if coming from the TV across the room
tvmus = music(OFF, drums_from=0, arp_from=0)
tvmus = np.stack([lp(tvmus[:, 0], 900, 4), lp(tvmus[:, 1], 900, 4)], 1).mean(1)
tvmus = tvmus + np.concatenate([np.zeros(int(.023 * SR)), tvmus[:-int(.023 * SR)]]) * .4
place(mix, tvmus * np.minimum(1, t_axis(OFF) / .4) * .55, 0)

for i in range(8):                 # controller inputs
    place(mix, click(1 + i * .04), 1.0 + i * .42, .55)
place(mix, cheat_chime(), 4.35, .9)
place(mix, whoosh(.4), 4.55, .8)   # jet spawn
place(mix, boom(), 4.95, .9)
eng = jet_engine(OFF - 5.0)
te = t_axis(OFF - 5.0)
ramp = (.25 + .75 * np.clip((te + 5.0 - 5.6) / (R(9.3) - 5.6), 0, 1)) * np.minimum(1, te / .3)
place(mix, eng * ramp * .55, 5.0)

# "BUT... IN REAL LIFE": error buzz
tb = t_axis(.35)
buzz = lp(np.sign(np.sin(2 * np.pi * 110 * tb)), 2500) * np.exp(-tb * 6) * .25
place(mix, buzz, R(8.52), 1)
place(mix, buzz, R(8.52) + .16, .8)

# TV off: everything cuts
mix[int(OFF * SR):] *= 0
place(mix, crt_off(), OFF, .9)

# BUSTED scene: police siren (wail -> yelp, two units slightly detuned, street echo) + hit when the title lands
ts = t_axis(BUST[1] - BUST[0])
def siren(t, detune=1.0):
    wail = 650 + 650 * (0.5 - 0.5 * np.cos(2 * np.pi * t / 1.1))          # slow rise/fall
    yelp = 750 + 550 * (0.5 - 0.5 * np.cos(2 * np.pi * t / 0.16))         # fast yelp
    f = np.where(t < 1.1, wail, yelp) * detune
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph) + .45 * np.sin(2 * ph) + .25 * np.sin(3 * ph)          # horn-speaker harmonics
    return bp(np.tanh(x * 1.6), 400, 4500)
SIREN_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'busted-siren.wav')
if os.path.exists(SIREN_FILE):                     # user-supplied siren clip, trimmed to the BUSTED screen
    _sr, clip = wavfile.read(SIREN_FILE)
    clip = clip.astype(float) / 32768
    clip = clip.mean(1) if clip.ndim == 2 else clip
    clip = clip[int(.2 * SR):int(.2 * SR) + len(ts)]
    clip = np.pad(clip, (0, len(ts) - len(clip)))
    sv = clip / (np.abs(clip).max() + 1e-9) * 2.4
else:
    sv = siren(ts) + .6 * siren(ts, 1.035)
echo = np.concatenate([np.zeros(int(.11 * SR)), sv[:-int(.11 * SR)]]) * .35
sv = (sv + echo) * np.minimum(1, ts / .08) * np.clip((ts[-1] - ts) / .2, 0, 1) * .14
place(mix, sv, BUST[0], 1)
place(mix, boom() * .9, BUST[0] + .45, 1)

place(mix, tv_on(), R(10.3), .8)

# scene 3: full music; pads + bass first, drums + arp drop with the end card
T3, DROP = R(10.62), R(15.05)
nb = max(4, round((DROP - T3) / .55))
BEAT = (DROP - T3) / nb
full = music(DUR - T3, drums_from=nb * BEAT, arp_from=(nb // 2) * BEAT)
tf = t_axis(DUR - T3)
full *= np.minimum(1, tf / .15)[:, None] * np.clip((DUR - T3 - tf) / 1.2, 0, 1)[:, None]
place(mix, full * 1.0, T3)
place(mix, whoosh(BEAT * 2) * .5, DROP - BEAT * 2, 1)
place(mix, kick() * 1.2, DROP, 1)

# master: gentle glue + limiter
mix = np.tanh(mix * 1.6) / np.tanh(1.6)
mix /= np.max(np.abs(mix)) / .89
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'soundtrack.wav')
wavfile.write(out, SR, (mix * 32767).astype(np.int16))
print('wrote', out, f'{DUR:.2f}s')
