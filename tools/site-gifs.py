#!/usr/bin/env python3
"""Builds the website's animated GIFs (pages/img/NAME.gif) from the frames tools/site-capture.mjs saved in build/site-frames/NAME/.
Frames are 512 x 192 (1 bit); the GIF is 512 x 384 (rows doubled: mode-6 pixels are twice as tall as wide), 50 ms a frame (every 3rd
emulator frame, 60.11 Hz), idle lead-in trimmed to 6 frames, the last frame held for 1.5 s. Run with plain `python3` (Pillow)."""
import os, sys
from PIL import Image, ImageChops
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC, OUT = os.path.join(ROOT, 'build/site-frames'), os.path.join(ROOT, 'pages/img')
os.makedirs(OUT, exist_ok=True)
names = sys.argv[1:] or sorted(os.listdir(SRC))
for name in names:
    d = os.path.join(SRC, name)
    files = sorted(f for f in os.listdir(d) if f.endswith('.png'))
    ims = [Image.open(os.path.join(d, f)).convert('L') for f in files]
    first = 0
    while first + 1 < len(ims) and ImageChops.difference(ims[first], ims[first + 1]).getbbox() is None: first += 1
    ims = ims[max(0, first - 5):]
    frames = [im.resize((512, 384), Image.NEAREST).convert('P', palette=Image.ADAPTIVE, colors=2) for im in ims]
    durs = [50] * len(frames)
    durs[-1] = 1500
    path = os.path.join(OUT, name + '.gif')
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=durs, loop=0, optimize=True, disposal=1)
    print(name, len(frames), 'frames', os.path.getsize(path) // 1024, 'KB')
