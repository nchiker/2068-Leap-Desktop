; keycaps.asm -- Key Caps, program 2 (docs/KEYCAPS.md): the TS2068 keyboard and what each key types in the plane shown, the keys
; that are down pressed, and the last key typed.  It replaces the Controls demo.  Code in DOCK 2-3 (mapping A); its RAM image
; (the KeyCaps class and thunk, the strings it draws, the variables) is assembled for PROG_IMG.  Its views come from the app
; library's tables (docs/APPLIB.md 3).

KC_WINID    EQU 255

; KC_START: program 2: the image, the window and its views, then the loop.  Never returns.
KC_START:
    ld hl,KC_IMG
    ld de,PROG_IMG
    ld bc,KC_IMG_LEN
    ldir
    ld de,KC_VARS                   ; the variables are not in the image (SIZE 9)
    ld hl,KC_VEND
    call k_zero
    ld hl,KC_TWIN
    call AL_NEW                 ; the window
    ld (KC_WIN),ix
    call AL_VIEWS               ; the three radios
    inc hl
    inc hl
    call AL_VIEW                ; the keyboard
    ld (KC_KB),de
    call AL_VIEW                ; the status line
    ld (KC_LBL),de
    KFAR W_OPEN
    ld a,1
    KFAR K_MSET
kc_loop:
    call K_GETEV
    jr nc,.ev
    halt
    call kc_poll
    jr kc_loop
.ev:
    cp E_CMD
    jr z,.cmd
    cp E_KEY
    call z,kc_key
    KFAR TK_DISPATCH
    jr kc_loop
.cmd:
    ld a,(K_EV+1)
    cp KC_WINID
    jr nz,.radio
    KFAR K_QUIT
.radio:                         ; ids 1-3: planes 0-2
    dec a
    cp 3
    jr nc,kc_loop
    ld (KC_SEL),a
    call kc_poll
    jr kc_loop

; kc_poll: the plane shown (3) and K_NOW against those the keyboard was drawn with: when either differs, they are taken and the
; keyboard redrawn.  Clobbers AF, BC, DE, HL, IX.
kc_poll:
    ld a,(K_MODS)
    ld c,1
    rra
    jr c,.p                     ; CAPS SHIFT held
    inc c
    rra
    jr c,.p                     ; SYMBOL SHIFT held
    ld a,(KC_SEL)
    ld c,a
.p:
    push bc                     ; C = the plane
    ld hl,KC_DOWN               ; the keys drawn become the old ones
    ld de,KC_OLD
    ld bc,8
    ldir
    ld hl,K_NOW
    ld de,KC_DOWN
    ld c,8
    ldir
    ld hl,KC_DOWN
    ld de,KC_CHG
    ld c,8
    ldir                        ; KC_CHG = a copy of KC_DOWN
    pop bc
    ld hl,KC_P
    ld a,(hl)
    ld (hl),c                   ; (C: the plane)
    cp c
    ld a,0
    jr nz,.draw                 ; another plane: the whole keyboard
    ld hl,KC_DOWN               ; the same plane: only the caps whose keys changed
    ld de,KC_OLD
    ld b,8
.l:
    ld a,(de)
    cp (hl)
    jr nz,.keys
    inc hl
    inc de
    djnz .l
    ret
.keys:
    ld hl,KC_OLD                ; KC_CHG = the keys that changed: one test a cap in mode 1
    ld de,KC_CHG
    ld b,8
.x:
    ld a,(de)                   ; (KC_CHG starts as a copy of KC_DOWN)
    xor (hl)
    ld (de),a
    inc hl
    inc de
    djnz .x
    ld a,1
.draw:
    ld (KC_MODE),a
    ld ix,(KC_KB)
    KFAR W_DRAWVIEW
    xor a
    ld (KC_MODE),a
    ret

; kc_key: an E_KEY (K_EV): the status line = "Last key: ", the code's label, " (code ", the code in decimal, ")"; redrawn.
; Clobbers AF, BC, DE, HL, IX.
kc_key:
    ld hl,KC_SLAST
    ld de,KC_STAT + 1
    ld bc,10
    ldir
    ld a,(K_EV+1)
    push de
    call kc_lbl
    pop de
    ld c,b
    ld b,0
    ldir                        ; (a typed code always has a label)
    ld hl,KC_SCODE
    ld c,7
    ldir
    ld a,(K_EV+1)
    ld c,0                      ; no digit yet
    ld b,100
    call kc_dig
    ld b,10
    call kc_dig
    add a,'0'
    ld (de),a
    inc de
    ld a,')'
    ld (de),a
    inc de
    ld a,e
    sub LOW (KC_STAT + 1)
    ld (KC_STAT),a
    ld ix,(KC_LBL)
    KFAR W_DRAWVIEW
    ret
