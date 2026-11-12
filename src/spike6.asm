; spike6.asm -- the mode 6 graphics spike's demo cartridge (docs/GRAPHICS_SPIKE.md sections 9 and 17).  A mock desktop drawn
; with gfx6: a menu bar whose menus open while fire is held, two overlapping windows (8x8 and proportional text), an icon, an XOR
; drag outline and the pointer.  After boot it plays a fixed input script (17.5), then reads joystick 1 and the keys Q/A/O/P/Space.
;
; Shape of gfx6t (12.4): DOCK chunks 0, 1, 4, 5, $F4 = $33; gfx6 in chunks 0-1, tables in chunk 4, the demo in chunk 5.

    DEVICE NOSLOT64K

PORT_HSR    EQU $F4
PORT_SCLD   EQU $FF
PORT_AY_REG EQU $F5
PORT_AY_DAT EQU $F6
F4_RUN      EQU $33             ; DOCK chunks 0,1,4,5; RAM 2,3 (display), 6,7
SCLD_MODE6  EQU %00000110       ; mode 6, black ink on white paper, frame interrupt on, DOCK
STACK_TOP   EQU $FF00
RESULT      EQU $FF00
R_STATE     EQU RESULT+2
S_SET       EQU $C000           ; the icon's shifted set (1,280 bytes)
S_SAVEBUF      EQU $E800           ; the menu's save-under buffer

; Variables ($E080-$E0FF, 17.2).  Boot clears $E000-$FFFF.
V_FRAMES    EQU $E080           ; word: frame interrupts
V_SHADOW_FF EQU $E082
V_SHADOW_F4 EQU $E083
V_TICK      EQU $E084           ; word: main-loop iterations
V_PX        EQU $E086           ; word: pointer x
V_PY        EQU $E088           ; byte: pointer y
V_MENU      EQU $E089           ; byte: open menu 0..4, $FF none
V_DRAG      EQU $E08A           ; byte: 0 none, 1 window A, 2 window B
V_CHECKS    EQU $E08B           ; byte: checkpoints passed
V_HOLD      EQU $E08C           ; byte: iterations a direction has been held (capped at 30)
V_FIREB     EQU $E08D           ; byte: fire in the previous iteration ($10 or 0)
V_IN        EQU $E08E           ; byte: this iteration's input bits
V_FLAGS     EQU $E08F           ; byte: bit 0 checkpoint, bit 1 the script's last iteration
V_SPTR      EQU $E090           ; word: the current script entry
V_SCNT      EQU $E092           ; byte: iterations left in it
V_LIVE      EQU $E093           ; byte: 1 once the script has ended
V_OPX       EQU $E094           ; word: x before this iteration's move
V_OPY       EQU $E096           ; word: y before it
V_QX        EQU $E098           ; word: drag press point
V_QY        EQU $E09A           ; word
V_WIN       EQU $E09C           ; word: the dragged window's rectangle
V_CHG       EQU $E09E           ; byte: 1 when this iteration moved the pointer
V_OL        EQU $E0A0           ; 8 bytes: D_OUTLINE's x, y, w, h
V_E         EQU $E0A8           ; 8 bytes: one edge's rectangle (x, y, w, h)
V_EK        EQU $E0B0           ; byte: 0 horizontal edge, 1 vertical

; Input bits (17.5)
IN_U        EQU 1
IN_D        EQU 2
IN_L        EQU 4
IN_R        EQU 8
IN_F        EQU 16
CHECK       EQU $80

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
    ld hl,$E000                 ; variables, buffers, stack and record (no stack in use yet)
    ld de,$E001
    ld bc,$FFFF-$E000
    ld (hl),0
    ldir
    xor a
    ld (V_SHADOW_FF),a          ; shadow before each OUT
    out (PORT_SCLD),a           ; DOCK selected before $F4
    ld a,F4_RUN
    ld (V_SHADOW_F4),a
    out (PORT_HSR),a
    jp BOOT

T_RET:
    jr T_RET

; The frame ISR (17.3): count the frame, map the display, P_ISR, put the shadow back.
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
    ld a,(V_SHADOW_F4)
    out (PORT_HSR),a
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

; =====================================================================================================================
    ORG $A000                   ; DOCK chunk 5: the demo
DEMO_CODE:

