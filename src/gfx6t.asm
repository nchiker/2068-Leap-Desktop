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
V_FRAMES    EQU $E080           ; word: frame interrupts
V_SHADOW_FF EQU $E082
V_SHADOW_F4 EQU $E083
V_CLS       EQU $E084           ; word: clears done by T_CLSLOOP / T_CLSPLOOP
V_PX        EQU $E086           ; word: T_CLSPLOOP's pointer x
V_PY        EQU $E088           ; byte: T_CLSPLOOP's pointer y
V_SCRN      EQU $E08A           ; word: script commands done by T_SCRIPT
T_SCR       EQU $D200           ; script buffer for T_SCRIPT ($D200-$DFFF, section 16.5)
T_STR       EQU $D000           ; string buffer for the S2 tests ($D000-$D1FF, section 14.5)
RESULT      EQU $FF00
R_STATE     EQU RESULT+2

    ORG $0000
    DB $00, $01                 ; LROS header
    DW ENTRY
    DB $BC

    ORG $0038
ISR:
    jp ISR_BODY

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

; The frame ISR (sections 12.4, 16.5): count the frame, map the display, P_ISR, put the shadow back; then leave $FF bytes in the
; stack frame down to 32 bytes below the interrupted SP (return address 2 + 4 pushes + 11 more), so that a stack write that G_CLS
; does not heal shows as ink.
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
T_ISRP:
    ld a,(V_SHADOW_F4)
    out (PORT_HSR),a
    ld hl,$FFFF
    DUP 11
    push hl
    EDUP
    DUP 11
    pop hl
    EDUP
    pop de
    pop bc
    pop hl
    pop af
    ei
    ret

; T_WAIT: a script command that waits for the next frame interrupt.
T_WAIT:
    halt
    ret

; T_SCRIPT (section 16.5): runs the 26-byte commands at T_SCR with interrupts on, then idles at T_SCRDONE.
T_SCRIPT:
    ei
    ld ix,T_SCR
.next:
    ld l,(ix+0)
    ld h,(ix+1)
    ld a,h
    or l
    jr z,T_SCRDONE
    ld de,.back
    push de                     ; the routine returns to .back
    push hl                     ; the RET below enters the routine
    push ix
    pop hl
    ld de,10
    add hl,de
    ld de,GA
    ld bc,16
    ldir
    ld c,(ix+6)
    ld b,(ix+7)
    ld e,(ix+4)
    ld d,(ix+5)
    ld l,(ix+2)
    ld h,(ix+3)
    ld a,(ix+8)
    ret
.back:
    ld hl,(V_SCRN)
    inc hl
    ld (V_SCRN),hl
    ld de,26
    add ix,de
    jr .next
T_SCRDONE:
    halt
    jr T_SCRDONE

; T_CLSPLOOP (section 16.5): back-to-back shielded clears with the pointer moving.  The test calls P_INIT first.
T_CLSPLOOP:
    ei
    ld hl,0
    ld (V_PX),hl
    xor a
    ld (V_PY),a
.loop:
    ld hl,(V_PX)
    ld de,37
    add hl,de
    ld a,h
    and 1
    ld h,a
    ld (V_PX),hl
    ld a,(V_PY)
    add a,13
    cp 192
    jr c,.y
    sub 192
.y:
    ld (V_PY),a
    ld e,a
    ld d,0
    call P_MOVE
    ld hl,0
    ld (GA_X),hl
    ld (GA_Y),hl
    ld hl,512
    ld (GA_W),hl
    ld hl,192
    ld (GA_H),hl
    call P_SHIELD
    call G_CLS
T_CLSPDONE:
    call P_UNSHIELD
    ld hl,(V_CLS)
    inc hl
    ld (V_CLS),hl
    jr T_CLSPLOOP.loop

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
    ASSERT PROP6_I == PROP6_W + 256 && (PROP6_W & $FF) == 0 && (FONTP & $FF) == 0
    ASSERT SHL == SHR + 256 && (SHR & $FF) == 0 && PROP6_K == PROP6_A2 + 256 && GLYPH8 == FONTP + 128
    ASSERT $ <= $A000           ; chunk 4 only

    SAVEBIN "mem.bin", 0, 65536