; kc_dig: A = n, B = a power of ten, DE -> out, C = 0 before the first digit: n's digit at B written unless it is a leading 0;
; A = n mod B.  Clobbers F, L.
kc_dig:
    ld l,'0' - 1
.d:
    inc l
    sub b
    jr nc,.d
    add a,b
    push af
    ld a,l
    cp '0'
    jr nz,.out
    inc c
    dec c
    jr z,.skip
.out:
    ld (de),a
    inc de
    ld c,1
.skip:
    pop af
    ret

; kc_lbl: A = a code ($80 "CS", $81 "SS") -> HL = its label's codes (in the image), B = their count (0: none).  Clobbers AF, C,
; DE.
kc_lbl:
    cp 33
    jr c,.name
    cp 127
    jr nc,.name
    ld (KC_CH),a
    ld hl,KC_CH
    ld b,1
    ret
.name:
    ld c,a
    ld hl,KC_NAMES
.f:
    ld a,(hl)
    or a
    jr z,.none
    inc hl
    ld b,(hl)
    inc hl
    cp c
    ret z
    ld e,b
    ld d,0
    add hl,de
    jr .f
.none:
    ld b,a
    ret

; kc_draw: KeyCaps' M_DRAW (KEYCAPS 2).  KC_MODE 0: paper, then every cap of KC_ROWS in the plane KC_P, those down in KC_DOWN
; pressed.  KC_MODE 1 (kc_poll): only the pressed fill of each cap whose key differs between KC_OLD and KC_DOWN, toggled (XOR).
kc_draw:
    ld a,(KC_MODE)
    or a
    jr nz,.nclr
    ld l,(ix+View_x)                ; a full draw takes the keyboard's origin: the window may have been dragged by whole cells (the caps are laid out for x 40, y 54)
    ld h,(ix+View_x+1)
    ld de,-40
    add hl,de
    ld (KC_DX),hl
    ld a,(ix+View_y)
    sub 54
    ld (KC_DY),a
    or l
    or h
    ld (KC_MV),a                    ; non-zero when it is not where it opened (the redraw of one cap keeps these)
    KFAR w_clear                ; the view's rectangle to paper
.nclr:
    ld hl,KC_ROWS
.row:
    ld a,(hl)                   ; the row: y, first x, cap height; 0 ends
    or a
    ret z
    ld (KC_Y),a
    inc hl
    ld e,(hl)
    ld d,0
    ld (KC_X),de
    ld a,(KC_MV)
    or a
    jr z,.r0
    ld a,(KC_DY)                    ; moved: the row's y and first x offset
    ld b,a
    ld a,(KC_Y)
    add a,b
    ld (KC_Y),a
    push hl
    ld hl,(KC_DX)
    add hl,de
    ld (KC_X),hl
    pop hl
.r0:
    inc hl
    ld a,(hl)
    ld (KC_H),a
    inc hl
.cap:
    ld a,(hl)                   ; k ($FF ends the row), then the cap's width
    inc hl
    inc a
    jr z,.row
    dec a
    ld (KC_K),a
    ld a,(hl)
    inc hl
    ld (KC_W),a
    ld (KC_RP),hl
    ld a,(KC_MODE)
    or a
    jp nz,.down
    KFAR G_SETOP                ; SET (A = 0)
    call kc_ga
    ld hl,(KC_W)                ; (KC_H follows KC_W: H = 0 below)
    ld h,0
    ld (GA+4),hl
    ld a,(KC_H)
    ld l,a
    ld (GA+6),hl
    KFAR G_FRAME
    ld a,(KC_K)                 ; e = half-row * 8 + bit
    ld c,$80
    or a
    jr z,.lbl                   ; CAPS SHIFT
    inc c
    cp 57
    jr z,.lbl                   ; SYMBOL SHIFT
    ld c,3
    cp $40
    jr z,.lbl                   ; BREAK: "Brk"
    ld c,a                      ; the KEYMAP index k = 5 x half-row + bit
    rra
    rra
    rra
    and $1F
    ld b,a
    add a,a
    add a,a
    add a,b
    ld b,a
    ld a,c
    and 7
    add a,b
    ld e,a
    ld d,0
    ld hl,KEYMAP
    add hl,de
    ld a,(KC_P)
    ld e,40
