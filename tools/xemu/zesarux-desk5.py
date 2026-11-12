#!/usr/bin/env python3
"""Run the desk5 cartridge (Calculator, docs/CALCULATOR.md 8 test 7) in ZEsarUX 13.0 (headless, stock TS2068 ROM, ZRCP) and compare it with TSRun.

  python3 tools/xemu/zesarux-desk5.py [build/desk5.dck] [--port 10783]

Needs the TSRun reference: this script runs `node tools/xemu/desk5-ref.mjs` first (that script does not build anything).  ZEsarUX is started as
zesarux-kern4.py starts it; one breakpoint at the interrupt entry $0038 stops the run once per frame, so a key is held exactly 3 frames and
released 3 frames, as in TSRun.  Boot: frame by frame until the display string C_DSTR is "0", then 30 frames, then until the 12,288 display bytes
($4000-$57FF, $6000-$77FF) read 20 frames apart are equal.  The keys (1 2 3 . 4 5 * 6 ENTER; '.' = SS+M, '*' = SS+B) are sent as ZRCP
send-keys-event (digits: ASCII; ENTER 129; CAPS SHIFT 133 is not used; SYMBOL SHIFT = 137 = UTIL_KEY_ALT_R, verified through K_NOW at $F090).
Rows: (1) the boot display string is "0" and the screen settled, (2) the settled boot screen = TSRun's boot.bin byte for byte, (3) per key: K_NOW shows
the keys down, (4) per key: the display string = TSRun's after that key, (5) the typed display string = "740.7", (6) the settled typed screen = TSRun's
typed.bin byte for byte, (7) DOCK chunks 0-5 (memory zone 19) = the DCK after the run.
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
NCHUNK = 6
KEY_SS, KEY_ENTER = 137, 129
# name: [(zesarux code, K_NOW row, bit), ...]   rows $FE $FD $FB $F7 $EF $DF $BF $7F
KEYS = {
    "1": [(ord("1"), 3, 0)], "2": [(ord("2"), 3, 1)], "3": [(ord("3"), 3, 2)], "4": [(ord("4"), 3, 3)], "5": [(ord("5"), 3, 4)],
    "6": [(ord("6"), 4, 4)],
    ".": [(KEY_SS, 7, 1), (ord("m"), 7, 2)],
    "*": [(KEY_SS, 7, 1), (ord("b"), 7, 4)],
    "ENTER": [(KEY_ENTER, 6, 0)],
}


def syms():
    o = {}
    for line in (ROOT / "build/desk5/out.sym").read_text().splitlines():
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dck", nargs="?", default=str(ROOT / "build/desk5.dck"))
    ap.add_argument("--port", type=int, default=10783)
    ap.add_argument("--timeout", type=float, default=120)
    a = ap.parse_args()

    subprocess.run(["node", str(ROOT / "tools/xemu/desk5-ref.mjs")], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    refdir = ROOT / "build/xemu/desk5-ref"
    outdir = ROOT / "build/xemu/desk5-zesarux"
    outdir.mkdir(parents=True, exist_ok=True)
    ref = {n: (refdir / f"{n}.bin").read_bytes() for n in ("boot", "typed")}
    refj = {n: json.loads((refdir / f"{n}.json").read_text()) for n in ref}
    refk = json.loads((refdir / "keys.json").read_text())
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
            for _ in range(n):
                run_stop()

        def display():
            return rd(c, Z(0x4000), 6144) + rd(c, Z(0x6000), 6144)

        def dstr():
            b = rd(c, Z(S["C_DSTR"]), 24)
            return b[1:1 + min(b[0], 23)].decode("latin1"), b[0]

        def settle(max_extra):
            prev = display(); used = 0
            while used < max_extra:
                wait_frames(20); used += 20
                cur = display()
                if cur == prev:
                    return True, cur, used
                prev = cur
            return False, prev, used

        def compare(label, got, want, tag):
            diffs = [i for i in range(12288) if got[i] != want[i]]
            text = "display RAM " + (f"{len(diffs)} of 12288 bytes differ" if diffs else "12288 bytes identical to TSRun's")
            if diffs:
                (outdir / f"{tag}-zesarux.bin").write_bytes(got)
                addr, x, y = locate(diffs[0])
                text += (f"; first at ${addr:04X} (pixel x {x}..{x + 7}, y {y}): ZEsarUX ${got[diffs[0]]:02X}, TSRun ${want[diffs[0]]:02X}"
                         f"; dump in {outdir}")
            return (label, not diffs, text)

        nb = 0
        while True:                                          # one frame at a time until Calculator shows "0"
            run_stop(); nb += 1
            if dstr() == ("0", 1) or nb >= 1000:
                break
        zero = dstr() == ("0", 1)
        wait_frames(30)
        ok, cur, used = settle(300)
        results.append((f"boot: display string is \"0\" (the machine ran free ~1.5 s after smartload, so it is already up at the first of {nb} frame stops; TSRun 122 frames) and the screen settled", zero and ok and dstr()[0] == "0",
                        f"display string {dstr()!r}, settled {ok} after {used} more frames"))
        res = compare("settled boot screen (30 frames after \"0\", then stable over 20) = TSRun's boot", cur, ref["boot"], "boot")
        results.append((res[0], res[1] and ok, res[2]))
        # the pointer position, as TSRun has it
        px, py = (int.from_bytes(rd(c, Z(S[n]), 2), "little") for n in ("K_PX", "K_PY"))
        results.append(("pointer K_PX, K_PY = TSRun's", (px, py) == (refj["boot"]["K_PX"], refj["boot"]["K_PY"]),
                        f"({px}, {py}), TSRun ({refj['boot']['K_PX']}, {refj['boot']['K_PY']})"))

        got_after = []
        for name in refk["seq"]:
            for code, _, _ in KEYS[name]:
                c.command(f"send-keys-event {code} 1")
            wait_frames(2)
            now = rd(c, Z(0xF090), 8)                       # K_NOW (read by the ISR once a frame): bit set = down
            wait_frames(1)
            now2 = rd(c, Z(0xF090), 8)
            for code, _, _ in reversed(KEYS[name]):
                c.command(f"send-keys-event {code} 0")
            want = [0] * 8
            for _, r, b in KEYS[name]:
                want[r] |= 1 << b
            down = all((now[r] & want[r]) == want[r] for r in range(8)) or all((now2[r] & want[r]) == want[r] for r in range(8))
            results.append((f"key {name}: K_NOW shows it down ({' + '.join(str(x[0]) for x in KEYS[name])})", down,
                            f"K_NOW {now.hex(' ')} / {now2.hex(' ')}"))
            wait_frames(3)
            got_after.append((name, dstr()[0]))
        ok, cur, used = settle(60)
        d_typed, n_typed = dstr()
        want_after = [tuple(x) for x in refk["afterKey"]]
        results.append(("display string after each key = TSRun's", got_after == want_after,
                        " ".join(f"{k}:\"{s}\"" for k, s in got_after) + ("" if got_after == want_after else "  (TSRun: " + " ".join(f"{k}:\"{s}\"" for k, s in want_after) + ")")))
        results.append((f"typed display string = \"{refk['expect']}\" (123.45 * 6)", d_typed == refk["expect"] and n_typed == len(refk["expect"]),
                        f"{d_typed!r} (length byte {n_typed})"))
        res = compare("settled typed screen = TSRun's typed", cur, ref["typed"], "typed")
        results.append((res[0], res[1] and ok, res[2] + f"; settled {ok} after {used} more frames"))

        c.command("set-memory-zone 19")
        dock_bad = {}
        for ch in range(NCHUNK):
            d = rd(c, ch * 8192, 8192)
            dock_bad[ch] = sum(1 for i in range(8192) if d[i] != chunks[ch][i])
        c.command("set-memory-zone 0")
        results.append(("DOCK chunks 0-5 identical to the DCK after the run", all(x == 0 for x in dock_bad.values()), f"differing bytes {dock_bad}"))
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
    print(f"{'PASS' if ok else 'FAIL'}: desk5 on ZEsarUX 13.0: {sum(1 for x in results if x[1])} of {len(results)} rows")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
