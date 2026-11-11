#!/usr/bin/env python3
"""Run the probe23 cartridge (docs/PROBE_DOCK23.md) in ZEsarUX 13.0 (headless, stock TS2068 ROM, ZRCP) and check the ZEsarUX column.

  python3 tools/xemu/zesarux-probe23.py [build/probe23.dck] [--timeout 120] [--port 10778]

Adapted from Leap-IDE arcade/spike/bank/zesarux.py: ZEsarUX started from ~/Applications/ZEsarUX-13.0 with --vo null --ao null, ZRCP client
from ~/ts2068-debug, smartload, memory zone 0 (Machine RAM: CPU address - $4000) and zone 19 (DOCK).
Checks: (1) record, (2) interrupts vs T-states MAINC..FRCAP, (3) display RAM samples while running, (4) DOCK chunks 2, 3 unchanged.
"""
import argparse
import re
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path.home() / "ts2068-debug"))
from ts2068_debug.zrcp import ZRCPClient  # noqa: E402

ZDIR = Path.home() / "Applications/ZEsarUX-13.0"
ROOT = Path(__file__).resolve().parents[2]
FRAME_T = 69888
N = 2000
ISR_OFF = 0x17FF


def syms():
    o = {}
    for line in (ROOT / "build/probe23/out.sym").read_text().splitlines():
        m = re.match(r"^(\S+):\s+EQU\s+0x([0-9A-Fa-f]+)", line)
        if m:
            o[m.group(1)] = int(m.group(2), 16)
    return o


