; demo.asm -- "Controls", program 2 (docs/SHELL.md 5; the toolkit demo of docs/TOOLKIT.md 9.4, moved to (176, 32), grown by
; 10.5 with a List, its bar and a Field).  Code in DOCK 2-3 (mapping A); its RAM image is assembled for D_IMG_ADDR ($C000),
; copied by D_START.

; D_START: program 2 (docs/SHELL.md 5): the image, the window (a CWindow at (176, 32, 320, 144), TOOLKIT 10.5; its close box
; quits to the shell; no menu), the controls, then the event loop.  Never returns.
D_START:
    ld hl,D_IMG
    ld de,D_IMG_ADDR
    ld bc,D_IMG_LEN
    ldir
    ld hl,CL_CWindow
    call K_NEW
    ld (ix+View_id),D_WINID
    ld (ix+View_x),176
    ld (ix+View_y),32
    ld (ix+View_w),LOW 320
    ld (ix+View_w+1),HIGH 320
    ld (ix+View_h),144
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
    ld a,(ix+View_id)
    cp 129
    jr nz,.ngrid
    ld (D_GRID),ix
.ngrid:
    call d_add
    ld hl,D_N
    dec (hl)
    jr nz,.ent
    ld hl,CL_DTgt               ; the bar's target
    call K_NEW
    ld (D_TGT),ix
    ld hl,CL_VScroll
    call K_NEW
    ld (ix+View_x),LOW 300
    ld (ix+View_x+1),HIGH 300
    ld (ix+View_y),48
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
; TOOLKIT 10.5: the List and its bar, "Name:", the Field, the status line.
    ld hl,CL_List
    call K_NEW
    ld (D_LIST),ix
    ld hl,326
    ld bc,47 * 256 + 132
    ld de,74 * 256 + 136
    call d_rect
    ld hl,CL_VScroll
    call K_NEW
    ld hl,458
    ld bc,47 * 256 + 12
    ld de,74 * 256 + 135
    call d_rect
    ld (ix+View_flags),0
    ld hl,(D_LIST)
    ld (ix+VScroll_target),l
    ld (ix+VScroll_target+1),h
    push ix
    pop de
    ld ix,(D_LIST)
    ld (ix+List_bar),e
    ld (ix+List_bar+1),d
    push de
    call d_add                  ; the List
    pop ix
    call d_add                  ; its bar
    ld ix,(D_LIST)
    ld hl,D_ITEMS
    ld a,D_NITEMS
    KFAR TK_SETITEMS
    ld hl,CL_Label
    call K_NEW
    ld hl,184
    ld bc,134 * 256 + 32
    ld de,9 * 256 + 138
    call d_rect
    ld (ix+View_flags),0
    ld (ix+Label_text),LOW D_SNAME
    ld (ix+Label_text+1),HIGH D_SNAME
    call d_add
    ld hl,CL_Field
    call K_NEW
    ld (D_FLD),ix
    ld hl,220
    ld bc,132 * 256 + 160
    ld de,12 * 256 + 137
    call d_rect
    ld (ix+Field_buf),LOW D_FBUF
    ld (ix+Field_buf+1),HIGH D_FBUF
    ld (ix+Field_cap),40
    call d_add
    ld ix,(D_FLD)
    ld hl,D_SLEAP
    KFAR TK_SETTEXT
    ld hl,CL_Label
    call K_NEW
    ld (D_STL),ix
    ld hl,184
    ld bc,152 * 256 + 280 - 256
    ld de,9 * 256 + 139
    call d_rect
    ld (ix+View_w+1),1          ; w = 280
    ld (ix+View_flags),0
    ld (ix+Label_text),LOW D_STAT
    ld (ix+Label_text+1),HIGH D_STAT
    call d_add
    ld ix,(D_WIN)
    KFAR W_OPEN
    ld a,1
    KFAR K_MSET
d_loop:
    call K_GETEV
    jr nc,.ev
    halt
    jr d_loop
.ev:
    cp E_CMD
    jr nz,.disp
    ld a,(K_EV+1)
    cp D_WINID
    jr nz,d_cmd
    KFAR K_QUIT
.disp:
    KFAR TK_DISPATCH
    jr d_loop

D_WINID     EQU 255

; d_cmd: A = the View_id of a control's E_CMD (TOOLKIT 10.5): "Grid" switches the List's cell lines; the List and the Field write
; the status line.  Others: nothing.
d_cmd:
    cp 129
    jr z,.grid
    cp 136
    jr z,.list
    cp 137
    jr nz,d_loop
    ld hl,D_SPNAME              ; "Name: " and the Field's text
    ld ix,(D_FLD)
    ld e,(ix+Field_buf)
    ld d,(ix+Field_buf+1)
    jr .stat
.list:
    ld ix,(D_LIST)
    ld a,(ix+List_sel)
    cp $FF
    jr z,d_loop
    ld l,a
    ld h,0
    add hl,hl
    ld de,D_ITEMS
    add hl,de
    ld e,(hl)
    inc hl
    ld d,(hl)                   ; DE = the item
    ld hl,D_SPOPEN              ; "Open: "
.stat:                          ; status = the 6 codes at HL, then the string at DE cut at 40
    push de
    ld de,D_STAT + 1
    ld bc,6
    ldir
    pop hl
    ld a,(hl)
    inc hl
    cp 41
    jr c,.n
    ld a,40
.n:
    ld c,a
    ld b,0
    add a,6
    ld (D_STAT),a
    or a
    jr z,.e
    ld a,c
    or a
    jr z,.e
    ldir
.e:
    ld ix,(D_STL)
    KFAR W_DRAWVIEW
    jp d_loop
.grid:
    ld ix,(D_GRID)
    ld a,(ix+View_flags)
    ld ix,(D_LIST)
    res 4,(ix+View_flags)
    and 1 << 3                  ; Check's checked bit -> the List's cell lines (bit 4)
    jr z,.g0
    set 4,(ix+View_flags)
.g0:
    ld hl,D_ITEMS
    ld a,D_NITEMS
    KFAR TK_SETITEMS
    jp d_loop

; d_rect: IX = a new view: x = HL, y = B, w = C, h = D, id = E; focusable (flags 1).
d_rect:
    ld (ix+View_x),l
    ld (ix+View_x+1),h
    ld (ix+View_y),b
    ld (ix+View_w),c
    ld (ix+View_h),d
    ld (ix+View_id),e
    ld (ix+View_flags),1
    ret

d_add:                          ; IX = a new view -> the window's last child
    push ix
    pop de
    ld ix,(D_WIN)
    KFAR K_ADDCHILD
    ret

D_TBL:
    DW CL_Check
    DW 184
    DB 48, 72, 9, 1, 128
    DW D_SSOUND
    DW CL_Check
    DW 184
    DB 60, 72, 9, 1, 129
    DW D_SGRID
    DW CL_Check
    DW 184
    DB 76, 72, 9, $11, 130
    DW D_SSMALL
    DW CL_Check
    DW 184
    DB 88, 72, 9, $19, 131      ; checked
    DW D_SMED
    DW CL_Check
    DW 184
    DB 100, 72, 9, $11, 132
    DW D_SLARGE
    DW CL_Label
    DW 184
    DB 116, 100, 9, 0, 134
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
D_SNAME:    DB 5, "Name:"
D_SLEAP:    DB 4, "Leap"
D_SPOPEN:   DB "Open: "
D_SPNAME:   DB "Name: "
D_STAT:     DB 0
            DS 46
D_FBUF:     DB 0
            DS 40
D_ITEMS:    DW D_I0, D_I1, D_I2, D_I3, D_I4, D_I5, D_I6, D_I7, D_I8, D_I9, D_I10, D_I11
            DW D_I12, D_I13, D_I14, D_I15, D_I16, D_I17, D_I18, D_I19, D_I20, D_I21, D_I22, D_I23
D_NITEMS    EQU ($ - D_ITEMS) / 2
D_I0:       DB 8, "Accounts"
D_I1:       DB 12, "Address book"
D_I2:       DB 11, "Budget 1987"
D_I3:       DB 8, "Calendar"
D_I4:       DB 5, "Chess"
D_I5:       DB 5, "Diary"
D_I6:       DB 9, "Drawing 1"
D_I7:       DB 9, "Drawing 2"
D_I8:       DB 11, "Font editor"
D_I9:       DB 5, "Games"
D_I10:      DB 13, "Letter to Ann"
D_I11:      DB 6, "Loader"
D_I12:      DB 5, "Music"
D_I13:      DB 5, "Notes"
D_I14:      DB 10, "Phone list"
D_I15:      DB 5, "Poems"
D_I16:      DB 7, "Recipes"
D_I17:      DB 8, "Shopping"
D_I18:      DB 7, "Sprites"
D_I19:      DB 10, "Stock list"
D_I20:      DB 5, "To do"
D_I21:      DB 6, "Travel"
D_I22:      DB 9, "Utilities"
D_I23:      DB 5, "Zebra"
D_GRID:     DW 0
D_LIST:     DW 0
D_FLD:      DW 0
D_STL:      DW 0
D_WIN:      DW 0
D_LBL:      DW 0
D_TGT:      DW 0
D_P:        DW 0
D_N:        DB 0
    ENT
D_IMG_LEN   EQU $ - D_IMG
    ASSERT D_IMG_ADDR + D_IMG_LEN <= AARENA_BASE && (CL_DTgt >> 8) == ((CL_DTgt + 11) >> 8)
D_END:
