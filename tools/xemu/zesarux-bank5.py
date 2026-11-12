#!/usr/bin/env python3
"""Run the bank5 cartridge (docs/BANKING.md 7 test 8, 10.5) in ZEsarUX 13.0 (headless, stock TS2068 ROM, ZRCP) and compare it with TSRun.

  python3 tools/xemu/zesarux-bank5.py [build/bank5.dck] [--port 10782] [--timeout 120]

Needs the TSRun reference: this script runs `node tools/xemu/bank5-ref.mjs` first (that script does not build anything).
ZEsarUX is started as zesarux-probe23.py starts it and the DCK is loaded with smartload.  The run is polled (memory zone 0, CPU
address - $4000) until the self-test record at $FF00 has the marker $A5,$5A; then the display is read until two reads 1 s apart are equal.
Rows: (1) the record: state 1, kind 0, 400 iterations, (2) T_LOGN = TSRun's, (3) the sum of T_LOG's 2,048 bytes = TSRun's (read from
memory and from the record), (4) the display sum (record and settled display) = TSRun's, (5) V_IRQA > 0 and V_IRQR > 0 (V_FRAMES, V_IRQA,
V_IRQR are reported: they differ between emulators), (6) the settled display (12,288 bytes: $4000-$57FF, $6000-$77FF) = TSRun's byte for byte,
(7) DOCK chunks 2, 3 and 6 (memory zone 19) = the DCK after the run (ZEsarUX writes through into mapped DOCK chunks, so a stray write shows).
"""
import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path.home() / "ts2068-debug"))
from ts2068_debug.zrcp import ZRCPClient  # noqa: E402

ZDIR = Path.home() / "Applications/ZEsarUX-13.0"
ROOT = Path(__file__).resolve().parents[2]
NCHUNK = 7
CHECK_CHUNKS = (2, 3, 6)


def syms():
    o = {}
    for line in (ROOT / "build/bank5/out.sym").read_text().splitlines():
        m = re.match(r"^(\S+):\s+EQU\s+0x([0-9A-Fa-f]+)", line)
        if m:
            o[m.group(1)] = int(m.group(2), 16)
    return o


def rd(c, addr, n):
    out = b""
    while n > 0:
        k = min(n, 8192)
        txt = c.command(f"read-memory {addr} {k}", timeout=30)
        out += bytes.fromhex("".join(txt.split()))
        addr += k
        n -= k
    return out


def dck_chunks(path):
    d = Path(path).read_bytes()
    return {i: d[9 + 8192 * i: 9 + 8192 * (i + 1)] for i in range(NCHUNK)}


def locate(i):
    f, off = divmod(i, 6144)
    third, rest = divmod(off, 2048)
    y = third * 64 + ((rest >> 5) & 7) * 8 + (rest >> 8)
    col = ((off & 31) << 1) | f
    return 0x4000 + 0x2000 * f + off, col * 8, y


