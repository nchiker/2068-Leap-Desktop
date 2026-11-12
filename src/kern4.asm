; kern4.asm -- test cartridge for roadmap step 4, slice W1: the window manager (docs/WINDOWS.md section 14.5).  Boots like
; kern3 (same ISR), sets up the arenas, W_INIT, P_INIT (500, 180), then idles; the tests call the kernel routines directly
; (sentinel return T_RET) or send through T_SEND.  The test classes (src/kern4-classes.txt) log what they draw to T_LOG.

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
T_LOG       EQU $7800           ; 128 records of 16 bytes ($7800-$7FFF, not displayed in mode 6)
T_EVN       EQU $E092           ; word: events T_EVLOOP has logged
T_EVLOG     EQU $5800           ; 512 records of 4 bytes ($5800-$5FFF)
RESULT      EQU $FF00
R_STATE     EQU RESULT+2

KARENA_BASE EQU $F500
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
    call W_INIT
    ld hl,500
    ld (K_PX),hl
    ld a,180
    ld (K_PY),a
    ld de,180
    call P_INIT                 ; interrupts are still off: the first frame draws it
    ld a,1
    ld (R_STATE),a
    ld hl,$5AA5
    ld (RESULT),hl              ; marker last
    ei
    IFDEF DEMO
    jp D_MAIN                   ; kern4demo (docs/WINDOWS.md 18.6)
    ENDIF
T_IDLE:
    halt
    jr T_IDLE

T_RET:
    jr T_RET

; T_SEND: a send through RST $08, for the tests (IX, A, BC, DE as K_SEND).
T_SEND:
    rst $08
    ret

; T_APPLOOP (docs/WINDOWS.md 17.6): a program's event loop.  E_MENU and E_CMD are logged to T_EVLOG; the rest dispatched.
T_APPLOOP:
    ei
.loop:
    call K_GETEV
    jr c,.wait
    cp E_MENU
    jr z,.log
    cp E_CMD
    jr z,.log
    call K_DISPATCH
    jr .loop
.log:
    call t_evlog
    jr .loop
.wait:
    halt
    jr .loop

; T_EVONE (17.6): one event, fetched and dispatched.
T_EVONE:
    call K_GETEV
    ret c
    jp K_DISPATCH

T_SOK:
    DB 2, "OK"
T_SCANCEL:
    DB 6, "Cancel"

; T_EVLOOP (14.7): EI, then logs every event K_GETEV returns to T_EVLOG; HALT when there is none.
T_EVLOOP:
    ei
.loop:
    call K_GETEV
    jr c,.wait
    call t_evlog
    jr .loop
.wait:
    halt
    jr .loop

; t_evlog: K_EV appended to T_EVLOG (record T_EVN mod 512), T_EVN += 1.  Clobbers AF, BC, DE, HL.
t_evlog:
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
    ret


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

; The test cartridge's own code, in chunk 1 after the tables (docs/WINDOWS.md 2: the kernel fills chunk 5)
; ---------------------------------------------------------------------------------------------------------------------------
; The test classes' methods (docs/WINDOWS.md 14.5).  Each logs one 16-byte record: code, tag, IX, GCLIP (x0, x1, y0, y1), 4 zeros.
t_wdraw:                        ; TWin: log 1, then the window's own drawing
    ld a,1
    call t_log
    jp window_draw
t_cdraw:                        ; TCtl: log 2, paper, frame, diagonal
    ld a,2
    call t_log
    ld a,1
    call G_SETOP
    call w_gaview
    call G_FILL
    xor a
    call G_SETOP
    call w_gaview
    call G_FRAME
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    ld (GA),hl
    ld e,(ix+View_w)
    ld d,(ix+View_w+1)
    dec de
    add hl,de
    ld (GA+4),hl                ; x + w - 1
    ld l,(ix+View_y)
    ld h,0
    ld (GA+2),hl
    ld e,(ix+View_h)
    ld d,h
    dec de
    add hl,de
    ld (GA+6),hl                ; y + h - 1
    jp G_LINE
t_gdraw:                        ; TGrp: log 6, paper, then the children
    ld a,6
    call t_log
    ld a,1
    call G_SETOP
    call w_gaview
    call G_FILL
    jp group_draw
t_event:                        ; TCtl: log 3, carry = tag bit 0
    ld a,3
    call t_log
    ld a,(ix+TCtl_tag)
    rra
    ret
t_focus:
    ld a,4
    jr t_logc
t_blur:
    ld a,5
t_logc:
    call t_log
    or a
    ret

; t_log: A = code.  Writes record T_LOGN mod 128, increments T_LOGN.  Preserves BC, DE, IX, IY.  The tag is at offset 21 in
; a TWin and 16 in the others.
t_log:
    push bc
    push de
    push af
    ld hl,(T_LOGN)
    ld a,l
    inc hl
    ld (T_LOGN),hl
    and $7F
    ld l,a
    ld h,0
    add hl,hl
    add hl,hl
    add hl,hl
    add hl,hl
    ld de,T_LOG
    add hl,de
    pop af
    ld (hl),a
    inc hl
    ld a,(ix+0)
    cp CL_TWin & $FF
    jr nz,.ctl
    ld a,(ix+1)
    cp CL_TWin >> 8
    ld a,(ix+TWin_tag)
    jr z,.tag                   ; a TWin: its tag is at 21
.ctl:
    ld a,(ix+TCtl_tag)
.tag:
    ld (hl),a
    inc hl
    push ix
    pop de
    ld (hl),e
    inc hl
    ld (hl),d
    inc hl
    ex de,hl
    ld hl,GCLIP
    ld bc,8
    ldir
    ex de,hl
    xor a
    ld (hl),a
    inc hl
    ld (hl),a
    inc hl
    ld (hl),a
    inc hl
    ld (hl),a
    pop de
    pop bc
    ret
    ASSERT TCtl_tag == 16 && TGrp_tag == 16 && TWin_tag == 21

; Stubs for direct calls (14.5).
T_RAISEUPD:
    call W_RAISE
    jp W_UPDATE
T_OPENUPD:
    call W_OPEN
    jp W_UPDATE
T_CLOSEUPD:
    call W_CLOSE
    jp W_UPDATE
T_MOVEUPD:
    call W_MOVE
    jp W_UPDATE

; Menu tables (docs/WINDOWS.md 8, 18.6).  Records: id, title, item count, then items: id, flags (bit 0 disabled, bit 1
; separator), text.
T_MENUS:
    DB 3
    DW T_MA, T_MB, T_MC
T_MA:
    DB 1, 4, "Leap", 2
    DB 1, 0, 21, "About Leap Desktop..."
    DB 2, 0, 8, "Settings"
T_MB:
    DB 2, 4, "File", 5
    DB 1, 0, 10, "New window"
    DB 2, 0, 12, "Close window"
    DB 3, 2, 0
    DB 4, 1, 4, "Quit"
    DB 5, 0, 5, "Print"
T_MC:
    DB 3, 4, "Edit", 4
    DB 1, 0, 3, "Cut"
    DB 2, 0, 4, "Copy"
    DB 3, 0, 5, "Paste"
    DB 4, 0, 10, "Select all"
T_MENU8:                        ; 18.7: one menu of 8 items, about 96 pixels wide
    DB 1
    DW T_M8
T_M8:
    DB 2, 4, "File", 8
    DB 1, 0, 8, "New text"
    DB 2, 0, 9, "Open text"
    DB 3, 0, 9, "Save text"
    DB 4, 0, 9, "Save as.."
    DB 5, 0, 9, "Close all"
    DB 6, 0, 9, "Print one"
    DB 7, 0, 9, "Page size"
    DB 8, 0, 9, "Quit Leap"

T_TITLE1:
    DB 10, "Untitled 1"
T_TITLE2:
    DB 10, "Untitled 2"
T_TITLEL:
    DB 60, "A very long window title that will never fit in a small one."
    ASSERT $ - T_TITLEL == 61

    INCLUDE "kern4-classes.inc"

    INCLUDE "kernel/kernel1.asm"
    ASSERT $ <= $4000           ; chunks 0-1 only

    ORG $8000                   ; DOCK chunk 4: page-aligned tables
    INCLUDE "gfx6/tables4.inc"
    ASSERT RMASKP == LMASKP + 256 && (LMASKP & $FF) == 0
    ASSERT PROP6_I == PROP6_W + 256 && (PROP6_W & $FF) == 0 && (FONTP & $FF) == 0
    ASSERT SHL == SHR + 256 && (SHR & $FF) == 0 && PROP6_K == PROP6_A2 + 256 && GLYPH8 == FONTP + 128
    ASSERT $ <= $A000           ; chunk 4 only

    ORG $A000                   ; DOCK chunk 5: the kernel, then the test code
    INCLUDE "kernel/kernel.asm"
    IFDEF DEMO
    INCLUDE "kern4demo.asm"
    ENDIF

    ASSERT $ <= $C000           ; chunk 5 only

    SAVEBIN "mem.bin", 0, 65536
