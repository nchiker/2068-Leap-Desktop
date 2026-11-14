; paint.asm -- Paint, program 4 (docs/PAINT.md): a MacPaint-style bitmap editor in mode 6.  Code in DOCK 2-3 (mapping A); its RAM image (the
; two view classes with their thunks, the strings and tables the kernel draws) is assembled for PROG_IMG; its variables follow the image
; and are cleared at start (PAINT 11), not copied.  Symbols take the prefix PT_ (the window's variables) and pt_ (code).
; Slice P1a: the window, the tool box, the picture's banded redraw (PAINT 4), the menus and the loop.  The tools come in P1b.

PT_WINID    EQU 255
PT_PICLEN   EQU 4 + 40 * 144        ; the copy of the picture (PAINT 3): header (16, 40, 32, 144), then the two parts of 20 x 144 bytes
PT_PART     EQU 20 * 144            ; the second part's offset from the first
PT_BANDLEN  EQU 4 + 40 * 8          ; the band buffer (PAINT 4): header + 8 rows of 40 bytes

; PT_START: the image, the variables, the menus, the picture and the band buffer, the window and its views, then the loop.  Never returns.
PT_START:
    ld hl,PT_IMG
    ld de,PROG_IMG
    ld bc,PT_IMG_LEN
    ldir
    ld hl,PT_VARS                   ; the variables are not in the image: cleared (PAINT 11)
    ld de,PT_VARS + 1
    ld bc,PT_VARS_LEN - 1
    ld (hl),0
    ldir
    call AL_INIT
    ld hl,PT_MENUS
    KFAR MB_SET
    ld bc,PT_PICLEN
    call K_ALLOC                    ; zeroed: a white picture
    ld (PT_PIC),hl
    ld (hl),16                      ; the header (c0, nc, y0, nr) of G_SAVERECT's buffer for (128, 32, 320, 144)
    inc hl
    ld (hl),40
    inc hl
    ld (hl),32
    inc hl
    ld (hl),144
    ld bc,PT_BANDLEN
    call K_ALLOC
    ld (PT_BAND),hl
    ld hl,PT_TWIN                   ; the window and its views (APPLIB 3)
    call AL_NEW
    ld (PT_WIN),ix
    call AL_VIEW                    ; the tool box
    call AL_VIEW                    ; the canvas
    ld (PT_CV),de
    call AL_VIEW                    ; the status line
    ld (PT_LBL),de
    KFAR W_OPEN
    ld a,1
    KFAR K_MSET
    ld a,1
    ld (PT_TOOL),a                  ; the pencil
    call pt_status
pt_loop:
    call K_GETEV
    jr nc,.ev
    halt
    jr pt_loop
.ev:
    cp E_MENU
    jr z,.menu
    cp E_CMD
    jr z,.cmd
    KFAR TK_DISPATCH
    jr pt_loop
.menu:
    call pt_menu
    jr pt_loop
.cmd:
    ld a,(K_EV+1)
    cp PT_WINID
    jr nz,pt_loop
    KFAR K_QUIT                     ; the close box or SS+Q

; pt_menu: E_MENU (K_EV+1 the menu, K_EV+2 the item).  P1a: Quit only.
pt_menu:
    ld hl,(K_EV+1)                  ; L = the menu, H = the item
    ld a,l
    dec a
    ret nz                          ; Edit: later
    ld a,h
    cp 4
    ret nz
    KFAR K_QUIT

; pt_status: the status line = the tool's name (PT_TNAMES), redrawn.  Clobbers AF, BC, DE, HL, IX.
pt_status:
    ld hl,PT_TNAMES
    ld a,(PT_TOOL)
    ld b,a
.f:
    ld a,b
    or a
    jr z,.got
    ld a,(hl)
    inc a
    ld e,a
    ld d,0
    add hl,de
    dec b
    jr .f
.got:
    ld a,(hl)
    inc a
    ld c,a
    ld b,0
    ld de,PT_STAT
    ldir
    ld ix,(PT_LBL)
    KFAR W_DRAWVIEW
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; The tool box (class Palette, PAINT 2, 7): 2 columns x 5 rows of cells 32 x 16, the cell of tool t at (View_x + 1 + 32 (t AND 1),
; View_y + 1 + 16 (t >> 1)); a cell is the tool's 16 x 16 icon in the middle, a frame 1 pixel outside (neighbours share it), and the chosen
; tool's cell inverted.

; pt_pdraw: Palette's M_DRAW (IX = the view).
pt_pdraw:
    KFAR w_clear
    xor a
    ld (PT_T),a
.cell:
    ld a,(PT_T)
    call pt_cellxy
    ld hl,(PT_CX)                   ; the icon: (x + 8, y, 16, 16), its set 96 bytes a tool
    ld de,8
    add hl,de
    ld (GA),hl
    ld hl,(PT_CY)
    ld (GA+2),hl
    ld hl,16
    ld (GA+4),hl
    ld (GA+6),hl
    ld a,(PT_T)
    ld hl,TICON_MARQUEE
    ld de,96
.s:
    or a
    jr z,.sd
    add hl,de
    dec a
    jr .s
.sd:
    ld (GA+8),hl
    KFAR G_BLIT
    xor a
    ld (GOP),a                      ; SET
    ld hl,(PT_CX)                   ; the frame (x - 1, y - 1, 33, 17)
    dec hl
    ld (GA),hl
    ld hl,(PT_CY)
    dec hl
    ld (GA+2),hl
    ld hl,33
    ld (GA+4),hl
    ld hl,17
    ld (GA+6),hl
    KFAR G_FRAME
    ld a,(PT_TOOL)
    ld hl,PT_T
    cp (hl)
    jr nz,.next
    ld a,2
    ld (GOP),a                      ; XOR: the cell's inside (x, y, 31, 15)
    ld hl,(PT_CX)
    ld (GA),hl
    ld hl,(PT_CY)
    ld (GA+2),hl
    ld hl,31
    ld (GA+4),hl
    ld hl,15
    ld (GA+6),hl
    KFAR G_FILL
.next:
    ld hl,PT_T
    inc (hl)
    ld a,(hl)
    cp 10
    jp c,.cell
    ret

; pt_cellxy: A = a tool (0-9), IX = the Palette -> PT_CX, PT_CY = its cell's top left.  Clobbers AF, BC, DE, HL.
pt_cellxy:
    ld c,a
    and 1
    rrca
    rrca
    rrca                            ; 0 or 32
    ld e,a
    ld d,0
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    inc hl
    add hl,de
    ld (PT_CX),hl
    ld a,c
    and $FE
    add a,a
    add a,a
    add a,a                         ; 16 x row
    add a,(ix+View_y)
    inc a
    ld l,a
    ld h,0
    ld (PT_CY),hl
    ret

; pt_pevent: Palette's M_EVENT (DE = K_EV; carry = consumed).  A press on a cell chooses that tool.
pt_pevent:
    ex de,hl
    ld a,(hl)
    inc hl
    ld c,(hl)                       ; data 1: x low
    inc hl
    ld b,(hl)                       ; data 2: y
    inc hl
    ld e,(hl)                       ; data 3: bit 0 = x bit 8
    cp E_DOWN
    jr z,.dn
    cp E_UP
    jr z,.cons
    or a
    ret
.cons:
    scf
    ret
.dn:
    ld a,e
    and 1
    ld d,a
    ld e,c                          ; DE = x
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    inc hl                          ; the cells' left edge
    ex de,hl
    or a
    sbc hl,de                       ; HL = x - left
    jr c,.cons
    ld a,h
    or a
    jr nz,.cons
    ld a,l
    cp 64
    jr nc,.cons
    rlca
    rlca
    rlca
    and 7                           ; the column (x >> 5)
    ld d,a
    ld a,(ix+View_y)
    inc a
    ld l,a                          ; the cells' top edge
    ld a,b
    sub l
    jr c,.cons
    cp 80
    jr nc,.cons
    rrca
    rrca
    rrca
    rrca
    and $0F                         ; the row
    add a,a
    add a,d                         ; the tool
    ld hl,PT_TOOL
    cp (hl)
    jr z,.cons
    ld (hl),a
    KFAR W_DRAWVIEW                 ; the box again (IX is still the view)
    push ix
    call pt_status
    pop ix
    scf
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; The canvas (class Canvas, PAINT 2-5): the picture is the 320 x 144 pixels at (128, 32) inside a 2-pixel border.

; pt_cdraw: Canvas' M_DRAW (IX = the view; the clip is the repaint rectangle, the pointer shielded).  The border, then the picture
; restored from its copy by bands of up to 8 rows (PAINT 4): G_RESTRECT ignores the clip, so each band packs only the columns and rows
; of the clip (the repaint rectangles are cells of 16 x 8 pixels: the first column and the column count are even).
pt_cdraw:
    xor a
    ld (GOP),a
    ld hl,126
    ld (GA),hl
    ld hl,30
    ld (GA+2),hl
    ld hl,324
    ld (GA+4),hl
    ld hl,148
    ld (GA+6),hl
    KFAR G_FRAME
    ld hl,127
    ld (GA),hl
    ld hl,31
    ld (GA+2),hl
    ld hl,322
    ld (GA+4),hl
    ld hl,146
    ld (GA+6),hl
    KFAR G_FRAME
    ld hl,(GCX0)                    ; the clip in the picture's pixels: columns k0 .. k1 (byte columns, k0 even, k1 even)
    ld de,128
    or a
    sbc hl,de
    jr nc,.x0
    ld hl,0
.x0:
    ld b,3                          ; (HL <= 384)
.s0:
    srl h
    rr l
    djnz .s0
    ld a,l
    and $FE
    ld (PT_K0),a
    ld hl,(GCX1)
    or a
    sbc hl,de
    ret c
    ret z
    ld de,320
    push hl
    or a
    sbc hl,de
    pop hl
    jr c,.x1
    ex de,hl
.x1:
    ld de,7
    add hl,de
    ld b,3
.s1:
    srl h
    rr l
    djnz .s1
    ld a,l
    inc a
    and $FE                         ; (a byte pair: rounded up)
    ld hl,PT_K0
    sub (hl)
    ret z
    ret c
    ld (PT_NC),a
    srl a
    ld (PT_H),a                     ; bytes a row in each part
    ld b,a
    ld a,20
    sub b
    ld (PT_ADJ),a                   ; the step to the next row of a part: 20 - H
    ld a,(hl)
    srl a
    ld (PT_O),a                     ; the offset of k0 in a part's row
    ld hl,(GCY0)                    ; the rows: r0 .. r1 (picture rows)
    ld de,32
    or a
    sbc hl,de
    jr nc,.y0
    ld hl,0
.y0:
    ld a,l
    ld (PT_R),a
    ld hl,(GCY1)
    or a
    sbc hl,de
    ret c
    ret z
    ld a,l
    cp 144
    jr c,.y1
    ld a,144
.y1:
    ld (PT_RE),a
.band:
    ld a,(PT_RE)
    ld hl,PT_R
    sub (hl)
    ret z
    ret c
    cp 9
    jr c,.n
    ld a,8
.n:
    ld (PT_NR),a
    ld hl,(PT_BAND)                 ; the header: c0, nc, y0, nr
    ld a,(PT_K0)
    add a,16
    ld (hl),a
    inc hl
    ld a,(PT_NC)
    ld (hl),a
    inc hl
    ld a,(PT_R)
    add a,32
    ld (hl),a
    inc hl
    ld a,(PT_NR)
    ld (hl),a
    inc hl
    ex de,hl                        ; DE = the band's first region (the odd columns: G_SAVERECT's layout for an even first column)
    call pt_src
    call pt_rows
    call pt_src
    ld bc,PT_PART
    add hl,bc
    call pt_rows                    ; the second region (the even columns)
    ld hl,(PT_BAND)
    KFAR G_RESTRECT
    ld a,(PT_NR)
    ld hl,PT_R
    add a,(hl)
    ld (hl),a
    jr .band

