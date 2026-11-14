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

; kc_draw: KeyCaps' M_DRAW (KEYCAPS 2).  KC_MODE 0: paper, then the 40 caps in the plane KC_P, those down in KC_DOWN pressed.
; KC_MODE 1 (kc_poll): only the pressed fill of each cap whose key differs between KC_OLD and KC_DOWN, toggled (XOR).
kc_draw:
    ld a,(KC_MODE)
    or a
    jr nz,.nclr
    KFAR w_clear                ; the view's rectangle to paper
.nclr:
    ld hl,KC_KEYS
    ld (KC_KP),hl
    ld hl,KC_ROWS
    ld (KC_RP),hl
.row:
    ld hl,(KC_RP)
    ld e,(hl)                   ; the row's first x (40 + s_r), its y
    inc hl
    ld a,(hl)
    inc hl
    ld (KC_RP),hl
    or a
    ret z                       ; the end
    ld (KC_Y),a
    ld d,0
    ld (KC_X),de
    ld a,10
    ld (KC_C),a
.cap:
    ld hl,(KC_KP)
    ld a,(hl)
    inc hl
    ld (KC_KP),hl
    ld (KC_K),a
    ld a,(KC_MODE)
    or a
    jr nz,.down
    KFAR G_SETOP                ; SET (A = 0)
    call kc_ga
    ld hl,36
    ld (GA+4),hl
    ld l,18
    ld (GA+6),hl
    KFAR G_FRAME
    ld a,(KC_K)
    ld c,$80
    or a
    jr z,.lbl                   ; CAPS SHIFT
    inc c
    cp 36
    jr z,.lbl                   ; SYMBOL SHIFT
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
    ld hl,36
    or a
    sbc hl,de
    sra h
    rr l                        ; floor((36 - tw) / 2)
    ld de,(KC_X)
    add hl,de
    ld (GA),hl
    ld a,(KC_Y)
    add a,5
    ld l,a
    ld h,0
    ld (GA+2),hl
    KFAR G_TEXTP
.down:
    ld a,(KC_K)                 ; KC_DOWN[k / 5] bit (k mod 5)
    ld hl,KC_DOWN
.d5:
    cp 5
    jr c,.bit
    sub 5
    inc hl
    jr .d5
.bit:
    ld b,a
    ld c,(hl)                   ; mode 0: down; mode 1: changed
    ld a,(KC_MODE)
    or a
    jr z,.t
    ld de,KC_OLD - KC_DOWN
    add hl,de
    ld a,(hl)
    xor c
    ld c,a
.t:
    ld a,c
    inc b
.rot:
    rrca
    djnz .rot
    jr nc,.next
    ld a,2
    KFAR G_SETOP                ; XOR
    call kc_ga
    ld hl,(GA)
    inc hl
    ld (GA),hl
    ld hl,GA+2
    inc (hl)
    ld hl,34
    ld (GA+4),hl
    ld l,16
    ld (GA+6),hl
    KFAR G_FILL
.next:
    ld hl,(KC_X)
    ld de,40
    add hl,de
    ld (KC_X),hl
    ld hl,KC_C
    dec (hl)
    jp nz,.cap
    jp .row
; kc_ga: GA = (KC_X, KC_Y).  Clobbers AF, HL.
kc_ga:
    ld hl,(KC_X)
    ld (GA),hl
    ld a,(KC_Y)
    ld l,a
    ld h,0
    ld (GA+2),hl
    ret

; KEYCAPS 2: the key index k of each cap, row by row; each row's first x and its y (0 ends).
KC_KEYS:
    DB 15, 16, 17, 18, 19, 24, 23, 22, 21, 20
    DB 10, 11, 12, 13, 14, 29, 28, 27, 26, 25
    DB 5, 6, 7, 8, 9, 34, 33, 32, 31, 30
    DB 0, 1, 2, 3, 4, 39, 38, 37, 36, 35
KC_ROWS:
    DB 40, 62, 46, 84, 52, 106, 40, 128, 0, 0
KC_SLAST:   DB "Last key: "
KC_SCODE:   DB " (code "
; The window and its views (KEYCAPS 1): APPLIB 3 entries.
KC_TWIN:
    DW CL_CWindow, 32
    DB 32
    DW 448
    DB 136, 0, KC_WINID, 8
    DW KC_STITLE
    DW CL_Check, 48
    DB 48
    DW 96
    DB 9, $19, 1, 0
    DW KC_SPLAIN
    DW CL_Check, 160
    DB 48
    DW 120
    DB 9, $11, 2, 0
    DW KC_SCAPS
    DW CL_Check, 296
    DB 48
    DW 136
    DB 9, $11, 3, 0
    DW KC_SSYM
    DW 0
    DW CL_KeyCaps, 40
    DB 62
    DW 432
    DB 88, 0, 4, 0
    DW 0
    DW CL_Label, 48
    DB 154
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
            DS 26 - 12
KC_CH:      DB 0
KC_WIN:     DW 0
KC_KB:      DW 0
KC_LBL:     DW 0
KC_SEL:     DB 0                ; the checked radio's plane
KC_P:       DB 0                ; the plane and the keys down the keyboard is drawn with
KC_DOWN:    DS 8, 0
KC_OLD:     DS 8, 0             ; the keys down before (kc_poll, KC_MODE 1)
KC_MODE:    DB 0
KC_KP:      DW 0
KC_RP:      DW 0
KC_X:       DW 0
KC_Y:       DB 0
KC_C:       DB 0
KC_K:       DB 0
    ENT
KC_IMG_LEN  EQU $ - KC_IMG
    ASSERT PROG_IMG + KC_IMG_LEN <= AL_RAM && (CL_KeyCaps >> 8) == ((CL_KeyCaps + 11) >> 8)
    ASSERT (KC_STAT >> 8) == ((KC_STAT + 26) >> 8)
KC_END:
