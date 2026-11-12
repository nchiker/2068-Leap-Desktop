#!/usr/bin/env python3
"""Run the kern4demo cartridge (docs/WINDOWS.md 18.6) in ZEsarUX 13.0 (headless, stock TS2068 ROM, ZRCP) and compare it with TSRun.

  python3 tools/xemu/zesarux-kern4.py [build/kern4demo.dck] [--port 10781]

Needs the TSRun reference (`node tools/xemu/kern4-ref.mjs`; this script runs it first, which also rebuilds the cartridge).  ZEsarUX is
started as zesarux-kern3.py starts it.  One breakpoint, at the interrupt entry $0038 (the kernel's ISR), stops the run once per frame.
Unlike kern3demo's D_LOOP this works in the menu's own tracking loop (mb_loop), which never reaches D_LOOP: a frame count is exact, so a
key is held exactly 2 frames, as in TSRun (frames are 69,888 T on ZEsarUX, 58,688 T on TSRun).  "Settled" = the 12,288 display bytes read 20 frames apart are equal.
Rows: (1) the demo has built its windows (frame by frame), (2) the settled boot screen = TSRun's (12,288 bytes: $4000-$57FF,
$6000-$77FF; the pointer drawn at (500, 180) included), (3) per key of the script (MENU = CAPS SHIFT + 9, LEFT = CS + 5,
ENTER), sent as ZRCP send-keys-event for 2 frames, released, 10 frames: K_NOW shows the keys down (codes: 133 = CAPS SHIFT, ASCII digits,
129 = ENTER (ASCII 13 does not work), verified by K_NOW); (4) each step's settled screen = TSRun's (s1 "Text" to the front, s2 About opens, s3 About closes),
(5) the screen after each single key (10 frames after the release, not settled) = TSRun's (informational: timing-sensitive),
(6) DOCK chunks 0, 1, 4, 5 (memory zone 19) = the DCK.
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
# util_teclas values for send-keys-event; K_NOW half-row (index = row) and bit that must show the key down
KEY_CS, KEY_5, KEY_9, KEY_ENTER = 133, 53, 57, 129    # 129 = UTIL_KEY_ENTER (a sweep: ASCII 13 and 10 do not reach the matrix)
KEYS = {  # name: [(zesarux code, K_NOW row, bit), ...]
    "MENU": [(KEY_CS, 0, 0), (KEY_9, 4, 1)],
    "LEFT": [(KEY_CS, 0, 0), (KEY_5, 3, 4)],
    "ENTER": [(KEY_ENTER, 6, 0)],
}
SCRIPT = [
    ("s1", ["MENU", "LEFT", "ENTER"]),
    ("s2", ["MENU", "ENTER"]),
    ("s3", ["ENTER"]),
]


def syms():
    o = {}
    for line in (ROOT / "build/kern4demo/out.sym").read_text().splitlines():
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
    ap.add_argument("dck", nargs="?", default=str(ROOT / "build/kern4demo.dck"))
    ap.add_argument("--port", type=int, default=10781)
    ap.add_argument("--timeout", type=float, default=120)
    a = ap.parse_args()

    subprocess.run(["node", str(ROOT / "tools/xemu/kern4-ref.mjs")], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    refdir = ROOT / "build/xemu/kern4-ref"
    outdir = ROOT / "build/xemu/kern4-zesarux"
    outdir.mkdir(parents=True, exist_ok=True)
    ref = {n: (refdir / f"{n}.bin").read_bytes() for n in ["boot"] + [s[0] for s in SCRIPT]}
    refj = {n: json.loads((refdir / f"{n}.json").read_text()) for n in ref}
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
        c.command("enable-breakpoints")
        c.command("set-breakpoint 1 PC=56")
        c.command(f"smartload {Path(a.dck).resolve()}")
        time.sleep(1.0)
        c.command("close-all-menus")
        time.sleep(0.5)
        c.command("enter-cpu-step")

        def run_stop():
            reply = c.command("run 400000000", timeout=a.timeout)
            if "0038" not in reply.splitlines()[-1] and "PC=0038" not in reply.upper():
                raise RuntimeError(f"run did not stop at the ISR: {reply.splitlines()[-1][:120]!r}")

        def wait_frames(n):
            """run n frame interrupts (stops at the ISR entry $0038, once per frame whatever the code is doing: the menu loop never reaches D_LOOP)"""
            c.command("reset-tstates-partial")
            for _ in range(n):
                run_stop()
            return n, int(c.command("get-tstates-partial").strip())

        def display():
            return rd(c, Z(0x4000), 6144) + rd(c, Z(0x6000), 6144)

        def settle(max_extra):
            """20-frame waits until two consecutive reads are equal; returns (settled, screen, frames waited)"""
            prev = display(); used = 0
            while used < max_extra:
                wait_frames(20); used += 20
                cur = display()
                if cur == prev:
                    return True, cur, used
                prev = cur
            return False, prev, used

        def word(name):
            return int.from_bytes(rd(c, Z(S[name]), 2), "little")

        def compare(label, got, want, tag):
            diffs = [i for i in range(12288) if got[i] != want[i]]
            text = f"display RAM " + (f"{len(diffs)} of 12288 bytes differ" if diffs else "12288 bytes identical to TSRun's")
            if diffs:
                (outdir / f"{tag}-zesarux.bin").write_bytes(got)
                addr, x, y = locate(diffs[0])
                text += (f"; first at ${addr:04X} (pixel x {x}..{x + 7}, y {y}): ZEsarUX ${got[diffs[0]]:02X}, TSRun ${want[diffs[0]]:02X}"
                         f"; dump in {outdir}")
            return (label, not diffs, text)

        nb = 0
        while True:                                          # one frame at a time until the windows are built (as kern4-ref.mjs does)
            run_stop(); nb += 1
            t_, b_ = word("D_TEXT"), word("D_BUTTONS")
            built = 0xC000 <= t_ < 0xE000 and 0xC000 <= b_ < 0xE000 and t_ != b_
            if built or nb >= 1000:
                break
        results.append((f"windows built at the frame-stop {nb} (the demo has built them before the first stop), D_TEXT / D_BUTTONS = TSRun's", built and t_ == refj["boot"]["D_TEXT"] and b_ == refj["boot"]["D_BUTTONS"],
                        f"D_TEXT ${t_:04X} (TSRun ${refj['boot']['D_TEXT']:04X}), D_BUTTONS ${b_:04X} (TSRun ${refj['boot']['D_BUTTONS']:04X})"))
        wait_frames(30)
        ok, cur, used = settle(200)
        res = compare("settled boot screen (30 frames after the windows are built, then stable over 20) = TSRun's", cur, ref["boot"], "boot")
        results.append((res[0], res[1] and ok, res[2] + f"; settled {ok} after {used} more frames"))
        results.append(("K_FOCUS at boot = TSRun's", word("K_FOCUS") == refj["boot"]["K_FOCUS"], f"K_FOCUS ${word('K_FOCUS'):04X}, TSRun ${refj['boot']['K_FOCUS']:04X}"))

        for name, keys in SCRIPT:
            for i, k in enumerate(keys):
                for code, _, _ in KEYS[k]:
                    c.command(f"send-keys-event {code} 1")
                _, tk = wait_frames(2)
                now = rd(c, Z(0xF090), 8)                    # K_NOW: the half-rows as last read (bit set = down)
                for code, _, _ in reversed(KEYS[k]):
                    c.command(f"send-keys-event {code} 0")
                want = [0] * 8
                for _, r, b in KEYS[k]:
                    want[r] |= 1 << b
                results.append((f"{name} key {i + 1} {k}: K_NOW shows it down ({' + '.join(str(x[0]) for x in KEYS[k])})",
                                all((now[r] & want[r]) == want[r] for r in range(8)), f"K_NOW {now.hex(' ')} after {tk} T pressed"))
                wait_frames(10)
                scr = display()
                kref = refdir / f"{name}-k{i + 1}.bin"
                res = compare(f"{name} key {i + 1} {k}: screen 10 frames after the release = TSRun's (informational)", scr, kref.read_bytes(), f"{name}-k{i + 1}")
                results.append(res)
            ok, cur, used = settle(60)
            res = compare(f"step {name} ({' '.join(keys)}): settled screen = TSRun's", cur, ref[name], name)
            results.append((res[0], res[1] and ok, res[2] + f"; settled {ok} after {used} more frames"))
            if name == "s1":
                results.append(("step s1: the screen differs from the boot screen (Text window to the front)", cur != ref["boot"],
                                f"{sum(1 for i in range(12288) if cur[i] != ref['boot'][i])} bytes differ from TSRun's boot screen"))
            fj = refj[name]
            got = (word("K_FOCUS"), word("D_ABOUT"))
            results.append((f"step {name}: K_FOCUS and D_ABOUT = TSRun's", got == (fj["K_FOCUS"], fj["D_ABOUT"]),
                            f"K_FOCUS ${got[0]:04X} D_ABOUT ${got[1]:04X} (TSRun ${fj['K_FOCUS']:04X}, ${fj['D_ABOUT']:04X})"))

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
    print(f"{'PASS' if ok else 'FAIL'}: kern4demo on ZEsarUX 13.0: {sum(1 for x in results if x[1])} of {len(results)} rows")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
