; desk5.asm -- the step 5 desktop cartridge (docs/CALCULATOR.md 1-2): the kernel as kern4 has it, the far call, and Calculator
; in DOCK 2-3, launched at boot.  No test code beyond the sentinel return and a send for the tests.

    DEVICE NOSLOT64K

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

KARENA_BASE EQU $F500
KARENA_END  EQU $FB00
C_IMG_ADDR  EQU $C000           ; Calculator's RAM image (docs/CALCULATOR.md 2)
D_IMG_ADDR  EQU $C100           ; the toolkit demo's (docs/TOOLKIT.md 9.4)
AARENA_BASE EQU $C200
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
; The launch (docs/CALCULATOR.md 2): the image, the app arena, then the program (it never returns).
    KFAR C_INIT
    KFAR D_INIT                 ; the toolkit demo's image (docs/TOOLKIT.md 9.4)
    ld hl,K_AARENA
    ld de,AARENA_BASE
    ld bc,AARENA_END
    call K_AINIT
    ld hl,K_AARENA
    call K_ARENA
    ei
    KFAR C_MAIN
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

    INCLUDE "gfx6/gfx6.asm"

    ALIGN 512
    INCLUDE "gfx6/tables.inc"

    INCLUDE "kernel/kernel1.asm"
    ASSERT $ <= $4000           ; chunks 0-1 only

    ORG $8000                   ; DOCK chunk 4: page-aligned tables
    INCLUDE "gfx6/tables4.inc"
    ASSERT RMASKP == LMASKP + 256 && (LMASKP & $FF) == 0
    ASSERT PROP6_I == PROP6_W + 256 && (PROP6_W & $FF) == 0 && (FONTP & $FF) == 0
    ASSERT SHL == SHR + 256 && (SHR & $FF) == 0 && PROP6_K == PROP6_A2 + 256 && GLYPH8 == FONTP + 128
    ASSERT $ <= $A000           ; chunk 4 only

    ORG $A000                   ; DOCK chunk 5: the kernel
    INCLUDE "kernel/kernel.asm"
    INCLUDE "kernel/tk.asm"     ; the toolkit (docs/TOOLKIT.md)
    INCLUDE "tk-classes.inc"
    ASSERT $ <= $C000           ; chunk 5 only

    INCLUDE "apps/calc.asm"     ; DOCK chunks 2-3
    ASSERT C_IMG_ADDR + C_IMG_LEN <= D_IMG_ADDR
    INCLUDE "apps/demo.asm"
    ASSERT $ <= $8000

    SAVEBIN "mem.bin", 0, 65536