BOOT:
    im 1
    ld b,16                     ; AY registers 0 (port A an input: the joystick)
.ay:
    ld a,b
    dec a
    out (PORT_AY_REG),a
    xor a
    out (PORT_AY_DAT),a
    djnz .ay
    ld hl,$4000                 ; display files (and the unused tails) cleared
    ld de,$4001
    ld bc,$4000-1
    ld (hl),0
    ldir
    ld a,SCLD_MODE6
    ld (V_SHADOW_FF),a
    out (PORT_SCLD),a
    call G_INIT
    ld hl,256                   ; 17.5 state
    ld (V_PX),hl
    ld a,96
    ld (V_PY),a
    ld a,$FF
    ld (V_MENU),a
    ld hl,S_SCRIPT
    ld (V_SPTR),hl
    ld a,(hl)
    ld (V_SCNT),a
    ei
    ld hl,32                    ; the icon's shifted set
    ld (GA+4),hl
    ld hl,16
    ld (GA+6),hl
    ld hl,S_ICON
    ld (GA+8),hl
    ld hl,S_SET
    ld (GA+10),hl
    call G_PRESHIFT
    call D_SCENE
    ld hl,256
    ld de,96
    call P_INIT
    ld a,1
    ld (R_STATE),a
    ld hl,$5AA5
    ld (RESULT),hl              ; marker last

; ---------------------------------------------------------------------------------------------------------------------
; The main loop (17.5): one iteration per frame interrupt.
S_WAIT:
    halt
S_LOOP:
    ld hl,(V_TICK)
    inc hl
    ld (V_TICK),hl
    call get_input
    ld (V_IN),a
    call move
    call fire
    ld a,(V_FLAGS)
    rrca
    call c,S_CHECK
    ld a,(V_FLAGS)
    and 2
    jr z,S_WAIT
    ld a,2
    ld (R_STATE),a
    ld a,1
    ld (V_LIVE),a
    jr S_WAIT

S_CHECK:
    ld hl,V_CHECKS
    inc (hl)
    ret

; get_input: A = this iteration's bits (u d l r f in bits 0-4); V_FLAGS = checkpoint / end of script.
get_input:
    xor a
    ld (V_FLAGS),a
    ld a,(V_LIVE)
    or a
    jr nz,live_input
    ld hl,(V_SPTR)
    inc hl
    ld b,(hl)                   ; the entry's bits
    ld a,(V_SCNT)
    dec a
    ld (V_SCNT),a
    jr nz,.bits
    ld a,b                      ; the entry's last iteration
    rlca
    and 1
    ld (V_FLAGS),a              ; bit 7 -> checkpoint
    inc hl
    ld (V_SPTR),hl
    ld a,(hl)
    ld (V_SCNT),a
    or a
    jr nz,.bits
    ld a,(V_FLAGS)
    or 2                        ; n = 0: the script ends after this iteration
    ld (V_FLAGS),a
.bits:
    ld a,b
    and $1F
    ret

; live_input: joystick 1 OR the keys.  The joystick read is Leap Arcade's RT_STICK (docs/PROVENANCE.md): AY register 7 bit 6
; = 0 (port A an input), register 14 read with A8 high, active low; all four directions at once is an unconnected port (or
; ZEsarUX, which answers 0) and reads as no input, fire included.  The ISR never selects an AY register, so no DI is needed.
live_input:
    ld a,7
    out (PORT_AY_REG),a
    ld bc,PORT_AY_DAT           ; B = 0: no joystick strobed
    in a,(c)
    and $BF
    out (c),a
    ld a,14
    out (PORT_AY_REG),a
    ld b,1                      ; A8: joystick 1
    in a,(c)
    cpl
    ld l,a
    and $0F
    cp $0F
    ld e,0
    jr z,.keys                  ; all four: nothing
    ld e,a                      ; u d l r in bits 0-3
    bit 7,l
    jr z,.keys
    set 4,e
.keys:
    ld a,$FB                    ; Q W E R T
    in a,($FE)
    rra
    jr c,.k1
    set 0,e
.k1:
    ld a,$FD                    ; A S D F G
    in a,($FE)
    rra
    jr c,.k2
    set 1,e
.k2:
    ld a,$DF                    ; P O I U Y
    in a,($FE)
    rra
    jr c,.k3
    set 3,e                     ; P
