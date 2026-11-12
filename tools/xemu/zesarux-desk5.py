#!/usr/bin/env python3
"""Run the desk5 cartridge (the shell, Calculator; docs/SHELL.md 8 test 5) in ZEsarUX 13.0 (headless, stock TS2068 ROM, ZRCP) and compare it with TSRun.

  python3 tools/xemu/zesarux-desk5.py [build/desk5.dck] [--port 10783]

Needs the TSRun reference: this script runs `node tools/xemu/desk5-ref.mjs` first (that script does not build anything).  ZEsarUX is started as
zesarux-kern4.py starts it; one breakpoint at the interrupt entry $0038 stops the run once per frame, so a key is held exactly 3 frames and
released 3 frames, as in TSRun.  Sequence (as the reference): (1) the shell: K_PROG = 0, 30 frames, then until the 12,288 display bytes
($4000-$57FF, $6000-$77FF) read 20 frames apart are equal; (2) ENTER (opens the focused icon, Calculator): until K_PROG = 1, 30 frames, settled;
(3) 1 2 3 . 4 5 * 6 ENTER ('.' = SS+M, '*' = SS+B; digits: ASCII; ENTER 129; SYMBOL SHIFT = 137 = UTIL_KEY_ALT_R, verified through K_NOW at $F090);
(4) SYMBOL SHIFT + Q (CLOSE): until K_PROG = 0, 30 frames, settled.
(5) the Controls session (docs/TOOLKIT.md 10.8 item 6; steps and keys are read from the reference's keys.json, written by desk5-ref.mjs): TAB (CAPS SHIFT + 1) to the
Controls icon, ENTER (K_PROG = 2): "ctl"; TAB x5, DOWN x10 (CS+6): "list"; TAB, LEFT x2 (CS+5), x, SS+P, SS+Z, DELETE (CS+0): "field"; ENTER: "status"; SS+Q: "back2".
Rows: the settled screens "shell", "calc", "typed", "back" = TSRun's .bin byte for byte; "back" = "shell"; K_PROG after each step = TSRun's;
the display string "0" after the launch and after each key = TSRun's, the typed one "740.7"; per key K_NOW shows the keys down; the pointer
K_PX, K_PY = TSRun's; DOCK chunks 0-5 (memory zone 19) = the DCK after the run.
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
KEY_SS, KEY_ENTER, KEY_CAPS = 137, 129, 135
# name: [(zesarux code, K_NOW row, bit), ...]   rows $FE $FD $FB $F7 $EF $DF $BF $7F
# the keyboard matrix as the reference's keys.json gives it: [row, bit] -> ZEsarUX key code (rows $FE $FD $FB $F7 $EF $DF $BF $7F)
MATRIX = [
    [KEY_CAPS, ord("z"), ord("x"), ord("c"), ord("v")], [ord(k) for k in "asdfg"], [ord(k) for k in "qwert"], [ord(k) for k in "12345"],
    [ord(k) for k in "09876"], [ord(k) for k in "poiuy"], [KEY_ENTER, ord("l"), ord("k"), ord("j"), ord("h")], [128, KEY_SS, ord("m"), ord("n"), ord("b")],
]
KEYS = {
    "1": [(ord("1"), 3, 0)], "2": [(ord("2"), 3, 1)], "3": [(ord("3"), 3, 2)], "4": [(ord("4"), 3, 3)], "5": [(ord("5"), 3, 4)],
    "6": [(ord("6"), 4, 4)],
    ".": [(KEY_SS, 7, 1), (ord("m"), 7, 2)],
    "*": [(KEY_SS, 7, 1), (ord("b"), 7, 4)],
    "ENTER": [(KEY_ENTER, 6, 0)],
    "SS+Q": [(KEY_SS, 7, 1), (ord("q"), 2, 0)],
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
    names = ("shell", "calc", "typed", "back")
    ref = {n: (refdir / f"{n}.bin").read_bytes() for n in names}
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

        def kprog():
            return rd(c, Z(S["K_PROG"]), 1)[0]

        def press(name):
            """Hold a key (chord) 3 frames as TSRun does, release, 3 frames; return (K_NOW shows it down, K_NOW text)."""
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

        def press_chord(pairs):
            """Hold a chord of [row, bit] pairs 3 frames, release, 3 frames; return whether K_NOW showed every key down (at either read)."""
            codes = [MATRIX[r][b] for r, b in pairs]
            for code in codes:
                c.command(f"send-keys-event {code} 1")
            wait_frames(2)
            now = rd(c, Z(0xF090), 8)
            wait_frames(1)
            now2 = rd(c, Z(0xF090), 8)
            for code in reversed(codes):
                c.command(f"send-keys-event {code} 0")
            want = [0] * 8
            for r, b in pairs:
                want[r] |= 1 << b
            down = all((now[r] & want[r]) == want[r] for r in range(8)) or all((now2[r] & want[r]) == want[r] for r in range(8))
            wait_frames(3)
            return down

        def until_prog(n):
            nb = 0
            while True:
                run_stop(); nb += 1
                if kprog() == n or nb >= 1000:
                    return kprog() == n, nb

        def step(tag, label, up, nb):
            wait_frames(30)
            ok, cur, used = settle(300)
            res = compare(f"settled \"{tag}\" screen = TSRun's {tag} ({label})", cur, ref[tag], tag)
            results.append((res[0], res[1] and ok and up, res[2] + f"; settled {ok} after {used} more frames; K_PROG reached after {nb} frame stops"))
            results.append((f"K_PROG after \"{tag}\" = TSRun's", kprog() == refj[tag]["K_PROG"], f"{kprog()}, TSRun {refj[tag]['K_PROG']}"))
            return cur

        # 1. the shell (the machine ran free ~1.5 s after smartload, so it is already up at the first frame stop; K_PROG is random RAM until the launcher stores 0)
        up, nb = until_prog(0)
        shell_cur = step("shell", "K_PROG 0", up, nb)
        px, py = (int.from_bytes(rd(c, Z(S[n]), 2), "little") for n in ("K_PX", "K_PY"))
        results.append(("pointer K_PX, K_PY = TSRun's", (px, py) == (refj["shell"]["K_PX"], refj["shell"]["K_PY"]),
                        f"({px}, {py}), TSRun ({refj['shell']['K_PX']}, {refj['shell']['K_PY']})"))

        # 2. ENTER opens Calculator
        press("ENTER")
        up, nb = until_prog(1)
        step("calc", "ENTER opened Calculator", up, nb)
        results.append(("calc: display string \"0\" (length 1)", dstr() == ("0", 1), repr(dstr())))

        # 3. the typed sequence
        got_after = []
        for name in refk["seq"]:
            press(name)
            got_after.append((name, dstr()[0]))
        want_after = [tuple(x) for x in refk["afterKey"]]
        results.append(("display string after each key = TSRun's", got_after == want_after,
                        " ".join(f"{k}:\"{s}\"" for k, s in got_after) + ("" if got_after == want_after else "  (TSRun: " + " ".join(f"{k}:\"{s}\"" for k, s in want_after) + ")")))
        ok, cur, used = settle(60)
        d_typed, n_typed = dstr()
        results.append((f"typed display string = \"{refk['expect']}\" (123.45 * 6)", d_typed == refk["expect"] and n_typed == len(refk["expect"]),
                        f"{d_typed!r} (length byte {n_typed})"))
        res = compare("settled \"typed\" screen = TSRun's typed", cur, ref["typed"], "typed")
        results.append((res[0], res[1] and ok, res[2] + f"; settled {ok} after {used} more frames"))
        results.append(("K_PROG after \"typed\" = TSRun's", kprog() == refj["typed"]["K_PROG"], f"{kprog()}, TSRun {refj['typed']['K_PROG']}"))

        # 4. SYMBOL SHIFT + Q quits to the shell
        press("SS+Q")
        up, nb = until_prog(0)
        back = step("back", "SS+Q quit to the shell", up, nb)
        results.append(("\"back\" screen = \"shell\" screen on ZEsarUX itself, byte for byte", back == shell_cur, "equal" if back == shell_cur else "differ"))

        # 5. the Controls session (TOOLKIT 10.8 item 6)
        ck = refk["ctl"]
        cnames = ("ctl", "list", "field", "status", "back2")
        cref = {n: (refdir / f"{n}.bin").read_bytes() for n in cnames}
        crefj = {n: json.loads((refdir / f"{n}.json").read_text()) for n in cnames}

        def run_keys(label, seq):
            downs = [press_chord(pairs) for _, pairs in seq]
            results.append((f"{label}: K_NOW shows every key down ({len(seq)} presses: " + " ".join(n for n, _ in seq) + ")", all(downs),
                            f"{sum(downs)} of {len(downs)}"))

        def csettle(tag, label, extra):
            ok, cur, used = settle(extra)
            res = compare(f"settled \"{tag}\" screen = TSRun's {tag} ({label})", cur, cref[tag], tag)
            results.append((res[0], res[1] and ok, res[2] + f"; settled {ok} after {used} more frames"))
            results.append((f"K_PROG after \"{tag}\" = TSRun's", kprog() == crefj[tag]["K_PROG"], f"{kprog()}, TSRun {crefj[tag]['K_PROG']}"))
            return cur

        run_keys("TAB to the Controls icon", [("TAB", ck["tabIcon"])])
        run_keys("ENTER opens Controls", [("ENTER", ck["enter"])])
        up, nb = until_prog(2)
        wait_frames(30)
        ok, cur, used = settle(300)
        res = compare("settled \"ctl\" screen = TSRun's ctl (Controls as opened, K_PROG 2)", cur, cref["ctl"], "ctl")
        results.append((res[0], res[1] and ok and up, res[2] + f"; settled {ok} after {used} more frames; K_PROG reached after {nb} frame stops"))
        results.append(("K_PROG after \"ctl\" = TSRun's", kprog() == crefj["ctl"]["K_PROG"], f"{kprog()}, TSRun {crefj['ctl']['K_PROG']}"))
        run_keys("list: TAB x5, DOWN x10", ck["list"])
        csettle("list", "the List scrolled, bar moved", 60)
        run_keys("field: TAB, LEFT x2, x, SS+P, SS+Z, DELETE", ck["field"])
        csettle("field", "Field edited", 60)
        run_keys("status: ENTER in the Field", ck["status"])
        csettle("status", "status line Name: ...", 60)
        run_keys("SS+Q", [("SS+Q", ck["close"])])
        up, nb = until_prog(0)
        wait_frames(30)
        ok, cur, used = settle(300)
        res = compare("settled \"back2\" screen = TSRun's back2 (SS+Q quit to the shell)", cur, cref["back2"], "back2")
        results.append((res[0], res[1] and ok and up, res[2] + f"; settled {ok} after {used} more frames; K_PROG reached after {nb} frame stops"))
        results.append(("K_PROG after \"back2\" = TSRun's", kprog() == crefj["back2"]["K_PROG"], f"{kprog()}, TSRun {crefj['back2']['K_PROG']}"))
        results.append(("\"back2\" screen = \"shell\" screen on ZEsarUX itself (as TSRun: " + str(refk["back2EqShell"]) + ")", (cur == shell_cur) == refk["back2EqShell"],
                        "equal" if cur == shell_cur else "differ"))

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
