#!/usr/bin/env python3
"""Run the spike6 cartridge (docs/GRAPHICS_SPIKE.md 17.8) in ZEsarUX 13.0 (headless, stock TS2068 ROM, ZRCP) and compare it with TSRun.

  python3 tools/xemu/zesarux-spike6.py [build/spike6.dck] [--port 10779] [--keep]

Needs the TSRun reference (`node tools/xemu/spike6-ref.mjs`; this script runs it first).  ZEsarUX is started as zesarux-probe23.py
starts it (adapted from Leap-IDE arcade/spike/bank/zesarux.py), the cartridge is loaded with smartload, the CPU is put in cpu-step
mode and `run` is used between breakpoints (a breakpoint without an action stops the run).  A breakpoint at S_CHECK stops the
cartridge 8 times (once per script checkpoint).  At each stop: display RAM (memory zone 0 = CPU address - $4000, files $4000-$57FF and
$6000-$77FF) is compared byte for byte with TSRun's cpK.bin; V_PX, V_PY, V_MENU, V_DRAG and V_TICK with cpK.json.
After the script: record marker $A5 $5A and state 2; V_FRAMES against the T-states run (the partial T-state counter is reset at checkpoint 1
and read at checkpoint 8: V_FRAMES(8) - V_FRAMES(1) against T / 69,888, within 1, as probe23 does it); V_FRAMES - V_TICK reported;
DOCK chunks 0, 1, 4, 5 (memory zone 19) equal the DCK.
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
FRAME_T = 69888          # ZEsarUX runs the TS2068 at 3,494,400 Hz / 50 Hz (get-cpu-frequency)
CHUNKS = (0, 1, 4, 5)    # the DCK holds these, in this order, after the 9-byte header
NCP = 8


def syms():
    o = {}
    for line in (ROOT / "build/spike6/out.sym").read_text().splitlines():
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


def row_off(y):
    return ((y & 0xC0) << 5) | ((y & 7) << 8) | ((y & 0x38) << 2)


def locate(i):
    """index into the 12,288-byte dump -> (address, x range, y) in mode 6"""
    f, off = divmod(i, 6144)
    third, rest = divmod(off, 2048)
    y = third * 64 + ((rest >> 5) & 7) * 8 + (rest >> 8)
    col = ((off & 31) << 1) | f
    return 0x4000 + 0x2000 * f + off, col * 8, y


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dck", nargs="?", default=str(ROOT / "build/spike6.dck"))
    ap.add_argument("--port", type=int, default=10779)
    ap.add_argument("--timeout", type=float, default=120, help="seconds allowed per `run` (until the next checkpoint)")
    a = ap.parse_args()

    subprocess.run(["node", str(ROOT / "tools/xemu/spike6-ref.mjs")], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    refdir = ROOT / "build/xemu/spike6-ref"
    outdir = ROOT / "build/xemu/spike6-zesarux"
    outdir.mkdir(parents=True, exist_ok=True)
    ref = [(((refdir / f"cp{k}.bin").read_bytes()), json.loads((refdir / f"cp{k}.json").read_text())) for k in range(1, NCP + 1)]
    S = syms()
    Z = lambda addr: addr - 0x4000
    chunks = dck_chunks(a.dck)
    results = []                                   # (name, pass, text)

    proc = subprocess.Popen(
        ["zesarux", "--noconfigfile", "--machine", "TS2068", "--enable-remoteprotocol", "--remoteprotocol-port", str(a.port),
         "--vo", "null", "--ao", "null", "--romfile", str(ZDIR / "ts2068.rom")],
        cwd=ZDIR, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        c = ZRCPClient(port=a.port)
        c.connect()
        c.command("set-memory-zone 0")
        c.command("enable-breakpoints")
        c.command(f"set-breakpoint 1 PC={S['S_CHECK']}")      # no action: the run stops here
        c.command(f"smartload {Path(a.dck).resolve()}")
        time.sleep(1.0)
        c.command("close-all-menus")
        time.sleep(0.5)
        c.command("enter-cpu-step")

        tpartial = None
        v1 = None
        cpres = []
        for k in range(1, NCP + 1):
            reply = c.command("run 400000000", timeout=a.timeout)
            if f"PC={S['S_CHECK']}" not in reply and f"PC={S['S_CHECK']:04x}" not in reply.lower():
                results.append((f"checkpoint {k}: stopped at S_CHECK", False, f"run returned: {reply.splitlines()[-1][:120]!r}"))
                break
            pc = re.search(r"PC=([0-9a-fA-F]{4})", c.command("get-registers")).group(1)
            v = rd(c, Z(S["V_FRAMES"]), 12)             # V_FRAMES .. V_CHECKS ($E080-$E08B)
            vars_ = dict(V_FRAMES=v[0] | v[1] << 8, V_TICK=v[4] | v[5] << 8, V_PX=v[6] | v[7] << 8, V_PY=v[8], V_MENU=v[9],
                         V_DRAG=v[10], V_CHECKS=v[11])
            disp = rd(c, Z(0x4000), 6144) + rd(c, Z(0x6000), 6144)
            if k == 1:
                c.command("reset-tstates-partial")
                v1 = vars_["V_FRAMES"]
            elif k == NCP:
                tpartial = int(c.command("get-tstates-partial").strip())
                v8 = vars_["V_FRAMES"]
            rbin, rj = ref[k - 1]
            diffs = [i for i in range(12288) if disp[i] != rbin[i]]
            bad_vars = {n: (vars_[n], rj[n]) for n in ("V_PX", "V_PY", "V_MENU", "V_DRAG", "V_TICK") if vars_[n] != rj[n]}
            ok = not diffs and not bad_vars and vars_["V_CHECKS"] == k - 1 and pc.lower() == f"{S['S_CHECK']:04x}"
            text = (f"PC ${pc}, V_PX {vars_['V_PX']} V_PY {vars_['V_PY']} V_MENU {vars_['V_MENU']} V_DRAG {vars_['V_DRAG']} V_TICK {vars_['V_TICK']} "
                    f"(TSRun {rj['V_PX']} {rj['V_PY']} {rj['V_MENU']} {rj['V_DRAG']} {rj['V_TICK']}); display RAM "
                    + (f"{len(diffs)} of 12288 bytes differ" if diffs else "12288 bytes identical"))
            if diffs:
                (outdir / f"cp{k}-zesarux.bin").write_bytes(disp)
                (outdir / f"cp{k}-tsrun.bin").write_bytes(rbin)
                addr, x, y = locate(diffs[0])
                text += (f"; first at ${addr:04X} (mode 6 pixel x {x}..{x + 7}, y {y}): ZEsarUX ${disp[diffs[0]]:02X}, TSRun ${rbin[diffs[0]]:02X}; "
                         f"dumps in {outdir}")
            if bad_vars:
                text += f"; variables (ZEsarUX, TSRun): {bad_vars}"
            cpres.append(vars_)
            results.append((f"checkpoint {k}: display RAM and variables = TSRun", ok, text))

        # after the script: the record
        c.command("run 20000", timeout=60)
        r = rd(c, Z(0xFF00), 4)
        results.append(("record: marker $A5 $5A, state 2", r[:2] == b"\xA5\x5A" and r[2] == 2,
                        f"marker {r[0]:02X} {r[1]:02X}, state {r[2]}"))
        if tpartial is not None:
            frames_run = tpartial / FRAME_T
            diff = abs((v8 - v1) - frames_run)
            results.append(("interrupts: V_FRAMES(cp8) - V_FRAMES(cp1) within 1 of T-states / 69,888", diff <= 1.0,
                            f"V_FRAMES {v1} -> {v8} = {v8 - v1}; partial T-state counter between the two stops {tpartial} = {frames_run:.2f} frames; diff {diff:.2f}"))
            results.append(("V_FRAMES - V_TICK (reported, not a pass/fail)", True,
                            "per checkpoint " + ", ".join(str(x["V_FRAMES"] - x["V_TICK"]) for x in cpres) +
                            f"; TSRun {', '.join(str(rj['V_FRAMES'] - rj['V_TICK']) for _, rj in ref)}"))
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
    ok = all(x[1] for x in results) and len(cpres) == NCP
    print(f"{'PASS' if ok else 'FAIL'}: spike6 on ZEsarUX 13.0: {sum(1 for x in results if x[1])} of {len(results)} rows")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
