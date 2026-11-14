#!/usr/bin/env python3
"""Run the desk5 cartridge (the shell, Calculator; docs/SHELL.md 8 test 5) in ZEsarUX 13.0 (headless, stock TS2068 ROM, ZRCP) and compare it with TSRun.

  python3 tools/xemu/zesarux-desk5.py [build/desk5.dck] [--port 10783]

Needs the TSRun reference: this script runs `node tools/xemu/desk5-ref.mjs` first (that script does not build anything).  ZEsarUX is started as
zesarux-kern4.py starts it; one breakpoint at the interrupt entry $0038 stops the run once per frame, so a key is held exactly 3 frames and
released 3 frames, as in TSRun.  Sequence (as the reference): (1) the shell: K_PROG = 0, 30 frames, then until the 12,288 display bytes
($4000-$57FF, $6000-$77FF) read 20 frames apart are equal; (2) ENTER (opens the focused icon, Calculator): until K_PROG = 1, 30 frames, settled;
(3) 1 2 3 . 4 5 * 6 ENTER ('.' = SS+M, '*' = SS+B; digits: ASCII; ENTER 129; SYMBOL SHIFT = 137 = UTIL_KEY_ALT_R, verified through K_NOW at $F090);
(4) SYMBOL SHIFT + Q (CLOSE): until K_PROG = 0, 30 frames, settled.
(5) the Key Caps session (docs/KEYCAPS.md; keys from keys.json "kc"): TAB (CAPS SHIFT + 1) to the Key Caps icon, ENTER (K_PROG = 2): "kc"; Q: "kc-q"; SS+P: "kc-ss"; TAB, SPACE (the Caps Shift radio): "kc-radio";
SS+Q: "back2" (K_PROG 0).  Rows: every settled screen = TSRun's byte for byte, K_PROG after each = TSRun's, the "back2" screen = the shell screen (as TSRun reports).
(7) the W2 session (WRITE 12.9 item 7; keys from keys.json "w2", skipped when the reference has none): MARK (SS+E) and the caret keys select across lines, MENU (CS+9) + RIGHT opens "Edit",
DOWN + ENTER = Copy, move, MENU + RIGHT + ENTER = Paste, SS+Q, ENTER: rows per checkpoint as (6), plus the W2 variables and the clipboard's bytes.
(6) the Write session (docs/WRITE.md 8 item 7; steps and keys from keys.json "wr"): TAB x2 (the Write icon), ENTER (K_PROG = 3): "wr-open"; a typed wrapping paragraph (SYMBOL SHIFT
characters included) and short lines, about 20 lines so that the view scrolls: "wr-typed"; UP x4, LEFT, DELETE, x: "wr-edit"; SS+Q (discard dialog): "wr-dialog"; ENTER (Discard):
"wr-back" (K_PROG 0, = "shell").  Extra rows: the document variables WR_NL, WR_TOP, WR_GS, WR_GE, WR_CHG = TSRun's after each of the first three.
(8) the W3 session (WRITE 13.7 item 5; keys from keys.json "w3", skipped when the reference has none; ZEsarUX has no file bridge, as TSRun with no host attached: the FS_ calls give status 0): TAB x2, ENTER
(K_PROG 3): "w3-open"; "abc": "w3-typed"; MENU, DOWN x2, ENTER (File > Save...): "w3-dialog"; DELETE x8, "t1": "w3-name"; ENTER (Save fails): "w3-alert"; ENTER (OK): "w3-after"; SS+Q: "w3-discard";
ENTER (Discard): "w3-back" (= "shell").  Rows: every settled screen = TSRun's, K_PROG = TSRun's, the W3 variables (document codes, WR_NAME, WR_TITLE, WR_CHG, WR_DK, dialogs made) = TSRun's; on ZEsarUX itself the
alert screen differs from the Save dialog screen, "w3-after" = "w3-typed" (as TSRun), and the document, name and WR_CHG after the alert are those before "Save...".
(9) the W4 session (WRITE 14.7 item 7; keys from keys.json "w4", skipped when the reference has none): TAB x2, ENTER (K_PROG 3): "w4-open"; three lines typed ("one two three", "four two six", "three"): "w4-typed";
MENU, RIGHT, DOWN, ENTER (Edit > Find...): "w4-fdlg"; "two", ENTER (the search wraps to the first "two"): "w4-found"; Edit > Find again (the DOWN steps are the reference's, counted over the enabled items): "w4-again" (the second "two");
Find again: "w4-again2" (wraps to the first); Find... : "w4-fdlg2"; DELETE x3, "zzz", ENTER (the alert "Not found."): "w4-notfound"; ENTER (OK): "w4-after"; SS+Q: "w4-discard"; ENTER (Discard): "w4-back" (= "shell").
Rows: every settled screen = TSRun's, K_PROG = TSRun's, the W4 variables (document, WR_GS, WR_GE, WR_AN, WR_MK, WR_CLN, the Edit enable word, WR_FN, F's codes, WR_LCK, WR_DK) = TSRun's, the match offsets (4..7, 19..22, 4..7),
"w4-after" = "w4-again2" on ZEsarUX itself, "w4-back" = "shell".
Rows: the settled screens "shell", "calc", "typed", "back" = TSRun's .bin byte for byte; "back" = "shell"; K_PROG after each step = TSRun's;
the display string "0" after the launch and after each key = TSRun's, the typed one "740.7"; per key K_NOW shows the keys down; the pointer
K_PX, K_PY = TSRun's; DOCK chunks 0-6 (memory zone 19) = the DCK after the run.
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

        # 5. the Key Caps session (KEYCAPS: keys from keys.json "kc"; TAB to the Key Caps icon, ENTER, Q, SS+P, TAB + SPACE, SS+Q)
        kk = refk["kc"]
        cnames = ("kc", "kc-q", "kc-ss", "kc-radio", "back2")
        cref = {n: (refdir / f"{n}.bin").read_bytes() for n in cnames}
        crefj = {n: json.loads((refdir / f"{n}.json").read_text()) for n in cnames}

        def run_keys(label, seq):
            downs = [press_chord(pairs) for _, pairs in seq]
            results.append((f"{label}: K_NOW shows every key down ({len(seq)} presses: " + " ".join(n for n, _ in seq) + ")", all(downs),
                            f"{sum(downs)} of {len(downs)}"))

        def csettle(tag, label, extra, up=True, nb=0):
            ok, cur, used = settle(extra)
            res = compare(f"settled \"{tag}\" screen = TSRun's {tag} ({label})", cur, cref[tag], tag)
            results.append((res[0], res[1] and ok and up, res[2] + f"; settled {ok} after {used} more frames" + (f"; K_PROG reached after {nb} frame stops" if nb else "")))
            kp = kprog()
            results.append((f"K_PROG after \"{tag}\" = TSRun's", kp == crefj[tag]["K_PROG"], f"{kp}, TSRun {crefj[tag]['K_PROG']}"))
            return cur

        run_keys("Key Caps: TAB to the Key Caps icon", [("TAB", kk["tabIcon"])])
        run_keys("Key Caps: ENTER opens Key Caps", [("ENTER", kk["enter"])])
        up, nb = until_prog(2)
        wait_frames(30)
        csettle("kc", "Key Caps as opened, K_PROG 2", 300, up, nb)
        run_keys("Key Caps: Q", kk["q"])
        csettle("kc-q", "the status reads the last key q", 60)
        run_keys("Key Caps: SS+P", kk["ss"])
        csettle("kc-ss", "the status reads the symbol shifted P", 60)
        run_keys("Key Caps: TAB, SPACE (the Caps Shift radio)", kk["radio"])
        csettle("kc-radio", "the Caps Shift plane shown", 60)
        run_keys("Key Caps: SS+Q", [("SS+Q", kk["close"])])
        up, nb = until_prog(0)
        wait_frames(30)
        cur = csettle("back2", "SS+Q quit to the shell, K_PROG 0", 300, up, nb)
        results.append(("\"back2\" screen = \"shell\" screen on ZEsarUX itself (as TSRun: " + str(refk["back2EqShell"]) + ")", (cur == shell_cur) == refk["back2EqShell"],
                        "equal" if cur == shell_cur else "differ"))

        # 6. the Write session (WRITE 8 item 7)
        wk = refk["wr"]
        wnames = ("wr-open", "wr-typed", "wr-edit", "wr-dialog", "wr-back")
        wref = {n: (refdir / f"{n}.bin").read_bytes() for n in wnames}
        wrefj = {n: json.loads((refdir / f"{n}.json").read_text()) for n in wnames}

        def wvars():
            return {n: int.from_bytes(rd(c, Z(S[n]), 1 if n == "WR_CHG" else 2), "little") for n in ("WR_NL", "WR_TOP", "WR_GS", "WR_GE", "WR_CHG")}

        def wsettle(tag, label, extra, up=True, nb=0, vkey=None):
            ok, cur, used = settle(extra)
            res = compare(f"settled \"{tag}\" screen = TSRun's {tag} ({label})", cur, wref[tag], tag)
            results.append((res[0], res[1] and ok and up, res[2] + f"; settled {ok} after {used} more frames" + (f"; K_PROG reached after {nb} frame stops" if nb else "")))
            results.append((f"K_PROG after \"{tag}\" = TSRun's", kprog() == wrefj[tag]["K_PROG"], f"{kprog()}, TSRun {wrefj[tag]['K_PROG']}"))
            if vkey:
                v = wvars()
                results.append((f"document variables after \"{tag}\" = TSRun's", v == wk["vars"][vkey], f"{v}, TSRun {wk['vars'][vkey]}"))
            return cur

        run_keys("Write: TAB x2 to the Write icon", wk["open"][:2])
        run_keys("Write: ENTER opens Write", wk["open"][2:])
        up, nb = until_prog(3)
        wait_frames(30)
        wsettle("wr-open", "Write as opened, K_PROG 3", 300, up, nb, "open")
        run_keys(f"Write: typed paragraph and short lines", wk["typed"])
        wsettle("wr-typed", "wrapped and scrolled", 120, vkey="typed")
        run_keys("Write: UP x4, LEFT, DELETE, x", wk["edit"])
        wsettle("wr-edit", "caret moved, edited", 120, vkey="edit")
        run_keys("Write: SS+Q (discard dialog)", [("SS+Q", wk["close"])])
        wait_frames(30)
        wsettle("wr-dialog", "the discard dialog, K_PROG 3", 300)
        run_keys("Write: ENTER (Discard)", [("ENTER", wk["enter"])])
        up, nb = until_prog(0)
        wait_frames(30)
        cur = wsettle("wr-back", "Discard quit to the shell, K_PROG 0", 300, up, nb)
        results.append(("\"wr-back\" screen = \"shell\" screen on ZEsarUX itself", cur == shell_cur, "equal" if cur == shell_cur else "differ"))

        # 7. the W2 session (WRITE 12.9 item 7): selection by MARK and the caret keys, the Edit menu by MENU + RIGHT + DOWN + ENTER: Copy, then Paste; every screen identical to TSRun's
        w2 = refk.get("w2")
        if not w2:
            print("  SKIP  the W2 session: the reference has no W2 data (the build has no Write W2 symbols)")
        else:
            w2names = ("w2-open", "w2-typed", "w2-sel", "w2-menu", "w2-copy", "w2-paste", "w2-dialog", "w2-back")
            w2ref = {n: (refdir / f"{n}.bin").read_bytes() for n in w2names}
            w2refj = {n: json.loads((refdir / f"{n}.json").read_text()) for n in w2names}

            def w2vars():
                v = wvars()
                v["WR_AN"] = int.from_bytes(rd(c, Z(S["WR_AN"]), 2), "little")
                v["WR_MK"] = rd(c, Z(S["WR_MK"]), 1)[0]
                cln = int.from_bytes(rd(c, Z(S["WR_CLN"]), 2), "little")
                v["WR_CLN"] = cln
                v["EDIT_EN"] = int.from_bytes(rd(c, Z(S["MB_ENT"] + S["ME_SIZE"] + S["ME_EN"]), 2), "little")
                v["CLIP"] = rd(c, Z(0x7800), min(cln, 2048)).hex() if cln else ""
                return v

            def w2settle(tag, label, extra, vkey=None, up=True, nb=0):
                ok, cur, used = settle(extra)
                res = compare(f"settled \"{tag}\" screen = TSRun's {tag} ({label})", cur, w2ref[tag], tag)
                results.append((res[0], res[1] and ok and up, res[2] + f"; settled {ok} after {used} more frames" + (f"; K_PROG reached after {nb} frame stops" if nb else "")))
                results.append((f"K_PROG after \"{tag}\" = TSRun's", kprog() == w2refj[tag]["K_PROG"], f"{kprog()}, TSRun {w2refj[tag]['K_PROG']}"))
                if vkey:
                    v = w2vars()
                    results.append((f"W2 variables (document, WR_AN, WR_MK, WR_CLN, the Edit enable bits, the clipboard's bytes) after \"{tag}\" = TSRun's", v == w2["vars"][vkey], f"{v}, TSRun {w2['vars'][vkey]}"))
                return cur

            k2 = w2["keys"]
            run_keys("W2: TAB x2 to the Write icon", k2["open"][:2])
            run_keys("W2: ENTER opens Write", k2["open"][2:])
            up, nb = until_prog(3)
            wait_frames(30)
            w2settle("w2-open", "Write as opened, K_PROG 3", 300, "open", up, nb)
            run_keys("W2: three lines typed", k2["typed"])
            w2settle("w2-typed", "text typed", 120, "typed")
            run_keys("W2: MARK (SYMBOL SHIFT + E), UP, UP, LEFT, LEFT", k2["sel"])
            w2settle("w2-sel", "a selection across lines", 120, "sel")
            run_keys("W2: MENU, RIGHT (the Edit menu opens)", k2["menu"])
            w2settle("w2-menu", "the Edit menu open", 120, "menu")
            run_keys("W2: DOWN (Copy), ENTER", k2["copy"])
            w2settle("w2-copy", "Copy done, the selection kept", 120, "copy")
            run_keys("W2: RIGHT, ENTER (move, new line)", k2["move"])
            run_keys("W2: MENU, RIGHT, ENTER (Paste)", k2["paste"])
            w2settle("w2-paste", "Paste done", 120, "paste")
            run_keys("W2: SS+Q (discard dialog)", [("SS+Q", k2["close"])])
            wait_frames(30)
            w2settle("w2-dialog", "the discard dialog, K_PROG 3", 300)
            run_keys("W2: ENTER (Discard)", [("ENTER", k2["enter"])])
            up, nb = until_prog(0)
            wait_frames(30)
            cur = w2settle("w2-back", "Discard quit to the shell, K_PROG 0", 300, None, up, nb)
            results.append(("\"w2-back\" screen = \"shell\" screen on ZEsarUX itself", cur == shell_cur, "equal" if cur == shell_cur else "differ"))

        # 8. the W3 session (WRITE 13.7 item 5): no file bridge, so "Save..." ends in the alert and nothing else changes
        w3 = refk.get("w3")
        if not w3:
            print("  SKIP  the W3 session: the reference has no W3 data (the build has no Write W3 symbols)")
        else:
            w3names = ("w3-open", "w3-typed", "w3-dialog", "w3-name", "w3-alert", "w3-after", "w3-discard", "w3-back")
            w3ref = {n: (refdir / f"{n}.bin").read_bytes() for n in w3names}
            w3refj = {n: json.loads((refdir / f"{n}.json").read_text()) for n in w3names}
            w3got = {}

            def w3vars():
                v = wvars()
                gs, ge = v["WR_GS"], v["WR_GE"]
                buf, gb = (int.from_bytes(rd(c, Z(S[n]), 2), "little") for n in ("WR_BUF", "WR_GB"))
                v["DOC"] = rd(c, Z(buf), gs).hex() + "|" + rd(c, Z(gb), 0x1400 - ge).hex()
                nl = rd(c, Z(S["WR_NAME"]), 1)[0]
                v["NAME"] = rd(c, Z(S["WR_NAME"]), 1 + min(nl, 30)).hex()
                tl = rd(c, Z(S["WR_TITLE"]), 1)[0]
                v["TITLE"] = rd(c, Z(S["WR_TITLE"]), 1 + min(tl, 41)).hex()
                v["WR_DK"] = rd(c, Z(S["WR_DK"]), 1)[0]
                v["SDLG_MADE"] = int.from_bytes(rd(c, Z(S["WR_SDLG"]), 2), "little") != 0
                v["ADLG_MADE"] = int.from_bytes(rd(c, Z(S["WR_ADLG"]), 2), "little") != 0
                return v

            def w3settle(tag, label, extra, vkey=None, up=True, nb=0):
                ok, cur, used = settle(extra)
                res = compare(f"settled \"{tag}\" screen = TSRun's {tag} ({label})", cur, w3ref[tag], tag)
                results.append((res[0], res[1] and ok and up, res[2] + f"; settled {ok} after {used} more frames" + (f"; K_PROG reached after {nb} frame stops" if nb else "")))
                results.append((f"K_PROG after \"{tag}\" = TSRun's", kprog() == w3refj[tag]["K_PROG"], f"{kprog()}, TSRun {w3refj[tag]['K_PROG']}"))
                if vkey:
                    v = w3vars()
                    w3got[vkey] = v
                    results.append((f"W3 variables (document codes, WR_NAME, WR_TITLE, WR_CHG, WR_DK, dialogs made, counters) after \"{tag}\" = TSRun's", v == w3["vars"][vkey], f"{v}, TSRun {w3['vars'][vkey]}"))
                w3got[tag] = cur
                return cur

            k3 = w3["keys"]
            run_keys("W3: TAB x2 to the Write icon", k3["open"][:2])
            run_keys("W3: ENTER opens Write", k3["open"][2:])
            up, nb = until_prog(3)
            wait_frames(30)
            w3settle("w3-open", "Write as opened, K_PROG 3", 300, "open", up, nb)
            run_keys("W3: \"abc\" typed", k3["typed"])
            w3settle("w3-typed", "three codes typed", 120, "typed")
            run_keys("W3: MENU, DOWN x2, ENTER (File > Save...)", k3["save"])
            w3settle("w3-dialog", "the Save dialog", 120, "dialog")
            run_keys("W3: DELETE x8, t, 1 (the name)", k3["name"])
            w3settle("w3-name", "the name typed in the Field", 120, "name")
            run_keys("W3: ENTER (Save: no host, so the alert)", k3["go"])
            w3settle("w3-alert", "the alert \"The file could not be saved.\"", 120, "alert")
            run_keys("W3: ENTER (OK)", k3["go"])
            w3settle("w3-after", "the alert dismissed", 120, "after")
            run_keys("W3: SS+Q (discard dialog)", [("SS+Q", k3["close"])])
            wait_frames(30)
            w3settle("w3-discard", "the discard dialog, K_PROG 3", 300, "discard")
            run_keys("W3: ENTER (Discard)", [("ENTER", k3["enter"])])
            up, nb = until_prog(0)
            wait_frames(30)
            cur = w3settle("w3-back", "Discard quit to the shell, K_PROG 0", 300, None, up, nb)
            results.append(("\"w3-back\" screen = \"shell\" screen on ZEsarUX itself", cur == shell_cur, "equal" if cur == shell_cur else "differ"))
            results.append(("W3 on ZEsarUX itself: the alert screen differs from the Save dialog screen (and from the name-typed screen)",
                            w3got["w3-alert"] != w3got["w3-dialog"] and w3got["w3-alert"] != w3got["w3-name"], "differ" if w3got["w3-alert"] != w3got["w3-dialog"] else "equal"))
            results.append(("W3 on ZEsarUX itself: \"w3-after\" screen = \"w3-typed\" screen (the alert closed, nothing else changed; as TSRun: " + str(w3["afterEqTyped"]) + ")",
                            (w3got["w3-after"] == w3got["w3-typed"]) == w3["afterEqTyped"], "equal" if w3got["w3-after"] == w3got["w3-typed"] else "differ"))
            va, vt = w3got["after"], w3got["typed"]
            results.append(("W3 on ZEsarUX itself: after the alert the document, its name, the title and WR_CHG (still set) are as before \"Save...\"; the alert showed (WR_DK 2), then closed (0)",
                            all(va[k] == vt[k] for k in ("DOC", "NAME", "TITLE", "WR_CHG", "WR_NL", "WR_TOP", "WR_GS", "WR_GE")) and va["WR_CHG"] == 1 and w3got["alert"]["WR_DK"] == 2 and va["WR_DK"] == 0,
                            f"typed {vt}, after {va}, alert WR_DK {w3got['alert']['WR_DK']}"))

        # 9. the W4 session (WRITE 14.7 item 7): Find... and Find again by the Edit menu's keys, "Not found."; every screen identical to TSRun's
        w4 = refk.get("w4")
        if not w4:
            print("  SKIP  the W4 session: the reference has no W4 data (the build has no Write W4 symbols)")
        else:
            w4names = ("w4-open", "w4-typed", "w4-fdlg", "w4-found", "w4-again", "w4-again2", "w4-fdlg2", "w4-notfound", "w4-after", "w4-discard", "w4-back")
            w4ref = {n: (refdir / f"{n}.bin").read_bytes() for n in w4names}
            w4refj = {n: json.loads((refdir / f"{n}.json").read_text()) for n in w4names}
            w4got = {}

            def w4vars():
                v = wvars()
                v["WR_AN"] = int.from_bytes(rd(c, Z(S["WR_AN"]), 2), "little")
                v["WR_MK"] = rd(c, Z(S["WR_MK"]), 1)[0]
                v["WR_CLN"] = int.from_bytes(rd(c, Z(S["WR_CLN"]), 2), "little")
                v["EDIT_EN"] = int.from_bytes(rd(c, Z(S["MB_ENT"] + S["ME_SIZE"] + S["ME_EN"]), 2), "little")
                fn = rd(c, Z(S["WR_FN"]), 1)[0]
                v["WR_FN"] = fn
                v["FCODES"] = rd(c, Z(S["WR_FCODES"]), min(fn, 30)).hex()
                v["WR_LCK"] = int.from_bytes(rd(c, Z(S["WR_LCK"]), 2), "little")
                v["WR_DK"] = rd(c, Z(S["WR_DK"]), 1)[0]
                buf, gb = (int.from_bytes(rd(c, Z(S[n]), 2), "little") for n in ("WR_BUF", "WR_GB"))
                v["DOC"] = rd(c, Z(buf), v["WR_GS"]).hex() + "|" + rd(c, Z(gb), 0x1400 - v["WR_GE"]).hex()
                return v

            def w4settle(tag, label, extra, vkey=None, up=True, nb=0):
                ok, cur, used = settle(extra)
                res = compare(f"settled \"{tag}\" screen = TSRun's {tag} ({label})", cur, w4ref[tag], tag)
                results.append((res[0], res[1] and ok and up, res[2] + f"; settled {ok} after {used} more frames" + (f"; K_PROG reached after {nb} frame stops" if nb else "")))
                results.append((f"K_PROG after \"{tag}\" = TSRun's", kprog() == w4refj[tag]["K_PROG"], f"{kprog()}, TSRun {w4refj[tag]['K_PROG']}"))
                if vkey:
                    v = w4vars()
                    w4got[vkey] = v
                    results.append((f"W4 variables (document, caret, anchor, mark, Edit enable bits, F and its length, WR_LCK, WR_DK) after \"{tag}\" = TSRun's", v == w4["vars"][vkey], f"{v}, TSRun {w4['vars'][vkey]}"))
                w4got[tag] = cur
                return cur

            k4 = w4["keys"]
            run_keys("W4: TAB x2 to the Notepad icon", k4["open"][:2])
            run_keys("W4: ENTER opens Notepad", k4["open"][2:])
            up, nb = until_prog(3)
            wait_frames(30)
            w4settle("w4-open", "Notepad as opened, K_PROG 3", 300, "open", up, nb)
            run_keys("W4: three lines typed", k4["typed"])
            w4settle("w4-typed", "text typed", 120, "typed")
            run_keys("W4: MENU, RIGHT, DOWN, ENTER (Edit > Find...)", k4["find1"])
            w4settle("w4-fdlg", "the Find dialog, F empty", 120, "fdlg")
            run_keys("W4: \"two\", ENTER (found, the search wrapped)", k4["two"] + k4["go"])
            w4settle("w4-found", "the first \"two\" selected", 120, "found")
            run_keys("W4: MENU, RIGHT, DOWN x4, ENTER (Edit > Find again)", k4["again1"])
            w4settle("w4-again", "the second \"two\" selected", 120, "again")
            run_keys("W4: Find again (wraps to the first match)", k4["again2"])
            w4settle("w4-again2", "the first \"two\" selected again", 120, "again2")
            run_keys("W4: Edit > Find... (F shown)", k4["find2"])
            w4settle("w4-fdlg2", "the Find dialog with F = two", 120, "fdlg2")
            run_keys("W4: DELETE x3, \"zzz\", ENTER (not found)", k4["zzz"] + k4["go"])
            w4settle("w4-notfound", "the alert \"Not found.\"", 120, "notfound")
            run_keys("W4: ENTER (OK)", k4["go"])
            w4settle("w4-after", "the alert dismissed", 120, "after")
            run_keys("W4: SS+Q (discard dialog)", [("SS+Q", k4["close"])])
            wait_frames(30)
            w4settle("w4-discard", "the discard dialog, K_PROG 3", 300, "discard")
            run_keys("W4: ENTER (Discard)", [("ENTER", k4["enter"])])
            up, nb = until_prog(0)
            wait_frames(30)
            cur = w4settle("w4-back", "Discard quit to the shell, K_PROG 0", 300, None, up, nb)
            results.append(("\"w4-back\" screen = \"shell\" screen on ZEsarUX itself", cur == shell_cur, "equal" if cur == shell_cur else "differ"))
            results.append(("W4 on ZEsarUX itself: Find... selected the first \"two\" (WR_AN 4, caret 7), Find again the second (19, 22), then the first again; the alert showed (WR_DK 2), then closed (0), the selection and F = zzz kept",
                            (w4got["found"]["WR_AN"], w4got["found"]["WR_GS"]) == (4, 7) and (w4got["again"]["WR_AN"], w4got["again"]["WR_GS"]) == (19, 22)
                            and (w4got["again2"]["WR_AN"], w4got["again2"]["WR_GS"]) == (4, 7) and w4got["notfound"]["WR_DK"] == 2 and w4got["after"]["WR_DK"] == 0
                            and w4got["after"]["FCODES"] == "7a7a7a" and w4got["after"]["WR_AN"] == 4 and w4got["w4-after"] == w4got["w4-again2"],
                            f"found {(w4got['found']['WR_AN'], w4got['found']['WR_GS'])}, again {(w4got['again']['WR_AN'], w4got['again']['WR_GS'])}, again2 {(w4got['again2']['WR_AN'], w4got['again2']['WR_GS'])}"))

        c.command("set-memory-zone 19")
        dock_bad = {}
        for ch in range(NCHUNK):
            d = rd(c, ch * 8192, 8192)
            dock_bad[ch] = sum(1 for i in range(8192) if d[i] != chunks[ch][i])
        c.command("set-memory-zone 0")
        results.append(("DOCK chunks 0-6 identical to the DCK after the run", all(x == 0 for x in dock_bad.values()), f"differing bytes {dock_bad}"))
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