.pl:
    or a
    jr z,.code
    add hl,de
    dec a
    jr .pl
.code:
    ld c,(hl)
.lbl:
    ld a,c
    call kc_lbl
    ld a,b
    or a
    jr z,.down
    ld (GA+4),hl
    ld l,b
    ld h,0
    ld (GA+6),hl
    KFAR G_TEXTW                ; HL = tw
    ex de,hl
    ld a,(KC_W)
    ld l,a
    ld h,0
    or a
    sbc hl,de
    sra h
    rr l                        ; floor((w - tw) / 2)
    ld de,(KC_X)
    add hl,de
    ld (GA),hl
    ld a,(KC_H)                 ; y + (h - 8) / 2
    sub 8
    rra
    ld hl,KC_Y
    add a,(hl)
    ld l,a
    ld h,0
    ld (GA+2),hl
    KFAR G_TEXTP
.down:                          ; mode 0: down; mode 1: changed (KC_CHG; BREAK from both states)
    ld hl,KC_DOWN
    ld a,(KC_MODE)
    or a
    jr z,.d0
    ld a,(KC_K)
    cp $40
    jr z,.brk
    ld hl,KC_CHG
.d0:
    call kc_kdn
    jr .t
.brk:
    call kc_kdn
    ld c,a
    ld hl,KC_OLD
    call kc_kdn
    xor c
.t:
    or a
    jr z,.next
    ld a,2
    KFAR G_SETOP                ; XOR
    call kc_ga
    ld hl,(GA)
    inc hl
    ld (GA),hl
    ld hl,GA+2
    inc (hl)
    ld a,(KC_W)
    sub 2
    ld l,a
    ld h,0
    ld (GA+4),hl
    ld a,(KC_H)
    sub 2
    ld l,a
    ld (GA+6),hl
    KFAR G_FILL
.next:
    ld a,(KC_W)                 ; x += w + 2
    add a,2
    ld hl,(KC_X)
    add a,l
    ld l,a
    jr nc,.nx
    inc h
.nx:
    ld (KC_X),hl
    ld hl,(KC_RP)
    jp .cap
; kc_ga: GA = (KC_X, KC_Y).  Clobbers AF, HL.
kc_ga:
    ld hl,(KC_X)
    ld (GA),hl
    ld a,(KC_Y)
    ld l,a
    ld h,0
    ld (GA+2),hl
    ret
; kc_kdn: HL -> 8 half-row bytes: A = $FF when the key of KC_K (e = half-row x 8 + bit) is down there, else 0.  BREAK ($40) is
; down when CAPS SHIFT (0) and SPACE (56) both are.  Clobbers F, B, DE.
kc_kdn:
    ld a,(KC_K)
    cp $40
    jr nz,kc_kbit
    push hl
    xor a
    call kc_kbit
    pop hl
    or a
    ret z
    ld a,56
; kc_kbit: A = e, HL -> 8 half-row bytes -> A = $FF when e's bit is set, else 0.  Clobbers F, B, DE, HL.
kc_kbit:
    ld b,a
    rra
    rra
    rra
    and $1F
    ld e,a
    ld d,0
    add hl,de
    ld a,b
    and 7
    ld b,a
    ld a,(hl)
    inc b
.r:
    rrca
    djnz .r
    sbc a,a
    ret

; KEYCAPS 7: the TS2068's rows (tsrun/keyboard.js's board): y, the first cap's x, the caps' height, then each cap's key as
; e = half-row x 8 + bit (the KEYMAP index is 5 x half-row + bit; $40 is BREAK, CAPS SHIFT + SPACE) and its width, $FF; 0 ends.
; Caps are 2 pixels apart.
KC_ROWS:
    DB 54, 40, 18
    DB 24, 36, 25, 36, 26, 36, 27, 36, 28, 36, 36, 36, 35, 36, 34, 36, 33, 36, 32, 36, $FF
    DB 76, 49, 18
    DB 16, 36, 17, 36, 18, 36, 19, 36, 20, 36, 44, 36, 43, 36, 42, 36, 41, 36, 40, 36, $FF
    DB 98, 58, 18
    DB 8, 36, 9, 36, 10, 36, 11, 36, 12, 36, 52, 36, 51, 36, 50, 36, 49, 36, 48, 70, $FF
    DB 120, 40, 18
    DB 0, 43, 1, 36, 2, 36, 3, 36, 4, 36, 60, 36, 59, 36, 58, 36, 57, 36, $40, 36, 0, 43, $FF
    DB 142, 128, 14
    DB 56, 254, $FF
    DB 0
