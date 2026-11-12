; kern3.asm -- test cartridge for roadmap step 3, objects and events (docs/OBJECTS_EVENTS.md section 13.6).  Boots like
; gfx6t (same ISR), sets up the kernel and app arenas, then idles; the tests call the kernel routines directly (sentinel return
; T_RET) or send through T_SEND.  The test classes (src/kern3-classes.txt) log every method they run to T_LOG.

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
T_LOGN      EQU $E090           ; word: log records written
T_LOG       EQU $E800           ; 256 records of 8 bytes ($E800-$EFFF)
T_EVN       EQU $E092           ; word: events T_EVLOOP has logged
T_EVLOG     EQU $5800           ; 512 records of 4 bytes ($5800-$5FFF)
RESULT      EQU $FF00
R_STATE     EQU RESULT+2

KARENA_BASE EQU $F100
KARENA_END  EQU $FB00
AARENA_BASE EQU $C000
AARENA_END  EQU $E000

    ORG $0000
    DB $00, $01                 ; LROS header
    DW ENTRY
    DB $BC

    ORG $0008
    INCLUDE "kernel/send.asm"
    ASSERT $ <= $0038

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
    call G_INIT
    ld hl,K_KARENA
    ld de,KARENA_BASE
    ld bc,KARENA_END
    call K_AINIT
    ld hl,K_AARENA
    ld de,AARENA_BASE
    ld bc,AARENA_END
    call K_AINIT
    ld hl,K_AARENA
    call K_ARENA
    xor a
    ld (K_AYREG),a              ; the AY loop above left register 0 selected
    ld hl,256
    ld (K_PX),hl
    ld a,96
    ld (K_PY),a
    ld de,96
    call P_INIT                 ; interrupts are still off: the first frame draws it
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

; T_SEND: a send through RST $08, for the tests (IX, A, BC, DE as K_SEND).
T_SEND:
    rst $08
    ret

; T_EVLOOP (14.7): EI, then logs every event K_GETEV returns to T_EVLOG; HALT when there is none.
T_EVLOOP:
    ei
.loop:
    call K_GETEV
    jr c,.wait
    ld hl,(T_EVN)
    ld a,h
    and 1
    ld h,a                      ; record n mod 512
    add hl,hl
    add hl,hl
    ld de,T_EVLOG
    add hl,de
    ex de,hl
    ld hl,K_EV
    ld bc,4
    ldir
    ld hl,(T_EVN)
    inc hl
    ld (T_EVN),hl
    jr .loop
.wait:
    halt
    jr .loop

; The frame ISR (14.7): count the frame, map the display, P_ISR, K_POLL, put the shadows back ($F4 and the AY latch).
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
    call K_POLL
T_POLLD:
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
    ASSERT $ <= $4000

    ORG $8000                   ; DOCK chunk 4: page-aligned tables
    INCLUDE "gfx6/tables4.inc"
    ASSERT RMASKP == LMASKP + 256 && (LMASKP & $FF) == 0
    ASSERT PROP6_I == PROP6_W + 256 && (PROP6_W & $FF) == 0 && (FONTP & $FF) == 0
    ASSERT SHL == SHR + 256 && (SHR & $FF) == 0 && PROP6_K == PROP6_A2 + 256 && GLYPH8 == FONTP + 128
    ASSERT $ <= $A000           ; chunk 4 only

    ORG $A000                   ; DOCK chunk 5: the kernel, then the test code
    INCLUDE "kernel/kernel.asm"

; ---------------------------------------------------------------------------------------------------------------------------
; The test classes' methods (13.6).  Each logs one record: code, IX, C, B, E, D, tag.
t_destroy:
    ld a,M_DESTROY
    call t_log
    jp view_destroy
t_draw:
    ld a,M_DRAW
    jr t_logc
t_focus:
    ld a,M_FOCUS
    jr t_logc
t_blur:
    ld a,M_BLUR
    jr t_logc
t_poke:
    ld a,M_POKE
    jr t_logc
t_draw2:
    ld a,M_DRAW + $80
    jr t_logc
t_poke2:
    ld a,M_POKE2 + $80
t_logc:
    call t_log
    or a
    ret
t_event:
    ld a,M_EVENT
    call t_log
    ld a,(ix+TLog_tag)
    rra                         ; carry = tag bit 0
    ret
t_hittest:
    ld a,M_HITTEST
    call t_log
    ld a,(ix+TLog_tag)
    rra
    rra                         ; carry = tag bit 1
    ret

; t_log: A = code; BC, DE = the method's arguments.  Writes record T_LOGN mod 256, increments T_LOGN.  Preserves IX, IY.
t_log:
    push de
    push af
    ld hl,(T_LOGN)
    ld a,l
    inc hl
    ld (T_LOGN),hl
    ld l,a
    ld h,0
    add hl,hl
    add hl,hl
    add hl,hl
    ld de,T_LOG
    add hl,de
    pop af
    ld (hl),a
    inc hl
    push ix
    pop de
    ld (hl),e
    inc hl
    ld (hl),d
    inc hl
    ld (hl),c
    inc hl
    ld (hl),b
    inc hl
    pop de
    ld (hl),e
    inc hl
    ld (hl),d
    inc hl
    ld a,(ix+TLog_tag)
    ld (hl),a
    ret

    INCLUDE "kern3-classes.inc"

    ASSERT $ <= $C000           ; chunk 5 only

    SAVEBIN "mem.bin", 0, 65536