def w(b, o):
    return b[o] | (b[o + 1] << 8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dck", nargs="?", default=str(ROOT / "build/bank5.dck"))
    ap.add_argument("--port", type=int, default=10782)
    ap.add_argument("--timeout", type=float, default=120)
    a = ap.parse_args()

    subprocess.run(["node", str(ROOT / "tools/xemu/bank5-ref.mjs")], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    refdir = ROOT / "build/xemu/bank5-ref"
    outdir = ROOT / "build/xemu/bank5-zesarux"
    outdir.mkdir(parents=True, exist_ok=True)
    ref = json.loads((refdir / "bank5.json").read_text())
    refbin = (refdir / "bank5.bin").read_bytes()
    S = syms()
    Z = lambda addr: addr - 0x4000
    chunks = dck_chunks(a.dck)
    results = []

    proc = subprocess.Popen(
        ["zesarux", "--noconfigfile", "--machine", "TS2068", "--enable-remoteprotocol", "--remoteprotocol-port", str(a.port),
         "--vo", "null", "--ao", "null", "--romfile", str(ZDIR / "ts2068.rom")],
        cwd=ZDIR, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        c = ZRCPClient(port=a.port)
        c.connect()
        c.command("set-memory-zone 0")
        c.command(f"smartload {Path(a.dck).resolve()}")
        t0 = time.time()
        rec = b""
        while time.time() - t0 < a.timeout:
            rec = rd(c, Z(0xFF00), 20)
            if rec[:2] == b"\xA5\x5A" and w(rec, 4) == 400:
                break
            time.sleep(0.2)
        else:
            print(f"timeout after {a.timeout}s; record bytes {rec.hex(' ')}")
            sys.exit(1)
        t_rec = time.time() - t0
        time.sleep(1.0)                                      # a few frames more, then until the display is unchanged over 1 s

        def display():
            return rd(c, Z(0x4000), 6144) + rd(c, Z(0x6000), 6144)

        prev = display(); settled = False
        for _ in range(20):
            time.sleep(1.0)
            cur = display()
            if cur == prev:
                settled = True
                break
            prev = cur
        disp = prev
        rec = rd(c, Z(0xFF00), 20)
        c.command("enter-cpu-step")
        logs = rd(c, Z(S["T_LOG"]), 2048)
        logn = w(rd(c, Z(S["T_LOGN"]), 2), 0)
        c.command("set-memory-zone 19")
        dock = {ch: rd(c, ch * 8192, 8192) for ch in CHECK_CHUNKS}
        c.command("set-memory-zone 0")
        c.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()

    state, kind, iters = rec[2], rec[3], w(rec, 4)
    frames, irqa, irqr = w(rec, 6), w(rec, 8), w(rec, 10)
    r_logn, r_logsum, r_dispsum, pair = w(rec, 12), w(rec, 14), w(rec, 16), w(rec, 18)
    logsum = sum(logs) & 0xFFFF
    dispsum = sum(disp) & 0xFFFF
    print(f"record (after {t_rec:.1f} s wall clock): marker {rec[0]:02X} {rec[1]:02X} state {state} kind {kind} iterations {iters} "
          f"V_FRAMES {frames} V_IRQA {irqa} V_IRQR {irqr} T_LOGN {r_logn} T_LOG sum ${r_logsum:04X} display sum ${r_dispsum:04X} failPair {pair}")
    print(f"TSRun reference: V_FRAMES {ref['V_FRAMES']} V_IRQA {ref['V_IRQA']} V_IRQR {ref['V_IRQR']} T_LOGN {ref['T_LOGN']} "
          f"T_LOG sum ${ref['T_LOGSUM']:04X} display sum ${ref['DISPSUM']:04X}")
    results.append(("record: marker, state 1 (pass), kind 0, 400 iterations", rec[:2] == b"\xA5\x5A" and state == 1 and kind == 0 and iters == 400,
                    f"state {state}, kind {kind}, iterations {iters}, failPair {pair}"))
    results.append(("T_LOGN = TSRun's (record and memory)", r_logn == ref["T_LOGN"] and logn == ref["T_LOGN"], f"record {r_logn}, memory {logn}, TSRun {ref['T_LOGN']}"))
    results.append(("sum of T_LOG's 2,048 bytes = TSRun's (record and memory)", r_logsum == ref["T_LOGSUM"] and logsum == ref["T_LOGSUM"],
                    f"record ${r_logsum:04X}, memory ${logsum:04X}, TSRun ${ref['T_LOGSUM']:04X}"))
    results.append(("display sums = TSRun's (the record's, taken before the verdict text; the settled display's)",
                    r_dispsum == ref["DISPSUM"] and dispsum == ref["DISPSUM_settled"],
                    f"record ${r_dispsum:04X} (TSRun ${ref['DISPSUM']:04X}), settled ${dispsum:04X} (TSRun ${ref['DISPSUM_settled']:04X})"))
    results.append(("interrupts under A and under R both seen (V_IRQA > 0, V_IRQR > 0; reported)", irqa > 0 and irqr > 0,
                    f"V_FRAMES {frames} (TSRun {ref['V_FRAMES']}), V_IRQA {irqa} (TSRun {ref['V_IRQA']}), V_IRQR {irqr} (TSRun {ref['V_IRQR']})"))
    diffs = [i for i in range(12288) if disp[i] != refbin[i]]
    text = f"settled {settled}; display RAM " + (f"{len(diffs)} of 12288 bytes differ" if diffs else "12288 bytes identical to TSRun's")
    if diffs:
        (outdir / "bank5-zesarux.bin").write_bytes(disp)
        ad, x, y = locate(diffs[0])
        text += f"; first at ${ad:04X} (pixel x {x}..{x + 7}, y {y}): ZEsarUX ${disp[diffs[0]]:02X}, TSRun ${refbin[diffs[0]]:02X}; dump in {outdir}"
    results.append(("settled display (12,288 bytes) = TSRun's byte for byte", settled and not diffs, text))
    dock_bad = {ch: sum(1 for i in range(8192) if dock[ch][i] != chunks[ch][i]) for ch in CHECK_CHUNKS}
    results.append(("DOCK chunks 2, 3, 6 identical to the DCK after the run", all(v == 0 for v in dock_bad.values()), f"differing bytes {dock_bad}"))
    for name, ok, text in results:
        print(f"  {'PASS' if ok else 'FAIL'}  {name}: {text}")
    ok = all(x[1] for x in results)
    print(f"{'PASS' if ok else 'FAIL'}: bank5 on ZEsarUX 13.0: {sum(1 for x in results if x[1])} of {len(results)} rows")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