KC_SLAST:   DB "Last key: "
KC_SCODE:   DB " (code "
; The window and its views (KEYCAPS 1): APPLIB 3 entries.
KC_TWIN:
    DW CL_CWindow, 32
    DB 24
    DW 448
    DB 160, 0, KC_WINID, 8
    DW KC_STITLE
    DW CL_Check, 48
    DB 40
    DW 96
    DB 9, $19, 1, 0
    DW KC_SPLAIN
    DW CL_Check, 160
    DB 40
    DW 120
    DB 9, $11, 2, 0
    DW KC_SCAPS
    DW CL_Check, 296
    DB 40
    DW 136
    DB 9, $11, 3, 0
    DW KC_SSYM
    DW 0
    DW CL_KeyCaps, 40
    DB 54
    DW 432
    DB 102, 0, 4, 0
    DW 0
    DW CL_Label, 48
    DB 162
    DW 400
    DB 9, 0, 5, 0
    DW KC_STAT

; ---------------------------------------------------------------------------------------------------------------------------
; The RAM image (to PROG_IMG).
KC_IMG:
    DISP PROG_IMG
    DW CL_View
    DB 206, 6, View_SIZE, 8
CL_KeyCaps:                     ; KeyCaps: a View whose Draw is banked
    DW view_destroy, KC_THD, k_nop, view_hittest, k_nop, k_nop
KC_THD:     KTHUNK kc_draw
KC_STITLE:  DB 8, "Key Caps"
KC_SPLAIN:  DB 5, "Plain"
KC_SCAPS:   DB 10, "Caps Shift"
KC_SSYM:    DB 12, "Symbol Shift"
KC_NAMES:                       ; code, n, the name (KEYCAPS 2)
    DB 1, 4, "Caps"
    DB 3, 3, "Brk"
    DB 8, 4, "Left"
    DB 9, 5, "Right"
    DB 10, 4, "Down"
    DB 11, 2, "Up"
    DB 12, 3, "Del"
    DB 13, 5, "Enter"
    DB 14, 3, "Tab"
    DB 15, 4, "BTab"
    DB 16, 4, "Menu"
    DB 17, 5, "Close"
    DB 18, 4, "Mark"
    DB 27, 3, "Esc"
    DB 32, 5, "Space"
    DB $80, 2, "CS"
    DB $81, 2, "SS"
    DB 0
KC_STAT:    DB 12, "Press a key."
    ENT
KC_IMG_LEN  EQU $ - KC_IMG
KC_VARS     EQU PROG_IMG + KC_IMG_LEN    ; the variables are not in the image (SIZE 9): cleared at start; the first 14 bytes are KC_STAT's buffer after its text
KC_CH       EQU KC_VARS + 14
KC_WIN      EQU KC_CH + 1
KC_KB       EQU KC_WIN + 2
KC_LBL      EQU KC_KB + 2
KC_SEL      EQU KC_LBL + 2   ; the checked radio's plane
KC_P        EQU KC_SEL + 1   ; the plane and the keys down the keyboard is drawn with
KC_DOWN     EQU KC_P + 1
KC_OLD      EQU KC_DOWN + 8   ; the keys down before (kc_poll, KC_MODE 1)
KC_CHG      EQU KC_OLD + 8   ; the keys that changed (KC_OLD xor KC_DOWN, made by kc_poll)
KC_MODE     EQU KC_CHG + 8
KC_RP       EQU KC_MODE + 1
KC_X        EQU KC_RP + 2
KC_Y        EQU KC_X + 2
KC_W        EQU KC_Y + 1   ; the cap being drawn: its width, its row's height (KC_H follows KC_W)
KC_H        EQU KC_W + 1
KC_K        EQU KC_H + 1
KC_DX       EQU KC_K + 1   ; the keyboard's offset from its first position (x, y)
KC_DY       EQU KC_DX + 2
KC_MV       EQU KC_DY + 1
KC_VEND     EQU KC_MV + 1
    ASSERT KC_VEND <= AL_RAM && (CL_KeyCaps >> 8) == ((CL_KeyCaps + 11) >> 8)
    ASSERT (KC_STAT >> 8) == ((KC_STAT + 26) >> 8) && KC_H == KC_W + 1 && KC_CHG == KC_OLD + 8
KC_END:
