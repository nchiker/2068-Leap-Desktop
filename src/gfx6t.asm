; gfx6t.asm -- test cartridge for the mode 6 graphics core (docs/GRAPHICS_SPIKE.md section 12.4).  Boots like hello.asm, then
; idles; the tests call the gfx6 routines directly (sentinel return T_RET) or run T_CLSLOOP with interrupts on.

    DEVICE NOSLOT64K

PORT_HSR    EQU $F4
PORT_SCLD   EQU $FF
PORT_AY_REG EQU $F5
PORT_AY_DAT EQU $F6
F4_RUN      EQU $33             ; DOCK chunks 0,1,4,5; RAM 2,3 (display), 6,7
SCLD_MODE6  EQU %00000110       ; mode 6, black ink on white paper, frame interrupt on, DOCK
STACK_TOP   EQU $FF00
V_FRAMES    EQU $E040           ; word: frame interrupts
V_SHADOW_FF EQU $E042
V_SHADOW_F4 EQU $E043
V_CLS       EQU $E044           ; word: clears done by T_CLSLOOP
RESULT      EQU $FF00
R_STATE     EQU RESULT+2

    ORG $0000
    DB $00, $01                 ; LROS header
    DW ENTRY
    DB $BC

    ORG $0038
ISR:                            ; frame interrupt: count it; leave $FF bytes in the frame (16 bytes deep with the return address)
    push af
    push hl
    ld hl,(V_FRAMES)
    inc hl
    ld (V_FRAMES),hl
    ld hl,$FFFF
    push hl
    push hl
    push hl
    push hl
    push hl
    pop hl
    pop hl
    pop hl
    pop hl
    pop hl
    pop hl
    pop af
    ei
    ret

    ORG $0066
    retn

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
    ld hl,$E000                 ; variables, stack and record cleared
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
    call G_INIT
    ld a,1
    ld (R_STATE),a
    ld hl,$5AA5
    ld (RESULT),hl              ; marker last
    ei
T_IDLE:
    halt
    jr T_IDLE

T_RET:
    jr T_RET

T_CLSLOOP:
    ei
T_CLSLOOP_L:
    call G_CLS
T_CLSDONE:
    ld hl,(V_CLS)
    inc hl
    ld (V_CLS),hl
    jr T_CLSLOOP_L

    INCLUDE "gfx6/gfx6.asm"

    ALIGN 512
    INCLUDE "gfx6/tables.inc"

    ORG $8000                   ; DOCK chunk 4: page-aligned tables
    INCLUDE "gfx6/tables4.inc"
    ASSERT RMASKP == LMASKP + 256 && (LMASKP & $FF) == 0

    SAVEBIN "mem.bin", 0, 65536
