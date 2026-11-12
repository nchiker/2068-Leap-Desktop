; demo.asm -- the toolkit demo (docs/TOOLKIT.md 9.4): the "Controls" window, built by banked code (DOCK 2-3, mapping A) from
; the "Calc" menu's item 3, and the desktop's menu table.  Its RAM image is assembled for D_IMG_ADDR ($C100), copied by D_INIT.

; D_INIT: the image to its address (boot, under A).
D_INIT:
    ld hl,D_IMG
    ld de,D_IMG_ADDR
    ld bc,D_IMG_LEN
    ldir
    ret

; D_MENU: A = the item of the Calc menu (not 1 or 2).  Item 3 builds and opens the window once, then raises it.
D_MENU:
    cp 3
    jp nz,c_loop
    ld ix,(D_WIN)
    ld a,ixh
    or ixl
    jr z,.build
    KFAR W_RAISE
    jp c_loop
.build:
    ld hl,CL_Window
    call K_NEW
    ld (ix+View_x),LOW 352
    ld (ix+View_x+1),HIGH 352
    ld (ix+View_y),16
    ld (ix+View_w),144
    ld (ix+View_h),112
    ld (ix+Window_title),LOW D_TITLE
    ld (ix+Window_title+1),HIGH D_TITLE
    ld (D_WIN),ix
    ld hl,D_TBL
    ld (D_P),hl
    ld a,D_TBL_N
    ld (D_N),a
.ent:                           ; class, x, y, w, h, flags, id, text (11 bytes)
    ld hl,(D_P)
    ld e,(hl)
    inc hl
    ld d,(hl)
    inc hl
    ld (D_P),hl
    ex de,hl
    call K_NEW
    ld hl,(D_P)
    ld a,(hl)
    ld (ix+View_x),a
    inc hl
    ld a,(hl)
    ld (ix+View_x+1),a
    inc hl
    ld a,(hl)
    ld (ix+View_y),a
    inc hl
    ld a,(hl)
    ld (ix+View_w),a
    inc hl
    ld a,(hl)
    ld (ix+View_h),a
    inc hl
    ld a,(hl)
    ld (ix+View_flags),a
    inc hl
    ld a,(hl)
    ld (ix+View_id),a
    inc hl
    ld a,(hl)
    ld (ix+16),a                ; Check_text / Label_text
    inc hl
    ld a,(hl)
    ld (ix+17),a
    inc hl
    ld (D_P),hl
    ld (D_LBL),ix               ; the last entry is the label
    call d_add
    ld hl,D_N
    dec (hl)
    jr nz,.ent
    ld hl,CL_DTgt               ; the bar's target
    call K_NEW
    ld (D_TGT),ix
    ld hl,CL_VScroll
    call K_NEW
    ld (ix+View_x),LOW 476
    ld (ix+View_x+1),HIGH 476
    ld (ix+View_y),32
    ld (ix+View_w),12
    ld (ix+View_h),80
    ld (ix+View_id),133
    ld (ix+VScroll_value),10
    ld (ix+VScroll_max),20
    ld (ix+VScroll_page),5
    ld hl,(D_TGT)
    ld (ix+VScroll_target),l
    ld (ix+VScroll_target+1),h
    call d_add
    ld ix,(D_WIN)
    KFAR W_OPEN
    jp c_loop

d_add:                          ; IX = a new view -> the window's last child
    push ix
    pop de
    ld ix,(D_WIN)
    KFAR K_ADDCHILD
    ret

D_TBL:
    DW CL_Check
    DW 360
    DB 32, 72, 9, 1, 128
    DW D_SSOUND
    DW CL_Check
    DW 360
    DB 44, 72, 9, 1, 129
    DW D_SGRID
    DW CL_Check
    DW 360
    DB 60, 72, 9, $11, 130
    DW D_SSMALL
    DW CL_Check
    DW 360
    DB 72, 72, 9, $19, 131      ; checked
    DW D_SMED
    DW CL_Check
    DW 360
    DB 84, 72, 9, $11, 132
    DW D_SLARGE
    DW CL_Label
    DW 360
    DB 100, 100, 9, 0, 134
    DW D_VSTR
D_TBL_N     EQU ($ - D_TBL) / 11

; d_event: CDTgt's M_EVENT (IX = the target, DE -> the event): E_SCROLL writes "Value: n" and redraws the label.
d_event:
    ld a,(de)
    cp E_SCROLL
    jr z,.scroll
    or a
    ret
.scroll:
    inc de
    ld a,(de)
    ld hl,D_VSTR + 8
    ld e,0
    ld b,100
    call .digit
    ld b,10
    call .digit
    add a,'0'
    ld (hl),a
    inc hl
    ld a,l
    sub LOW (D_VSTR + 1)
    ld (D_VSTR),a
    push ix
    ld ix,(D_LBL)
    KFAR W_DRAWVIEW
    pop ix
    scf
    ret
.digit:                         ; A = A mod B; its digit A / B written unless a leading 0 (E = 0 until a digit is written)
    ld c,'0'
.l:
    sub b
    jr c,.e
    inc c
    jr .l
.e:
    add a,b
    push af
    ld a,c
    cp '0'
    jr nz,.w
    ld a,e
    or a
    jr z,.s
    ld a,'0'
.w:
    ld (hl),a
    inc hl
    ld e,1
.s:
    pop af
    ret

; The RAM image (DOCK 2-3 -> $C100).
D_IMG:
    DISP D_IMG_ADDR
    DW CL_View
    DB 203, 6, View_SIZE, 8
CL_DTgt:                        ; the bar's target: a View whose Event is banked
    DW view_destroy, k_nop, D_THEV, view_hittest, k_nop, k_nop
D_THEV:
    KTHUNK d_event
D_TITLE:    DB 8, "Controls"
D_SSOUND:   DB 5, "Sound"
D_SGRID:    DB 4, "Grid"
D_SSMALL:   DB 5, "Small"
D_SMED:     DB 6, "Medium"
D_SLARGE:   DB 5, "Large"
D_VSTR:     DB 9, "Value: 10", 0
D_MENUS:                        ; the desktop's menu: Calc (1): Clear (1), Clear entry (2), Controls... (3)
    DB 1
    DW D_M1
D_M1:
    DB 1, 4, "Calc", 3
    DB 1, 0, 5, "Clear"
    DB 2, 0, 11, "Clear entry"
    DB 3, 0, 11, "Controls..."
D_WIN:      DW 0
D_LBL:      DW 0
D_TGT:      DW 0
D_P:        DW 0
D_N:        DB 0
    ENT
D_IMG_LEN   EQU $ - D_IMG
    ASSERT D_IMG_ADDR + D_IMG_LEN <= AARENA_BASE && (CL_DTgt >> 8) == ((CL_DTgt + 11) >> 8)
D_END:
