; desk5.asm -- the step 5 desktop cartridge (docs/CALCULATOR.md 1-2): the kernel as kern4 has it, the far call, and Calculator
; in DOCK 2-3, launched at boot.  No test code beyond the sentinel return and a send for the tests.

    DEVICE NOSLOT64K
    DEFINE LOOK_MAC             ; the Mac OS 1.0 style look (docs/LOOK.md): desk5 only
    DEFINE K_DCLICK             ; E_DOWN's data 3 bit 2 marks a double-click (docs/WRITE.md 14.9): desk5 only
    DEFINE G_LEAN               ; G_CLS, G_VLINE and G_ROWADDR are left out (no program uses them; docs/SIZE.md 1 S3): desk5 only
    DEFINE K_NOWARP             ; K_WARP and K_POLL's warp block are left out (docs/SIZE.md 1 S4): desk5 only
    DEFINE G_LIB6               ; G_SCROLLV, G_BLIT and G_LINE live in DOCK 6 (docs/SIZE.md 4, docs/PAINT.md 11.1): desk5 only
    DEFINE SOUND                ; UI sounds on the AY (docs/SOUND.md): desk5 only
    DEFINE K_BOXES              ; K_BOX: a box between the arena and cold RAM, for Paint's undo (docs/PAINT.md 6): desk5 only
    DEFINE MASKS_SHARED         ; LMASK / RMASK are the first 8 bytes of LMASKP / RMASKP (docs/SIZE.md 1 S5): desk5 only

PORT_HSR    EQU $F4
PORT_SCLD   EQU $FF
PORT_AY_REG EQU $F5
PORT_AY_DAT EQU $F6
F4_RUN      EQU $33             ; DOCK chunks 0,1,4,5; RAM 2,3 (display), 6,7
SCLD_MODE6  EQU %00000110       ; mode 6, black ink on white paper, frame interrupt on, DOCK
STACK_TOP   EQU $FF00
V_FRAMES    EQU $E080           ; word: frame interrupts
V_SHADOW_FF EQU $E082
V_SHADOW_F4 EQU $E083
RESULT      EQU $FF00
DESK_STR    EQU $E090           ; 64 bytes, zero: desk_draw's string of code 0 (LOOK 9).  Boot clears it; nothing writes it.

KARENA_BASE EQU $F500
KARENA_END  EQU $FB00
PROG_IMG    EQU $C000           ; the running program's RAM image, at most 1 KB (docs/SHELL.md 2)
C_IMG_ADDR  EQU PROG_IMG        ; Calculator's
AARENA_BASE EQU $C400
AARENA_END  EQU $E000

    ORG $0000
    DB $00, $01                 ; LROS header
    DW ENTRY
    DB $BC

    ORG $0008
    INCLUDE "kernel/send.asm"
    ASSERT $ <= $0028

    ORG $0028
    jp K_FAR                    ; RST $28: the far call (docs/BANKING.md 5.1)

    ORG $0038
ISR:
    jp ISR_BODY

    ORG $0066
    retn

    ORG $0068
    INCLUDE "kernel/far.asm"
    ASSERT $ <= $0100

    ORG $0100
ENTRY:
    di
    ld sp,STACK_TOP
    xor a
    out (PORT_SCLD),a
    ld a,F4_RUN
    out (PORT_HSR),a
    im 1
    ld b,16
.ay:
    ld a,b
    dec a
    out (PORT_AY_REG),a
    xor a
    out (PORT_AY_DAT),a
    djnz .ay
    ld hl,$E000                 ; variables, kernel area, stack and record cleared
    ld de,$E001
    ld bc,$FFFF-$E000
    ld (hl),0
    ldir
    ld hl,$4000                 ; display files (and the unused tails) cleared
    ld de,$4001
    ld bc,$4000-1
    ld (hl),0
    ldir
    ld a,SCLD_MODE6
    ld (V_SHADOW_FF),a
    out (PORT_SCLD),a
    ld a,F4_RUN
    ld (V_SHADOW_F4),a
    ld a,$C3
    ld (K_FJP),a                ; JP: K_FAR's indirect call
    ld a,1
    ld (K_SOUND),a              ; sound on (docs/SOUND.md)
    call G_INIT
    ld hl,K_KARENA
    ld de,KARENA_BASE
    ld bc,KARENA_END
    call K_AINIT
    xor a
    ld (K_AYREG),a              ; the AY loop above left register 0 selected
    call W_INIT
    ld hl,256
    ld (K_PX),hl
    ld a,96
    ld (K_PY),a
    ld de,96
    call P_INIT                 ; interrupts are still off: the first frame draws it
    ld a,1
    ld (RESULT+2),a
    ld hl,$5AA5
    ld (RESULT),hl              ; marker: booted
; The app arena, then the shell (docs/SHELL.md 3): K_LAUNCH never returns.
    ld hl,K_AARENA
    ld de,AARENA_BASE
    ld bc,AARENA_END
    call K_AINIT
    ld hl,K_AARENA
    call K_ARENA
    ei
    xor a
    jp K_LAUNCH
T_IDLE:
    halt
    jr T_IDLE

T_RET:
    jr T_RET

; T_SEND: a send through RST $08, for the tests (IX, A, BC, DE as K_SEND).
T_SEND:
    rst $08
    ret

; The frame ISR (docs/WINDOWS.md 14.7): count the frame, map the display, P_ISR, K_POLL, put the shadows back.
ISR_BODY:
    push af
    push hl
    ld hl,(V_FRAMES)
    inc hl
    ld (V_FRAMES),hl
    push bc
    push de
    ld a,F4_RUN
    out (PORT_HSR),a
    call P_ISR
    call K_POLL
    call K_SNDTICK
    ld a,(V_SHADOW_F4)
    out (PORT_HSR),a
    ld a,(K_AYREG)
    out (PORT_AY_REG),a
    pop de
    pop bc
    pop hl
    pop af
    ei
    ret

    ALIGN 512                   ; docs/SIZE.md 1 S2: ROWTAB at $0200, in front of gfx6 (the pad before it is 72 bytes, not 404)
    INCLUDE "gfx6/tables.inc"

    INCLUDE "gfx6/gfx6.asm"

    INCLUDE "kernel/kernel1.asm"
    INCLUDE "kernel/tk2.asm"    ; the toolkit's List and Field (docs/TOOLKIT.md 10.1: chunk 5 is full)
    ASSERT $ <= $4000           ; chunks 0-1 only

    ORG $8000                   ; DOCK chunk 4: page-aligned tables
    INCLUDE "gfx6/tables4.inc"
    ASSERT RMASKP == LMASKP + 256 && (LMASKP & $FF) == 0
    ASSERT PROP6_I == PROP6_W + 256 && (PROP6_W & $FF) == 0 && (FONTP & $FF) == 0
    ASSERT SHL == SHR + 256 && (SHR & $FF) == 0 && PROP6_K == PROP6_A2 + 256 && GLYPH8 == FONTP + 128
    ASSERT $ <= $9E00           ; chunk 4: the tables, then the kernel's first two pages (docs/SIZE.md 1 S1)

    ORG $9E00                   ; the kernel: DOCK chunk 4's tail and chunk 5 (K_FAR maps $8000-$BFFF as K)
    INCLUDE "kernel/kernel.asm"
    INCLUDE "kernel/tk.asm"     ; the toolkit (docs/TOOLKIT.md)
    INCLUDE "tk-classes.inc"
    INCLUDE "kernel/launch.asm" ; the launcher (docs/SHELL.md 3)
    INCLUDE "kernel/sound.asm"  ; UI sounds (docs/SOUND.md)
K_PROGS:                        ; the programs (SHELL 10.3): 0 the shell, 1 Calculator, 2 Key Caps (docs/KEYCAPS.md), 3 Write (docs/WRITE.md), 4 Paint (docs/PAINT.md)
    DW S_START, C_START, KC_START, WR_START, PN_START
    ASSERT $ <= $C000           ; chunk 5 only

    INCLUDE "apps/calc.asm"     ; DOCK chunks 2-3
    ASSERT C_IMG_LEN <= 1024
    INCLUDE "apps/shell.asm"
    INCLUDE "apps/write.asm"     ; program 3 (docs/WRITE.md)
    INCLUDE "apps/applib.asm"   ; the app library (docs/APPLIB.md)
    INCLUDE "apps/keycaps.asm"  ; program 2 (docs/KEYCAPS.md)
    INCLUDE "apps/files.asm"    ; the FS_ calls (docs/FILES.md)
    INCLUDE "apps/paint.asm"    ; program 4 (docs/PAINT.md)
    ASSERT $ <= $8000

; DOCK chunk 6 (mapping R; docs/SIZE.md 4): the graphics library and the data it draws from.  A program reaches it by KFAR; under R the
; display, the cold RAM and the pool are mapped, the heap ($C000-$DFFF RAM: the program image and arena) is not.
    ORG $C000
G6_START:
    INCLUDE "gfx6/s3sv.asm"     ; G_SCROLLV
    INCLUDE "gfx6/s3bl.asm"     ; G_BLIT (uses sc_clip)
    INCLUDE "gfx6/s3ln.asm"     ; G_LINE
    INCLUDE "gfx6/patfill.asm"  ; G_PATFILL and the 16 patterns (docs/PAINT.md 7)
    INCLUDE "gfx6/rrect.asm"    ; G_RRECT: the rounded rectangle and the oval (docs/PAINT.md 7, 18)
    INCLUDE "gfx6/flood.asm"    ; G_FLOOD: the bucket (docs/PAINT.md 21)
    INCLUDE "icons.inc"         ; the shell's icons (G_BLIT's set, 160 bytes each)
    INCLUDE "ticons.inc"        ; Paint's tool icons (G_BLIT's set, 96 bytes each)
G6_END:
    ASSERT $ <= $E000

; LOOK 9: the 8x8 glyph of code 0 (blank, never drawn) becomes the desk's 25% tile: FONTP plane k, byte 128 (GLYPH8 + 0).
    ORG GLYPH8
    DUP 4
        DB $88
        ORG $ + 255
        DB $22
        ORG $ + 255
    EDUP

    SAVEBIN "mem.bin", 0, 65536