; pt_src: HL = the first part's byte for row PT_R, column offset PT_O.  Keeps DE.  Clobbers AF, BC.
pt_src:
    push de
    ld a,(PT_R)
    ld l,a
    ld h,0
    add hl,hl
    add hl,hl                       ; 4 R
    ld d,h
    ld e,l
    add hl,hl
    add hl,hl                       ; 16 R
    add hl,de                       ; 20 R
    ld de,(PT_PIC)
    add hl,de
    ld a,(PT_O)
    ld e,a
    ld d,0
    add hl,de
    ld de,4
    add hl,de
    pop de
    ret

; pt_rows: PT_NR rows of PT_H bytes from HL (rows 20 bytes apart) to DE (packed).  Clobbers AF, BC.
pt_rows:
    ld a,(PT_NR)
    ld b,a
.r:
    push bc
    ld a,(PT_H)
    ld c,a
    ld b,0
    ldir
    ld a,(PT_ADJ)
    ld c,a
    ld b,0
    add hl,bc
    pop bc
    djnz .r
    ret

; pt_cevent: Canvas' M_EVENT (DE = K_EV; carry = consumed).  P1b.
pt_cevent:
    or a
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; The window and its views (PAINT 2): APPLIB 3 entries.  The tool box (55, 28, 66, 82), the canvas (126, 30, 324, 148), the status line.
PT_TWIN:
    DW CL_CWindow, 48
    DB 16
    DW 416
    DB 176, 0, PT_WINID, 8
    DW PT_STITLE
    DW CL_Palette, 55
    DB 28
    DW 66
    DB 82, 0, 1, 0
    DW 0
    DW CL_Canvas, 126
    DB 30
    DW 324
    DB 148, 0, 4, 0
    DW 0
    DW CL_Label, 127
    DB 180
    DW 324
    DB 9, 0, 5, 0
    DW PT_STAT

; ---------------------------------------------------------------------------------------------------------------------------
; The RAM image (to PROG_IMG).
PT_IMG:
    DISP PROG_IMG
    DW CL_View
    DB 207, 6, View_SIZE, 8
CL_Canvas:                          ; Canvas: a View whose Draw and Event are banked
    DW view_destroy, PT_CTD, PT_CTE, view_hittest, k_nop, k_nop
PT_CTD:     KTHUNK pt_cdraw
PT_CTE:     KTHUNK pt_cevent
    DW CL_View
    DB 208, 6, View_SIZE, 8
CL_Palette:                         ; Palette: the same, for the tool box (and later the patterns and brushes)
    DW view_destroy, PT_PTD, PT_PTE, view_hittest, k_nop, k_nop
PT_PTD:     KTHUNK pt_pdraw
PT_PTE:     KTHUNK pt_pevent
PT_STITLE:  DB 15, "Paint: Untitled"
PT_TNAMES:                          ; the tools' names, in the order of the tool box (PAINT 7)
    DB 7, "Marquee"
    DB 6, "Pencil"
    DB 5, "Brush"
    DB 6, "Eraser"
    DB 5, "Spray"
    DB 6, "Bucket"
    DB 4, "Line"
    DB 9, "Rectangle"
    DB 17, "Rounded rectangle"
    DB 4, "Oval"
PT_STAT:    DB 6, "Pencil"
            DS 26 - 6
PT_MENUS:
    DB 2
    DW PT_M1, PT_M2
PT_M1:
    DB 1, 4, "File", 5
    DB 1, 0, 3, "New"
    DB 2, 0, 7, "Open..."
    DB 3, 0, 7, "Save..."
    DB 0, 2, 0
    DB 4, 0, 4, "Quit"
PT_M2:
    DB 2, 4, "Edit", 2
    DB 1, 1, 4, "Undo"              ; disabled until there is something to undo
    DB 2, 0, 5, "Clear"
    ENT
PT_IMG_LEN  EQU $ - PT_IMG

; The variables (cleared at start; not in the image).
PT_VARS     EQU PROG_IMG + PT_IMG_LEN
PT_WIN      EQU PT_VARS             ; the window, the canvas, the status line
PT_CV       EQU PT_WIN + 2
PT_LBL      EQU PT_CV + 2
PT_PIC      EQU PT_LBL + 2          ; the picture's copy and the band buffer (arena)
PT_BAND     EQU PT_PIC + 2
PT_TOOL     EQU PT_BAND + 2         ; the chosen tool
PT_T        EQU PT_TOOL + 1         ; the tool being drawn
PT_CX       EQU PT_T + 1            ; its cell's top left
PT_CY       EQU PT_CX + 2
PT_K0       EQU PT_CY + 2           ; the band restore: first byte column (of the picture), count, bytes a row of each part, row step, offset
PT_NC       EQU PT_K0 + 1
PT_H        EQU PT_NC + 1
PT_ADJ      EQU PT_H + 1
PT_O        EQU PT_ADJ + 1
PT_R        EQU PT_O + 1            ; the band's first row, the clip's last row, the band's rows
PT_RE       EQU PT_R + 1
PT_NR       EQU PT_RE + 1
PT_VARS_END EQU PT_NR + 1
PT_VARS_LEN EQU PT_VARS_END - PT_VARS
    ASSERT PT_VARS_END <= AL_RAM && PT_IMG_LEN <= 1024
    ASSERT (CL_Canvas >> 8) == ((CL_Canvas + 11) >> 8) && (CL_Palette >> 8) == ((CL_Palette + 11) >> 8)
    ASSERT (PT_STAT >> 8) == ((PT_STAT + 26) >> 8)
PT_END:
