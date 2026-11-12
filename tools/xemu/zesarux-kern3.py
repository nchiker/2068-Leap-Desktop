#!/usr/bin/env python3
"""Run the kern3demo cartridge (docs/OBJECTS_EVENTS.md 9 test 10, 15.4) in ZEsarUX 13.0 (headless, stock TS2068 ROM, ZRCP) and compare it with TSRun.

  python3 tools/xemu/zesarux-kern3.py [build/kern3demo.dck] [--port 10780]

Needs the TSRun reference (`node tools/xemu/kern3-ref.mjs`; this script runs it first, which also rebuilds the cartridge).  ZEsarUX is
started as zesarux-spike6.py starts it.  One breakpoint, at D_LOOP (the demo's event loop; with no input it is reached once per frame:
HALT, then JR D_LOOP), stops the run.  Waiting N frames is done by `run`-ning to D_LOOP until the partial T-state counter shows
at least N x 69,888 T (ZEsarUX's TS2068 frame; TSRun's is 58,688 T).
Rows: (1) the first stop at D_LOOP: record state 3, record bytes = TSRun's (marker, state 3, 26 log records, sum 7550, focused id 2),
(2) 100 frames later: the 12,288 display bytes = TSRun's settled screen, K_FOCUS = 0, (3) the screen is still the same 20 frames later,
(4) interrupts (frames of 69,888 T) over the waits, (5) CAPS SHIFT + 1 (TAB since 2026-11-12) sent as ZRCP send-keys-event (codes found by a sweep: 133 =
CAPS SHIFT, 49 = '1'; K_NOW shows the matrix) for 2 frames, released, 10 frames: K_FOCUS = view A's address (T_VIEWS + 2), (6) the screen
= TSRun's after the same key press, (7) DOCK chunks 0, 1, 4, 5 (memory zone 19) = the DCK.
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
FRAME_T = 69888
CHUNKS = (0, 1, 4, 5)
KEY_CS, KEY_1 = 133, 49          # util_teclas values: UTIL_KEY_SHIFT_L (row 0 bit 0 in K_NOW), ASCII '1' (row 3 bit 0)


def syms():
    o = {}
    for line in (ROOT / "build/kern3demo/out.sym").read_text().splitlines():
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
    return {ch: d[9 + 8192 * k: 9 + 8192 * (k + 1)] for k, ch in enumerate(CHUNKS)}


def locate(i):
    f, off = divmod(i, 6144)
    third, rest = divmod(off, 2048)
    y = third * 64 + ((rest >> 5) & 7) * 8 + (rest >> 8)
    col = ((off & 31) << 1) | f
    return 0x4000 + 0x2000 * f + off, col * 8, y


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dck", nargs="?", default=str(ROOT / "build/kern3demo.dck"))
    ap.add_argument("--port", type=int, default=10780)
    ap.add_argument("--timeout", type=float, default=120)
    a = ap.parse_args()

    subprocess.run(["node", str(ROOT / "tools/xemu/kern3-ref.mjs")], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    refdir = ROOT / "build/xemu/kern3-ref"
    outdir = ROOT / "build/xemu/kern3-zesarux"
    outdir.mkdir(parents=True, exist_ok=True)
    ref_settled = (refdir / "settled.bin").read_bytes()
    ref_tab = (refdir / "tab.bin").read_bytes()
    ref_rec = (refdir / "record.bin").read_bytes()
    jset = json.loads((refdir / "settled.json").read_text())
    jtab = json.loads((refdir / "tab.json").read_text())
    S = syms()
    Z = lambda addr: addr - 0x4000
    chunks = dck_chunks(a.dck)
    results = []
    D_LOOP = S["D_LOOP"]

    proc = subprocess.Popen(
        ["zesarux", "--noconfigfile", "--machine", "TS2068", "--enable-remoteprotocol", "--remoteprotocol-port", str(a.port),
         "--vo", "null", "--ao", "null", "--romfile", str(ZDIR / "ts2068.rom")],
        cwd=ZDIR, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        c = ZRCPClient(port=a.port)
        c.connect()
        c.command("set-memory-zone 0")
        c.command("enable-breakpoints")
        c.command(f"set-breakpoint 1 PC={D_LOOP}")
        c.command(f"smartload {Path(a.dck).resolve()}")
        time.sleep(1.0)
        c.command("close-all-menus")
        time.sleep(0.5)
        c.command("enter-cpu-step")

        def run_stop():
            reply = c.command("run 400000000", timeout=a.timeout)
            if f"PC={D_LOOP}" not in reply and f"PC={D_LOOP:04x}" not in reply.lower() and f"{D_LOOP:04X} " not in reply:
                raise RuntimeError(f"run did not stop at D_LOOP: {reply.splitlines()[-1][:120]!r}")

        def tpartial():
            return int(c.command("get-tstates-partial").strip())

        def wait_frames(n):
            """run to D_LOOP until the partial T-state counter is >= n frames; returns (stops, T-states)"""
            c.command("reset-tstates-partial")
            stops = 0
            while True:
                run_stop(); stops += 1
                t = tpartial()
                if t >= n * FRAME_T:
                    return stops, t

        run_stop()                                           # first stop: after D_SCENE, in the loop
        rec = rd(c, Z(S["RESULT"]), 8)
        foc = rd(c, Z(S["K_FOCUS"]), 2)
        results.append(("first D_LOOP stop: record = TSRun's (marker $A5 $5A, state 3, 26 log records, sum $1D7E, focused id 2)",
                        rec == ref_rec and rec[2] == 3 and rec[3] == 26 and (rec[4] | rec[5] << 8) == 0x1D7E and rec[6] == 2,
                        f"record {rec.hex(' ')} (TSRun {ref_rec.hex(' ')})"))

        stops, t = wait_frames(100)
        T1 = t
        disp = rd(c, Z(0x4000), 6144) + rd(c, Z(0x6000), 6144)
        focus = foc_now = int.from_bytes(rd(c, Z(S["K_FOCUS"]), 2), "little")
        diffs = [i for i in range(12288) if disp[i] != ref_settled[i]]
        text = f"{stops} D_LOOP stops over {t} T = {t / FRAME_T:.2f} ZEsarUX frames; display RAM " + (f"{len(diffs)} of 12288 bytes differ" if diffs else "12288 bytes identical to TSRun's settled screen")
        if diffs:
            (outdir / "settled-zesarux.bin").write_bytes(disp)
            addr, x, y = locate(diffs[0])
            text += f"; first at ${addr:04X} (pixel x {x}..{x + 7}, y {y}): ZEsarUX ${disp[diffs[0]]:02X}, TSRun ${ref_settled[diffs[0]]:02X}; dump in {outdir}"
        results.append(("settled screen (100 frames after the first stop) = TSRun's", not diffs, text))
        results.append(("K_FOCUS = 0 before any input", focus == 0, f"K_FOCUS ${focus:04X}"))
        rec2 = rd(c, Z(S["RESULT"]), 8)
        results.append(("record unchanged at the settled screen", rec2 == ref_rec, rec2.hex(" ")))

        stops2, t2 = wait_frames(20)
        disp2 = rd(c, Z(0x4000), 6144) + rd(c, Z(0x6000), 6144)
        results.append(("screen constant over 20 more frames", disp2 == disp, f"{stops2} stops, {t2} T = {t2 / FRAME_T:.2f} frames; "
                        + ("identical" if disp2 == disp else f"{sum(1 for i in range(12288) if disp2[i] != disp[i])} bytes differ")))
        results.append(("interrupts: D_LOOP reached once per frame (idle: HALT then loop)", stops == round(T1 / FRAME_T) or abs(stops - T1 / FRAME_T) <= 1,
                        f"{stops} stops for {T1 / FRAME_T:.2f} frames; {stops2} stops for {t2 / FRAME_T:.2f} frames"))

        # TAB: CAPS SHIFT + 1 for 2 frames, release, 10 frames
        viewA = int.from_bytes(rd(c, Z(S["T_VIEWS"] + 2), 2), "little")
        c.command(f"send-keys-event {KEY_CS} 1")
        c.command(f"send-keys-event {KEY_1} 1")
        _, tk = wait_frames(2)
        now = rd(c, Z(0xF090), 8)                             # K_NOW: the half-rows as last read (bit set = down)
        c.command(f"send-keys-event {KEY_1} 0")
        c.command(f"send-keys-event {KEY_CS} 0")
        stops3, t3 = wait_frames(10)
        focus2 = int.from_bytes(rd(c, Z(S["K_FOCUS"]), 2), "little")
        results.append(("send-keys-event CS (133) + '1' (49) reaches the keyboard matrix (K_NOW row 0 bit 0, row 3 bit 0)",
                        now[0] & 1 == 1 and now[3] & 1 == 1, f"K_NOW {now.hex(' ')} after {tk} T pressed"))
        results.append(("TAB: K_FOCUS moves from 0 to view A (T_VIEWS + 2), equal to TSRun's", focus2 == viewA == jtab["K_FOCUS"] and viewA != 0,
                        f"K_FOCUS ${focus2:04X}, view A ${viewA:04X}, TSRun ${jtab['K_FOCUS']:04X}"))
        disp3 = rd(c, Z(0x4000), 6144) + rd(c, Z(0x6000), 6144)
        diffs = [i for i in range(12288) if disp3[i] != ref_tab[i]]
        text = f"{stops3} stops over {t3} T = {t3 / FRAME_T:.2f} frames after the release; display RAM " + (f"{len(diffs)} of 12288 bytes differ" if diffs else "12288 bytes identical to TSRun's after-TAB screen")
        if diffs:
            (outdir / "tab-zesarux.bin").write_bytes(disp3)
            addr, x, y = locate(diffs[0])
            text += f"; first at ${addr:04X} (pixel x {x}..{x + 7}, y {y}): ZEsarUX ${disp3[diffs[0]]:02X}, TSRun ${ref_tab[diffs[0]]:02X}; dump in {outdir}"
        results.append(("screen after the TAB = TSRun's after the same key press", not diffs, text))
        results.append(("the TAB changed the screen (differs from the settled screen)", disp3 != disp, f"{sum(1 for i in range(12288) if disp3[i] != disp[i])} bytes differ"))

        c.command("set-memory-zone 19")
        dock_bad = {}
        for ch in CHUNKS:
            d = rd(c, ch * 8192, 8192)
            dock_bad[ch] = sum(1 for i in range(8192) if d[i] != chunks[ch][i])
        c.command("set-memory-zone 0")
        results.append(("DOCK chunks 0, 1, 4, 5 identical to the DCK", all(x == 0 for x in dock_bad.values()), f"differing bytes {dock_bad}"))
        c.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
    for name, ok, text in results:
        print(f"  {'PASS' if ok else 'FAIL'}  {name}: {text}")
    ok = all(x[1] for x in results)
    print(f"{'PASS' if ok else 'FAIL'}: kern3demo on ZEsarUX 13.0: {sum(1 for x in results if x[1])} of {len(results)} rows")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