.k3:
    rra
    jr c,.k4
    set 2,e                     ; O
.k4:
    ld a,$7F                    ; Space ...
    in a,($FE)
    rra
    jr c,.k5
    set 4,e
.k5:
    ld a,e
    ret

; move (17.5 step 3): acceleration, clamp, P_MOVE when the position changed.  V_OPX / V_OPY keep the old position, V_CHG = 1
; when it changed.
move:
    ld hl,(V_PX)
    ld (V_OPX),hl
    ld a,(V_PY)
    ld l,a
    ld h,0
    ld (V_OPY),hl
    xor a
    ld (V_CHG),a
    ld a,(V_IN)
    and $0F
    jr nz,.dir
    ld (V_HOLD),a               ; no direction: hold = 0
    ret
.dir:
    ld a,(V_HOLD)
    ld e,a
    ld d,0
    ld hl,S_STEP
    add hl,de
    ld c,(hl)                   ; C = s
    cp 30
    jr nc,.cap
    inc a
    ld (V_HOLD),a
.cap:
    ld a,(V_IN)
    ld b,a
    ld hl,(V_PX)
    ld e,c
    sla e                       ; 2 s
    ld d,0
    bit 3,b
    jr z,.nr
    add hl,de
.nr:
    bit 2,b
    jr z,.nl
    or a
    sbc hl,de
.nl:
    bit 7,h
    jr z,.xp
    ld hl,0
    jr .xok
.xp:
    ld a,h
    cp 2
    jr c,.xok
    ld hl,511
.xok:
    ld (V_PX),hl
    ld a,(V_PY)
    ld l,a
    ld h,0
    ld e,c
    bit 1,b
    jr z,.nd
    add hl,de
.nd:
    bit 0,b
    jr z,.nu
    or a
    sbc hl,de
.nu:
    bit 7,h
    jr z,.yp
    ld hl,0
    jr .yok
.yp:
    ld a,h
    or a
    jr nz,.yc
    ld a,l
    cp 192
    jr c,.yok
.yc:
    ld hl,191
.yok:
    ld a,l
    ld (V_PY),a
    ld hl,(V_PX)
    ld de,(V_OPX)
    or a
    sbc hl,de
    jr nz,.mv
    ld a,(V_OPY)
    ld hl,V_PY
    cp (hl)
    ret z
.mv:
    ld a,1
    ld (V_CHG),a
    ld hl,(V_PX)
    ld a,(V_PY)
    ld e,a
    ld d,0
    jp P_MOVE

; S_STEP[hold] = min(1 + floor(hold / 6), 6), hold = 0..30
S_STEP:
    DB 1,1,1,1,1,1, 2,2,2,2,2,2, 3,3,3,3,3,3, 4,4,4,4,4,4, 5,5,5,5,5,5, 6

; fire (17.5 step 4): press, held, release.
fire:
    ld a,(V_FIREB)
    ld c,a                      ; C = fire before
    ld a,(V_IN)
    and IN_F
    ld (V_FIREB),a
    or a
    jr z,.off
    ld a,c
    or a
    jr nz,.held
    call hit_title              ; press
    jp c,D_MENU_OPEN
    ld ix,W_B                   ; B first: it is in front
    call hit_bar
    ld a,2
    jr c,.drag
    ld ix,W_A
    call hit_bar
    ret nc
    ld a,1
.drag:
    ld (V_DRAG),a
    ld (V_WIN),ix
    ld hl,(V_PX)
    ld (V_QX),hl
    ld a,(V_PY)
    ld e,a
    ld d,0
    ld (V_QY),de
    jp outline_at               ; offset 0
.held:
    ld a,(V_MENU)
    cp $FF
    jr z,.hdrag
    call hit_title              ; (clobbers B)
    ret nc
    ld hl,V_MENU
    cp (hl)
    ret z
    push af
    call D_MENU_CLOSE
    pop af
    jp D_MENU_OPEN
.hdrag:
    ld a,(V_DRAG)
    or a
    ret z
    ld a,(V_CHG)
    or a
    ret z
    ld hl,(V_OPX)               ; erase at the old offset
    ld de,(V_OPY)
    call outline_at
    ld hl,(V_PX)                ; draw at the new one
    ld a,(V_PY)
    ld e,a
    ld d,0
    jp outline_at
.off:
    ld a,c
    or a
    ret z
    call D_MENU_CLOSE           ; nothing when no menu is open
    ld a,(V_DRAG)
    or a
    ret z
    ld hl,(V_OPX)               ; erase where the outline is drawn: the position before this iteration's move
    ld de,(V_OPY)
    call outline_at
    xor a
    ld (V_DRAG),a
    ret

; hit_title: carry and A = i when the hot spot is in T_i = (8 + 56 i, 0, 56, 10); no carry otherwise.
hit_title:
    ld a,(V_PY)
    cp 10
    jr nc,.no
    ld hl,(V_PX)
    ld de,8
    or a
    sbc hl,de
    jr c,.no
    ld de,280
    or a
    sbc hl,de
    jr nc,.no
    add hl,de                   ; HL = px - 8, 0..279
    ld de,56
    ld b,0
.div:
    or a
    sbc hl,de
    jr c,.got
    inc b
    jr .div
.got:
    ld a,b
    scf
    ret
.no:
    or a
    ret

; hit_bar: IX = a window's rectangle (x, y, w, h words).  Carry when the hot spot is in its title bar (x, y, w, 11).
hit_bar:
    ld hl,(V_PX)
    ld e,(ix+0)
    ld d,(ix+1)
    or a
    sbc hl,de
    jr c,.no
    ld e,(ix+4)
    ld d,(ix+5)
    or a
    sbc hl,de
    ret nc                      ; px - x >= w
    ld a,(V_PY)
    sub (ix+2)
    jr c,.no
    cp 11
    ret
.no:
    or a
    ret

; outline_at: HL = pointer x, DE = pointer y.  D_OUTLINE of the dragged window moved by (x - Qx, y - Qy).
outline_at:
    push de
    ld de,(V_QX)
    or a
    sbc hl,de
    ld ix,(V_WIN)
    ld e,(ix+0)
    ld d,(ix+1)
    add hl,de
    ld (GA_X),hl
    pop hl
    ld de,(V_QY)
    or a
    sbc hl,de
    ld e,(ix+2)
    ld d,(ix+3)
    add hl,de
    ld (GA_Y),hl
    ld l,(ix+4)
    ld h,(ix+5)
    ld (GA_W),hl
    ld l,(ix+6)
    ld h,(ix+7)
    ld (GA_H),hl
    ; fall through

; ---------------------------------------------------------------------------------------------------------------------
; D_OUTLINE (17.4): GA x, y, w, h (w >= 1, h >= 3).  The XOR outline, each edge under its own shield.  GA undefined after.
D_OUTLINE:
    ld hl,GA
    ld de,V_OL
    ld bc,8
    ldir
    ld hl,(V_OL+0)              ; top (x, y, w)
    ld de,(V_OL+2)
    ld bc,(V_OL+4)
    call ol_h
    ld hl,(V_OL+2)              ; bottom (x, y + h - 1, w)
    ld de,(V_OL+6)
    add hl,de
    dec hl
    ex de,hl
    ld hl,(V_OL+0)
    ld bc,(V_OL+4)
    call ol_h
    ld hl,(V_OL+6)              ; left (x, y + 1, h - 2)
    dec hl
    dec hl
    ld b,h
    ld c,l
    ld de,(V_OL+2)
    inc de
    ld hl,(V_OL+0)
    call ol_v
    ld hl,(V_OL+6)              ; right (x + w - 1, y + 1, h - 2)
    dec hl
    dec hl
    ld b,h
    ld c,l
    ld hl,(V_OL+0)
    ld de,(V_OL+4)
    add hl,de
    dec hl
    ld de,(V_OL+2)
    inc de
    ; fall through
ol_v:                           ; HL x, DE y, BC h: the vertical edge (x, y, 1, h)
    ld (V_E+0),hl
    ld (V_E+2),de
    ld (V_E+6),bc
    ld hl,1
    ld (V_E+4),hl
    ld a,1
    jr ol_line
ol_h:                           ; HL x, DE y, BC w: the horizontal edge (x, y, w, 1)
    ld (V_E+0),hl
    ld (V_E+2),de
    ld (V_E+4),bc
    ld hl,1
    ld (V_E+6),hl
    xor a
ol_line:
    ld (V_EK),a
    ld hl,V_E
    ld de,GA
    ld bc,8
    ldir
    call P_SHIELD
    ld a,2
    call G_SETOP
    ld hl,(V_E+0)
    ld de,(V_E+2)
    ld a,(V_EK)
    or a
    jr nz,.v
    ld bc,(V_E+4)
    call G_HLINE
    jr .done
.v:
    ld bc,(V_E+6)
    call G_VLINE
.done:
    xor a
    call G_SETOP
    jp P_UNSHIELD

; ---------------------------------------------------------------------------------------------------------------------
; D_SCENE, D_MENU_OPEN (A = i), D_MENU_CLOSE (17.4).  They run command tables; IX is preserved.
D_SCENE:
    push ix
    ld ix,SCENE
    call run_cmds
    pop ix
    ret

D_MENU_OPEN:
    push ix
    push af
    ld hl,MOPEN_TAB
    call tab_cmds
    pop af
    ld (V_MENU),a
    pop ix
    ret

D_MENU_CLOSE:
    ld a,(V_MENU)
    cp $FF
    ret z
    push ix
    ld hl,MCLOSE_TAB
    call tab_cmds
    ld a,$FF
    ld (V_MENU),a
    pop ix
    ret

; tab_cmds: run the command table at word HL[A].
tab_cmds:
    add a,a
    ld e,a
    ld d,0
    add hl,de
    ld a,(hl)
    inc hl
    ld h,(hl)
    ld l,a
    push hl
    pop ix
    ; fall through

; run_cmds: IX = a command table.  A command: +0 the routine (word, 0 ends the table), +2 A, +3 HL, +5 DE, +7 BC (words),
; +9 n, +10 n bytes copied to GA before the call.
run_cmds:
    ld l,(ix+0)
    ld h,(ix+1)
    ld a,h
    or l
    ret z
    push hl                     ; the routine
    ld c,(ix+9)
    ld b,0
    push ix
    pop hl
    ld de,10
    add hl,de                   ; HL = the GA bytes
    ld a,c
    or a
    jr z,.nog
    ld de,GA
    ldir                        ; HL = the next command
.nog:
    pop de
    push hl                     ; the next command
    ld hl,.back
    push hl
    push de
    ld a,(ix+2)
    ld l,(ix+3)
    ld h,(ix+4)
    ld e,(ix+5)
    ld d,(ix+6)
    ld c,(ix+7)
    ld b,(ix+8)
    ret                         ; into the routine; it returns to .back
.back:
    pop ix
    jr run_cmds

; ---------------------------------------------------------------------------------------------------------------------
; Command macros
    MACRO C_OP op
    DW G_SETOP
    DB op
    DW 0, 0, 0
    DB 0
    ENDM
    MACRO C_GA rout, xx, yy, ww, hh
    DW rout
    DB 0
    DW 0, 0, 0
    DB 8
    DW xx, yy, ww, hh
    ENDM
    MACRO C_FILL xx, yy, ww, hh
    C_GA G_FILL, xx, yy, ww, hh
    ENDM
    MACRO C_FRAME xx, yy, ww, hh
    C_GA G_FRAME, xx, yy, ww, hh
    ENDM
    MACRO C_CLIP xx, yy, ww, hh
    C_GA G_SETCLIP, xx, yy, ww, hh
    ENDM
    MACRO C_SHIELD xx, yy, ww, hh
    C_GA P_SHIELD, xx, yy, ww, hh
    ENDM
    MACRO C_UNSHIELD
    DW P_UNSHIELD
    DB 0
    DW 0, 0, 0
    DB 0
    ENDM
    MACRO C_TEXTP xx, yy, aa, zz
    C_GA G_TEXTP, xx, yy, aa, zz - aa
    ENDM
    MACRO C_TEXT8 col, row, aa, zz
    C_GA G_TEXT8, col, row, aa, zz - aa
    ENDM
    MACRO C_HLINE xx, yy, ww
    DW G_HLINE
    DB 0
    DW xx, yy, ww
    DB 0
    ENDM
    MACRO C_BLIT xx, yy, ww, hh, set
    DW G_BLIT
    DB 0
    DW 0, 0, 0
    DB 10
    DW xx, yy, ww, hh, set
    ENDM
    MACRO C_SAVE xx, yy, ww, hh, buf
    DW G_SAVERECT
    DB 0
    DW 0, 0, 0
    DB 10
    DW xx, yy, ww, hh, buf
    ENDM
    MACRO C_REST buf
    DW G_RESTRECT
    DB 0
    DW buf, 0, 0
    DB 0
    ENDM
    MACRO C_END
    DW 0
    ENDM
    ; a window (17.4 steps 1-4, then the clip on its interior); its content and C_CLIP 0, 0, 512, 192 follow
    MACRO C_WINDOW xx, yy, ww, hh, aa, zz
    C_OP 1
    C_FILL xx, yy, ww, hh
    C_OP 0
    C_FRAME xx, yy, ww, hh
    C_FILL xx, yy, ww, 11
    C_OP 2
    C_TEXTP xx + 8, yy + 2, aa, zz
    C_OP 0
    C_CLIP xx + 1, yy + 11, ww - 2, hh - 12
    ENDM
    ; menu i's open and close tables (17.4); the open table's items follow, then C_UNSHIELD, C_END
    MACRO C_MOPEN ii, kk
    C_SHIELD 8 + 56 * ii, 0, 56, 10
    C_OP 2
    C_FILL 8 + 56 * ii, 0, 56, 10
    C_OP 0
    C_UNSHIELD
    C_SHIELD 8 + 56 * ii, 10, 128, 10 * kk + 4
    C_SAVE 8 + 56 * ii, 10, 128, 10 * kk + 4, S_SAVEBUF
    C_OP 1
    C_FILL 8 + 56 * ii, 10, 128, 10 * kk + 4
    C_OP 0
    C_FRAME 8 + 56 * ii, 10, 128, 10 * kk + 4
    ENDM
    MACRO C_MCLOSE ii, kk
    C_SHIELD 8 + 56 * ii, 10, 128, 10 * kk + 4
    C_REST S_SAVEBUF
    C_UNSHIELD
    C_SHIELD 8 + 56 * ii, 0, 56, 10
    C_OP 2
    C_FILL 8 + 56 * ii, 0, 56, 10
    C_OP 0
    C_UNSHIELD
    C_END
    ENDM
    MACRO C_ITEM ii, jj, aa, zz
    C_TEXTP 16 + 56 * ii, 13 + 10 * jj, aa, zz
    ENDM

; ---------------------------------------------------------------------------------------------------------------------
; The scene (17.4)
SCENE:
    C_HLINE 0, 10, 512
    C_TEXTP 16 + 56 * 0, 1, ST_0, ST_1
    C_TEXTP 16 + 56 * 1, 1, ST_1, ST_2
    C_TEXTP 16 + 56 * 2, 1, ST_2, ST_3
    C_TEXTP 16 + 56 * 3, 1, ST_3, ST_4
    C_TEXTP 16 + 56 * 4, 1, ST_4, ST_E
    C_BLIT 432, 24, 32, 16, S_SET
    C_TEXTP 436, 42, SL_TAPES, SL_TAPES_E
    C_WINDOW 32, 24, 288, 104, SW_A, SW_A_E
    C_TEXT8 5, 5, SA_5, SA_6
    C_TEXT8 5, 6, SA_6, SA_7
    C_TEXT8 5, 7, SA_7, SA_9
    C_TEXT8 5, 9, SA_9, SA_10
    C_TEXT8 5, 10, SA_10, SA_11
    C_TEXT8 5, 11, SA_11, SA_12
    C_TEXT8 5, 12, SA_12, SA_13
    C_TEXT8 5, 13, SA_13, SA_E
    C_CLIP 0, 0, 512, 192
    C_WINDOW 224, 64, 256, 112, SW_B, SW_B_E
    C_TEXTP 232, 78 + 8 * 0, SB_0, SB_1
    C_TEXTP 232, 78 + 8 * 1, SB_1, SB_2
    C_TEXTP 232, 78 + 8 * 2, SB_2, SB_3
    C_TEXTP 232, 78 + 8 * 3, SB_3, SB_4
    C_TEXTP 232, 78 + 8 * 4, SB_4, SB_5
    C_TEXTP 232, 78 + 8 * 5, SB_5, SB_6
    C_TEXTP 232, 78 + 8 * 6, SB_6, SB_7
    C_TEXTP 232, 78 + 8 * 7, SB_7, SB_8
    C_TEXTP 232, 78 + 8 * 8, SB_8, SB_9
    C_TEXTP 232, 78 + 8 * 9, SB_9, SB_10
    C_TEXTP 232, 78 + 8 * 10, SB_10, SB_11
    C_TEXTP 232, 78 + 8 * 11, SB_11, SB_12
    C_TEXTP 232, 78 + 8 * 12, SB_12, SB_E
    C_CLIP 0, 0, 512, 192
    C_END