def model(off):
    """expected display file 1 byte at $4000 + off"""
    return ((7 * (off // 3) + 1) & 0xFF) if (off % 3 == 0 and off // 3 < N) else 0


MODEL = [model(o) for o in range(0x1800)]


def rd(c, addr, n):
    out = b""
    while n > 0:
        k = min(n, 8192)
        txt = c.command(f"read-memory {addr} {k}")
        out += bytes.fromhex("".join(txt.split()))
        addr += k
        n -= k
    return out


def dck_chunks(path):
    d = Path(path).read_bytes()
    return {i: d[9 + 8192 * i: 9 + 8192 * (i + 1)] for i in range(6)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dck", nargs="?", default=str(ROOT / "build/probe23.dck"))
    ap.add_argument("--timeout", type=float, default=120)
    ap.add_argument("--port", type=int, default=10778)
    a = ap.parse_args()
    S = syms()
    ZRAM = lambda addr: addr - 0x4000
    chunks = dck_chunks(a.dck)

    proc = subprocess.Popen(
        ["zesarux", "--noconfigfile", "--machine", "TS2068", "--enable-remoteprotocol", "--remoteprotocol-port", str(a.port),
         "--vo", "null", "--ao", "null", "--romfile", str(ZDIR / "ts2068.rom")],
        cwd=ZDIR, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ok = False
    try:
        c = ZRCPClient(port=a.port)
        c.connect()
        c.command("set-memory-zone 0")
        c.command("enable-breakpoints")
        c.command(f"set-breakpoint 1 PC={S['MAINC']}")
        c.command("set-breakpointaction 1 reset-tstatp")
        for k in range(4):
            c.command(f"set-breakpoint {2 + k} PC={S['FRCAP']}")
            c.command(f"set-breakpointaction {2 + k} write {0xFB80 + k} (TSTATESP/{1 << (8 * k)})&255")
        c.command(f"smartload {Path(a.dck).resolve()}")
        t0 = time.time()
        samples = 0; boot = 0; boot_bad = 0; bad_bmp = 0; bad_attr = 0; mapped = 0; mapped_vals = {}; first_bad = None
        fill_samples = 0; done = False; rec = b""
        shadow_addr = ZRAM(S["V_SHADOW_F4"])
        while time.time() - t0 < a.timeout:
            sh = rd(c, shadow_addr, 1)[0]
            f1 = rd(c, ZRAM(0x4000), 0x1B00)
            rec = rd(c, ZRAM(0xFF00), 4)
            if rec[:2] == b"\xA5\x5A":
                done = True
                break
            if sh not in (0x33, 0x3F):
                # the cartridge has not finished its init yet (it sets the shadow of $F4 last; before that chunk 7 holds power-on
                # RAM): the display is still the ROM's / power-on one.  Counted and reported, not part of the run check.
                boot += 1
                bmp0, att0 = f1[:0x1800], f1[0x1800:]
                if any(bmp0[o] != MODEL[o] and bmp0[o] != 0 for o in range(0x1800) if o != ISR_OFF) or any(x != 0x38 for x in att0):
                    boot_bad += 1
                time.sleep(0.03)
                continue
            samples += 1
            if sh == 0x3F:
                mapped += 1
            mapped_vals[sh] = mapped_vals.get(sh, 0) + 1
            bmp = f1[:0x1800]
            att = f1[0x1800:]
            bb = [o for o in range(0x1800) if o != ISR_OFF and bmp[o] != MODEL[o] and bmp[o] != 0]
            if bb:
                bad_bmp += 1
                if first_bad is None:
                    o = bb[0]
                    first_bad = f"sample {samples}, offset ${o:04X}: read {bmp[o]:#04x}, model {MODEL[o]:#04x}"
            if any(x != 0x38 for x in att):
                if all(x in (0x38, 0x20) for x in att):
                    fill_samples += 1     # taken during the final fill: allowed
                else:
                    bad_attr += 1
                    if first_bad is None:
                        first_bad = f"sample {samples}: attribute bytes {sorted(set(att))}"
            time.sleep(0.03)
        if not done:
            print(f"timeout after {a.timeout}s (marker seen: {rec[:2] == b'\\xA5\\x5A'})")
            sys.exit(1)
        time.sleep(0.2)
        t = int.from_bytes(rd(c, ZRAM(0xFB80), 4), "little")
        r = rd(c, ZRAM(0xFF00), 12)
        final = rd(c, ZRAM(0x5800), 0x300)
        state, kind = r[2], r[3]
        iters = r[4] | (r[5] << 8)
        frames = r[6] | (r[7] << 8)
        irqapp = r[8] | (r[9] << 8)
        addr = r[10] | (r[11] << 8)
        print(f"record: marker {r[0]:02X} {r[1]:02X} state {state} kind {kind} iterations {iters} V_FRAMES {frames} V_IRQAPP {irqapp} addr ${addr:04X}")
        print(f"T-states MAINC..FRCAP {t} -> {t / FRAME_T:.2f} frames of {FRAME_T} T")
        print(f"final attributes: {sorted(set(final))}")
        c.command("set-memory-zone 19")
        dock = {ch: rd(c, ch * 8192, 8192) for ch in (2, 3)}
        c.command("set-memory-zone 0")
        dock_bad = {ch: sum(1 for i in range(8192) if dock[ch][i] != chunks[ch][i]) for ch in (2, 3)}
        print(f"DOCK chunks 2, 3 bytes differing from the DCK after the run: {dock_bad}")
        print(f"pre-init samples (shadow not $33/$3F, cartridge still initialising, excluded): {boot}, of them not matching: {boot_bad}")
        print(f"display samples while running: {samples}; bitmap-bad {bad_bmp}; attribute-bad {bad_attr}; "
              f"taken during the final fill ($20 mixed in, allowed): {fill_samples}; "
              f"taken with the $F4 shadow = $3F: {mapped}; shadow values {({hex(k): v for k, v in sorted(mapped_vals.items())})}"
              + (f"; first bad: {first_bad}" if first_bad else ""))
        diff = abs(frames - t / FRAME_T)
        res = [
            ("1 record: marker, state 1, kind 0, iterations 2000, V_IRQAPP > 0",
             state == 1 and kind == 0 and iters == N and irqapp > 0,
             f"state {state}, kind {kind}, iterations {iters}, V_IRQAPP {irqapp}"),
            ("2 interrupts: |R_FRAMES - T/69888| <= 1", diff <= 1.0, f"R_FRAMES {frames}, T/69888 = {t / FRAME_T:.2f}, diff {diff:.2f}"),
            ("3 display RAM samples are model or 0, attributes $38 (until final fill)", bad_bmp == 0 and bad_attr == 0 and samples > 0,
             f"{samples} samples, {mapped} with shadow $3F, bitmap-bad {bad_bmp}, attribute-bad {bad_attr}"),
            ("3b final attributes all $20", set(final) == {0x20}, f"{sorted(set(final))}"),
            ("4 DOCK chunks 2, 3 identical to the DCK", all(v == 0 for v in dock_bad.values()), f"differing bytes {dock_bad}"),
        ]
        for name, v, num in res:
            print(f"  {'PASS' if v else 'FAIL'}  {name}: {num}")
        ok = all(v for _, v, _ in res)
        c.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