MOPEN_TAB:
    DW MO_0, MO_1, MO_2, MO_3, MO_4
MCLOSE_TAB:
    DW MC_0, MC_1, MC_2, MC_3, MC_4

MO_0:
    C_MOPEN 0, 3
    C_ITEM 0, 0, SM_00, SM_01
    C_ITEM 0, 1, SM_01, SM_02
    C_ITEM 0, 2, SM_02, SM_10
    C_UNSHIELD
    C_END
MO_1:
    C_MOPEN 1, 5
    C_ITEM 1, 0, SM_10, SM_11
    C_ITEM 1, 1, SM_11, SM_12
    C_ITEM 1, 2, SM_12, SM_13
    C_ITEM 1, 3, SM_13, SM_14
    C_ITEM 1, 4, SM_14, SM_20
    C_UNSHIELD
    C_END
MO_2:
    C_MOPEN 2, 4
    C_ITEM 2, 0, SM_20, SM_21
    C_ITEM 2, 1, SM_21, SM_22
    C_ITEM 2, 2, SM_22, SM_23
    C_ITEM 2, 3, SM_23, SM_30
    C_UNSHIELD
    C_END
MO_3:
    C_MOPEN 3, 3
    C_ITEM 3, 0, SM_30, SM_31
    C_ITEM 3, 1, SM_31, SM_32
    C_ITEM 3, 2, SM_32, SM_40
    C_UNSHIELD
    C_END
MO_4:
    C_MOPEN 4, 3
    C_ITEM 4, 0, SM_40, SM_41
    C_ITEM 4, 1, SM_41, SM_42
    C_ITEM 4, 2, SM_42, SM_E
    C_UNSHIELD
    C_END
MC_0:
    C_MCLOSE 0, 3
MC_1:
    C_MCLOSE 1, 5
MC_2:
    C_MCLOSE 2, 4
MC_3:
    C_MCLOSE 3, 3
MC_4:
    C_MCLOSE 4, 3

; Window rectangles (x, y, w, h)
W_A:
    DW 32, 24, 288, 104
W_B:
    DW 224, 64, 256, 112

; ---------------------------------------------------------------------------------------------------------------------
; Strings (each runs to the next label)
ST_0:   DB "Leap"
ST_1:   DB "File"
ST_2:   DB "Edit"
ST_3:   DB "View"
ST_4:   DB "Window"
ST_E:
SL_TAPES:   DB "Tapes"
SL_TAPES_E:
SW_A:   DB "Notes (8x8)"
SW_A_E:
SW_B:   DB "About mode 6 (proportional)"
SW_B_E:
SA_5:   DB "Leap Desktop spike6"
SA_6:   DB "Mode 6: 512 x 192, 64 columns."
SA_7:   DB "This window uses the 8x8 font."
SA_9:   DB "The pointer is drawn by the"
SA_10:  DB "frame interrupt. Hold fire on"
SA_11:  DB "a menu title to open its list,"
SA_12:  DB "or on a title bar to drag an"
SA_13:  DB "outline. Nothing else works."
SA_E:
SB_0:   DB "The quick brown fox jumps over the lazy dog."
SB_1:   DB "Mode 6 gives the desktop 512 pixels across, so a"
SB_2:   DB "proportional font fits about eighty characters on a"
SB_3:   DB "line. Each glyph is shifted into place through byte"
SB_4:   DB "tables and clipped to its window. This line is long enough to run past the right edge of the window."
SB_5:   DB "Menus, title bars and dialogs all use it:"
SB_6:   DB "(1) open, (2) scroll, [3] close;"
SB_7:   DB 34, "quotes", 34, ", 'apostrophes' & 100% {braces}"
SB_8:   DB "<angles> @home #tags $5 ~ok? Yes!"
SB_9:   DB "0123456789 ABCDEFGHIJKLM NOPQRSTUVWXYZ"
SB_10:  DB "abcdefghijklm nopqrstuvwxyz"
SB_11:  DB "Twelve lines fit; the thirteenth is cut by the clip."
SB_12:  DB "(clipped)"
SB_E:
SM_00:  DB "About Leap Desktop"
SM_01:  DB "Calculator"
SM_02:  DB "Notepad"
SM_10:  DB "New"
SM_11:  DB "Open..."
SM_12:  DB "Close"
SM_13:  DB "Save"
SM_14:  DB "Quit"
SM_20:  DB "Undo"
SM_21:  DB "Cut"
SM_22:  DB "Copy"
SM_23:  DB "Paste"
SM_30:  DB "By Icon"
SM_31:  DB "By Name"
SM_32:  DB "By Size"
SM_40:  DB "Bring to Front"
SM_41:  DB "Tile"
SM_42:  DB "Close All"
SM_E:

; ---------------------------------------------------------------------------------------------------------------------
; The attract script (17.5): n, bits (bit 7 = checkpoint on the entry's last iteration); n = 0 ends it.
S_SCRIPT:
    DB 30, CHECK                        ; 1  the scene
    DB 30, IN_U | IN_L                  ; 2  to "File"
    DB 40, IN_F | CHECK                 ; 3  "File" open
    DB 18, IN_R | IN_F                  ; 4  "Edit"
    DB 10, IN_F                         ; 5
    DB 18, IN_R | IN_F                  ; 6  "View"
    DB 10, IN_F                         ; 7
    DB 12, IN_R | IN_F                  ; 8  "Window"
    DB 20, IN_F | CHECK                 ; 9
    DB 20, CHECK                        ; 10 closed
    DB 24, IN_D                         ; 11 to B's title bar
    DB 2, 0                             ; 12
    DB 10, IN_F                         ; 13 drag starts
    DB 18, IN_D | IN_L | IN_F           ; 14
    DB 20, IN_F | CHECK                 ; 15
    DB 20, CHECK                        ; 16 released
    DB 60, IN_D | IN_R                  ; 17 to the corner
    DB 20, CHECK                        ; 18
    DB 24, IN_U | IN_L                  ; 19
    DB 20, CHECK                        ; 20 the end
    DB 0

; ---------------------------------------------------------------------------------------------------------------------
; The icon (17.4): 32 x 16, G_BLIT pair format (mask, image), 4 pairs a row.  '#' ink, '.' paper, ' ' transparent.
S_ICON:
    DB $80, $7F, $00, $FF, $00, $FF, $01, $FE  ;  ############################## 
    DB $00, $80, $00, $00, $00, $00, $00, $01  ; #..............................#
    DB $00, $BF, $00, $FF, $00, $FF, $00, $FD  ; #.############################.#
    DB $00, $A0, $00, $00, $00, $00, $00, $05  ; #.#..........................#.#
    DB $00, $A1, $00, $E0, $00, $07, $00, $85  ; #.#....####..........####....#.#
    DB $00, $A2, $00, $10, $00, $08, $00, $45  ; #.#...#....#........#....#...#.#
    DB $00, $A2, $00, $D3, $00, $CB, $00, $45  ; #.#...#.##.#..####..#.##.#...#.#
    DB $00, $A2, $00, $10, $00, $08, $00, $45  ; #.#...#....#........#....#...#.#
    DB $00, $A1, $00, $E0, $00, $07, $00, $85  ; #.#....####..........####....#.#
    DB $00, $A0, $00, $00, $00, $00, $00, $05  ; #.#..........................#.#
    DB $00, $BF, $00, $FF, $00, $FF, $00, $FD  ; #.############################.#
    DB $00, $80, $00, $00, $00, $00, $00, $01  ; #..............................#
    DB $00, $80, $00, $FF, $00, $FF, $00, $01  ; #.......################.......#
    DB $00, $81, $00, $30, $00, $0C, $00, $81  ; #......#..##........##..#......#
    DB $00, $82, $00, $30, $00, $0C, $00, $41  ; #.....#...##........##...#.....#
    DB $80, $7F, $00, $FF, $00, $FF, $01, $FE  ;  ############################## 
S_ICON_END:
    ASSERT S_ICON_END - S_ICON == 128

DEMO_CODE_END:
    ASSERT $ <= $C000           ; chunk 5 only

    SAVEBIN "mem.bin", 0, 65536
