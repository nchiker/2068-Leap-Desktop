; paint.asm -- Paint, program 4 (docs/PAINT.md): a MacPaint-style bitmap editor in mode 6.  Code in DOCK 2-3 (mapping A); its RAM image (the
; two view classes with their thunks, the strings and tables the kernel draws) is assembled for PROG_IMG; its variables follow the image
; and are cleared at start (PAINT 11), not copied.  Symbols take the prefix PN_ (variables, constants) and pn_ (code): PT_ is the pointer's.
; Slice P1a: the window, the tool box, the picture's banded redraw (PAINT 4), the menus and the loop.  P1b: the pencil and the eraser, the
; commit (PAINT 5), Undo (PAINT 6) and Clear.  P1c: New, Open and Save (a PBM, PAINT 9), the discard question (APPLIB 4), as Notepad's.

PN_WINID    EQU 255
PN_PICLEN   EQU 4 + 40 * 144        ; the copy of the picture (PAINT 3): header (16, 40, 32, 144), then the two parts of 20 x 144 bytes
PN_PART     EQU 20 * 144            ; the second part's offset from the first
PN_BANDLEN  EQU 4 + 40 * 8          ; the band buffer (PAINT 4): header + 8 rows of 40 bytes
PN_UNDO_MAX EQU 2048                ; the undo area: cold RAM $5800-$5FFF (PAINT 6)
PN_FILELEN  EQU 11 + 40 * 144       ; a PBM file: the 11-byte header and the rows

; PN_START: the image, the variables, the menus, the picture and the band buffer, the window and its views, then the loop.  Never returns.
PN_START:
    ld hl,PN_IMG
    ld de,PROG_IMG
    ld bc,PN_IMG_LEN
    ldir
    ld hl,PN_VARS                   ; the variables are not in the image: cleared (PAINT 11)
    ld de,PN_VARS + 1
    ld bc,PN_VARS_LEN - 1
    ld (hl),0
    ldir
    call AL_INIT
    ld hl,PN_MENUS
    KFAR MB_SET
    ld bc,PN_PICLEN
    call K_ALLOC                    ; zeroed: a white picture
    ld (PN_PIC),hl
    ld (hl),16                      ; the header (c0, nc, y0, nr) of G_SAVERECT's buffer for (128, 32, 320, 144)
    inc hl
    ld (hl),40
    inc hl
    ld (hl),32
    inc hl
    ld (hl),144
    ld bc,PN_BANDLEN
    call K_ALLOC
    ld (PN_BAND),hl
    ld hl,PN_TWIN                   ; the window and its views (APPLIB 3)
    call AL_NEW
    ld (PN_WIN),ix
    push hl
    ld hl,PN_SUNT
    call pn_nm                      ; "Untitled" and the title
    pop hl
    call AL_VIEW                    ; the tool box
    call AL_VIEW                    ; the canvas
    ld (PN_CV),de
    push hl                         ; (the next table entry)
    push ix
    ld ix,(PN_CV)
    call pn_org
    pop ix
    pop hl
    call AL_VIEW                    ; the status line
    ld (PN_LBL),de
    KFAR W_OPEN
    ld a,1
    KFAR K_MSET
    ld a,1
    ld (PN_TOOL),a                  ; the pencil
    call pn_status
pn_loop:
    call K_GETEV
    jr nc,.ev
    halt
    jr pn_loop
.ev:
    cp E_MENU
    jr z,.menu
    cp E_CMD
    jr z,.cmd
    KFAR TK_DISPATCH
    jr pn_loop
.menu:
    call pn_menu
    jr pn_loop
.cmd:
    ld a,(K_EV+1)
    cp PN_WINID
    ld a,1
    jr z,.ask                       ; the close box or SS+Q: quit
    ld a,(PN_DK)
    or a
    jr nz,.dk
    ld a,(PN_PEND)
    or a
    jr z,pn_loop
    ld b,a
    ld a,(K_EV+1)
    dec a
    jr z,.discard
    dec a
    jr nz,pn_loop
    call pn_dclose                  ; Cancel
    jr pn_loop
.discard:
    push bc
    call pn_dclose
    pop af
    call pn_do
    jr pn_loop
.ask:
    call pn_ask
    jr pn_loop
.dk:
    call pn_dkcmd
    jr pn_loop

; pn_menu: E_MENU (K_EV+1 the menu, K_EV+2 the item): File 1 (New 1, Open 2, Save 3, Quit 4), Edit 2 (Undo 1, Clear 2).
pn_menu:
    ld hl,(K_EV+1)                  ; L = the menu, H = the item
    ld a,l
    dec a
    jr z,.file
    ld a,h
    dec a
    jp z,pn_undo
    dec a
    ret nz
    ld a,4                          ; Clear
    jr pn_ask
.file:
    ld a,h
    cp 3
    jp z,pn_sopen
    cp 4
    jr z,.q
    inc a                           ; New 2, Open 3
    jr pn_ask
.q:
    ld a,1
; pn_ask: A = 1 quit, 2 New, 3 Open, 4 Clear: the discard dialog first when the picture changed (APPLIB 4), else the action.
pn_ask:
    ld b,a
    ld a,(PN_DIRTY)
    or a
    ld a,b
    jr z,pn_do
    ld (PN_PEND),a
    ld hl,PN_DLG
    jp AL_ASK
pn_dclose:
    ld ix,(PN_DLG)
    KFAR W_CLOSE
    xor a
    ld (PN_PEND),a
    ret
; pn_do: A = 1 quit (never returns), 2 New, 3 Open, 4 Clear.
pn_do:
    dec a
    jr nz,.n
    KFAR K_QUIT
.n:
    dec a
    jp z,pn_new
    dec a
    jp z,pn_open
    jp pn_clear

; pn_status: the status line = the chosen tool's name (PN_TNAMES), redrawn.  pn_say: HL -> a length-prefixed message (<= 25 codes).
; Clobbers AF, BC, DE, HL, IX.
pn_status:
    xor a
    ld (PN_MSG),a                   ; the tool's name is shown again
    ld hl,PN_TNAMES
    ld a,(PN_TOOL)
    ld b,a
.f:
    ld a,b
    or a
    jr z,pn_say
    ld a,(hl)
    inc a
    ld e,a
    ld d,0
    add hl,de
    dec b
    jr .f
; pn_msg: pn_say, remembered as a message (pn_status shows the tool's name again).
pn_msg:
    ld a,1
    ld (PN_MSG),a
pn_say:
    ld a,(hl)
    inc a
    ld c,a
    ld b,0
    ld de,PN_STAT
    ldir
    ld ix,(PN_LBL)
    KFAR W_DRAWVIEW
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; The tool box (class Palette, PAINT 2, 7): 2 columns x 5 rows of cells 32 x 16, the cell of tool t at (View_x + 1 + 32 (t AND 1),
; View_y + 1 + 16 (t >> 1)); a cell is the tool's 16 x 16 icon in the middle, a frame 1 pixel outside (neighbours share it), and the chosen
; tool's cell inverted.

; pn_pdraw: Palette's M_DRAW (IX = the view).
pn_pdraw:
    KFAR w_clear
    xor a
    ld (PN_T),a
.cell:
    ld a,(PN_T)
    call pn_cellxy
    ld hl,(PN_CX)                   ; the icon: (x + 8, y, 16, 16), its set 96 bytes a tool
    ld de,8
    add hl,de
    ld (GA),hl
    ld hl,(PN_CY)
    ld (GA+2),hl
    ld hl,16
    ld (GA+4),hl
    ld (GA+6),hl
    ld a,(PN_T)
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
    ld hl,(PN_CX)                   ; the frame (x - 1, y - 1, 33, 17)
    dec hl
    ld (GA),hl
    ld hl,(PN_CY)
    dec hl
    ld (GA+2),hl
    ld hl,33
    ld (GA+4),hl
    ld hl,17
    ld (GA+6),hl
    KFAR G_FRAME
    ld a,(PN_TOOL)
    ld hl,PN_T
    cp (hl)
    jr nz,.next
    ld a,2
    ld (GOP),a                      ; XOR: the cell's inside (x, y, 31, 15)
    ld hl,(PN_CX)
    ld (GA),hl
    ld hl,(PN_CY)
    ld (GA+2),hl
    ld hl,31
    ld (GA+4),hl
    ld hl,15
    ld (GA+6),hl
    KFAR G_FILL
.next:
    ld hl,PN_T
    inc (hl)
    ld a,(hl)
    cp 10
    jp c,.cell
    ret

; pn_cellxy: A = a tool (0-9), IX = the Palette -> PN_CX, PN_CY = its cell's top left.  Clobbers AF, BC, DE, HL.
pn_cellxy:
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
    ld (PN_CX),hl
    ld a,c
    and $FE
    add a,a
    add a,a
    add a,a                         ; 16 x row
    add a,(ix+View_y)
    inc a
    ld l,a
    ld h,0
    ld (PN_CY),hl
    ret

; pn_pevent: Palette's M_EVENT (DE = K_EV; carry = consumed).  A press on a cell chooses that tool.
pn_pevent:
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
    ld hl,PN_TOOL
    cp (hl)
    jr z,.cons
    ld (hl),a
    KFAR W_DRAWVIEW                 ; the box again (IX is still the view)
    push ix
    call pn_status
    pop ix
    scf
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; The canvas (class Canvas, PAINT 2-5): the picture is the 320 x 144 pixels at (128, 32) inside a 2-pixel border.

; pn_cdraw: Canvas' M_DRAW (IX = the view; the clip is the repaint rectangle, the pointer shielded).  The border, then the picture
; restored from its copy by bands of up to 8 rows (PAINT 4): G_RESTRECT ignores the clip, so each band packs only the columns and rows
; of the clip (the repaint rectangles are cells of 16 x 8 pixels: the first column and the column count are even).
pn_cdraw:
    call pn_org
    xor a
    ld (GOP),a
    ld hl,(PN_OX)                   ; the border: the view's rectangle and the one inside it (the picture is 2 pixels in)
    dec hl
    dec hl
    ld (GA),hl
    ld a,(PN_OY)
    sub 2
    ld l,a
    ld h,0
    ld (GA+2),hl
    ld hl,324
    ld (GA+4),hl
    ld hl,148
    ld (GA+6),hl
    KFAR G_FRAME
    ld hl,(PN_OX)
    dec hl
    ld (GA),hl
    ld a,(PN_OY)
    dec a
    ld l,a
    ld h,0
    ld (GA+2),hl
    ld hl,322
    ld (GA+4),hl
    ld hl,146
    ld (GA+6),hl
    KFAR G_FRAME
    ld hl,(GCX0)                    ; the clip in the picture's pixels: columns k0 .. k1 (byte columns, k0 even, k1 even)
    ld de,(PN_OX)
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
    ld (PN_K0),a
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
    ld hl,PN_K0
    sub (hl)
    ret z
    ret c
    ld (PN_NC),a
    srl a
    ld (PN_H),a                     ; bytes a row in each part
    ld b,a
    ld a,20
    sub b
    ld (PN_ADJ),a                   ; the step to the next row of a part: 20 - H
    ld a,(hl)
    srl a
    ld (PN_O),a                     ; the offset of k0 in a part's row
    ld a,(PN_OY)
    ld e,a
    ld d,0
    ld hl,(GCY0)                    ; the rows: r0 .. r1 (picture rows)
    or a
    sbc hl,de
    jr nc,.y0
    ld hl,0
.y0:
    ld a,l
    ld (PN_R),a
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
    ld (PN_RE),a
; pn_bands: the picture rows PN_R .. PN_RE (columns PN_K0, PN_NC; PN_H, PN_ADJ, PN_O set) restored from the copy by bands.  Clobbers AF, BC, DE, HL.
pn_bands:
.band:
    ld a,(PN_RE)
    ld hl,PN_R
    sub (hl)
    ret z
    ret c
    cp 9
    jr c,.n
    ld a,8
.n:
    ld (PN_NR),a
    ld a,(PN_OXC)                   ; the header: c0, nc, y0, nr
    ld hl,PN_K0
    add a,(hl)
    ld hl,(PN_BAND)
    ld (hl),a
    inc hl
    ld a,(PN_NC)
    ld (hl),a
    inc hl
    ld a,(PN_OY)
    ld de,PN_R
    ex de,hl
    add a,(hl)
    ex de,hl
    ld (hl),a
    inc hl
    ld a,(PN_NR)
    ld (hl),a
    inc hl
    ex de,hl                        ; DE = the band's first region (the odd columns: G_SAVERECT's layout for an even first column)
    call pn_src
    call pn_rows
    call pn_src
    ld bc,PN_PART
    add hl,bc
    call pn_rows                    ; the second region (the even columns)
    ld hl,(PN_BAND)
    KFAR G_RESTRECT
    ld a,(PN_NR)
    ld hl,PN_R
    add a,(hl)
    ld (hl),a
    jr .band

; pn_src: HL = the first part's byte for row PN_R, column offset PN_O.  Keeps DE.  Clobbers AF, BC.
pn_src:
    push de
    ld a,(PN_R)
    ld l,a
    ld h,0
    add hl,hl
    add hl,hl                       ; 4 R
    ld d,h
    ld e,l
    add hl,hl
    add hl,hl                       ; 16 R
    add hl,de                       ; 20 R
    ld de,(PN_PIC)
    add hl,de
    ld a,(PN_O)
    ld e,a
    ld d,0
    add hl,de
    ld de,4
    add hl,de
    pop de
    ret

; pn_rows: PN_NR rows of PN_H bytes from HL (rows 20 bytes apart) to DE (packed).  Clobbers AF, BC.
pn_rows:
    ld a,(PN_NR)
    ld b,a
.r:
    push bc
    ld a,(PN_H)
    ld c,a
    ld b,0
    ldir
    ld a,(PN_ADJ)
    ld c,a
    ld b,0
    add hl,bc
    pop bc
    djnz .r
    ret

; pn_cevent: Canvas' M_EVENT (DE = K_EV; carry = consumed).  A press inside the picture starts a stroke with the pencil or the eraser and
; takes the capture; a move while drawing adds a segment; the release commits (PAINT 5).
pn_cevent:
    call pn_org
    ex de,hl
    ld b,(hl)                       ; the type
    inc hl
    ld c,(hl)                       ; x low
    inc hl
    ld d,(hl)                       ; y
    inc hl
    ld a,(hl)
    and 1
    ld h,a
    ld l,c
    ld (PN_NX),hl                   ; the pointer
    ld a,d
    ld (PN_NY),a
    ld a,b
    cp E_DOWN
    jr z,.dn
    cp E_MOVE
    jr z,.mv
    cp E_UP
    jr nz,.no
    ld a,(PN_DRAW)
    or a
    jr z,.cons
    xor a
    ld (PN_DRAW),a
    call pn_commit
.cons:
    scf
    ret
.no:
    or a
    ret
.mv:
    ld a,(PN_DRAW)
    or a
    jr z,.no
    call pn_seg
    scf
    ret
.dn:
    ld de,(PN_OX)                   ; inside the picture: 0 <= x - OX < 320, 0 <= y - OY < 144
    or a
    sbc hl,de
    jr c,.no
    ld a,h
    or a
    jr z,.xin
    dec a
    jr nz,.no
    ld a,l
    cp 64
    jr nc,.no
.xin:
    ld a,(PN_NY)
    ld hl,PN_OY
    sub (hl)
    jr c,.no
    cp 144
    jr nc,.no
    ld a,(PN_TOOL)
    cp 1
    jr z,.go
    cp 3
    jr z,.go
    ld hl,PN_MNYET                  ; the other tools are not built yet
    push ix
    call pn_msg
    pop ix
    jr .no
.go:
    ld a,1
    ld (PN_DRAW),a
    ld hl,(PN_NX)                   ; the first point is both ends of the first segment
    ld (PN_LX),hl
    ld a,(PN_NY)
    ld (PN_LY),a
    ld a,$FF                        ; the stroke's box (PN_BC0, PN_BC1, PN_BR0, PN_BR1): empty
    ld (PN_BC0),a
    ld (PN_BR0),a
    xor a
    ld (PN_BC1),a
    ld (PN_BR1),a
    call pn_seg
    scf
    ret

; pn_org: IX = the Canvas: the picture's origin = the view's (x + 2, y + 2): PN_OX, PN_OY, PN_OXC (its byte column).  The window may have
; been dragged (by whole cells: the origin keeps an even byte column).  Clobbers AF, HL.
pn_org:
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    inc hl
    inc hl
    ld (PN_OX),hl
    srl h
    rr l
    srl h
    rr l
    srl h
    rr l
    ld a,l
    ld (PN_OXC),a
    ld a,(ix+View_y)
    add a,2
    ld (PN_OY),a
    ret

; pn_shield: the pointer shielded from the picture, the clip the picture; pn_unshield: the clip the whole screen, the shield off.  GA is
; left as the picture's rectangle after pn_shield (P_SHIELD keeps it).  Clobber AF, BC, DE, HL.
pn_shield:
    ld hl,(PN_OX)
    ld (GA),hl
    ld (GCX0),hl
    ld de,320
    add hl,de
    ld (GCX1),hl
    ld a,(PN_OY)
    ld l,a
    ld h,0
    ld (GA+2),hl
    ld (GCY0),hl
    ld de,144
    add hl,de
    ld (GCY1),hl
    ld hl,320
    ld (GA+4),hl
    ld hl,144
    ld (GA+6),hl
    KFAR P_SHIELD
    ret
pn_unshield:
    ld hl,0
    ld (GCX0),hl
    ld (GCY0),hl
    ld hl,512
    ld (GCX1),hl
    ld hl,192
    ld (GCY1),hl
    KFAR P_UNSHIELD
    ret

; pn_seg: one step of the stroke: the segment from (PN_LX, PN_LY) to the pointer (PN_NX, PN_NY): the pencil's G_LINE, or the eraser's
; stamps along it (pn_walk); the stroke's box grows; the pointer becomes the last point.
pn_seg:
    call pn_shield
    ld a,(PN_TOOL)
    cp 3
    jr z,.er
    xor a
    ld (GOP),a                      ; SET
    ld hl,(PN_LX)
    ld (GA),hl
    ld a,(PN_LY)
    ld l,a
    ld h,0
    ld (GA+2),hl
    ld hl,(PN_NX)
    ld (GA+4),hl
    ld a,(PN_NY)
    ld l,a
    ld h,0
    ld (GA+6),hl
    KFAR G_LINE
    ld hl,(PN_LX)
    ld a,(PN_LY)
    call pn_grow
    ld hl,(PN_NX)
    ld a,(PN_NY)
    call pn_grow
    jr .done
.er:
    ld a,1
    ld (GOP),a                      ; CLR
    call pn_walk
.done:
    call pn_unshield
    ld hl,(PN_NX)
    ld (PN_LX),hl
    ld a,(PN_NY)
    ld (PN_LY),a
    ret

; pn_walk: the eraser's stamps along (PN_LX, PN_LY) to (PN_NX, PN_NY): a Bresenham walk of the major axis, a stamp every fourth step
; and at the end (a single stamp when the two points are one).  Clobbers AF, BC, DE, HL.
pn_walk:
    ld hl,(PN_LX)
    ld de,(PN_NX)
    or a
    sbc hl,de                       ; LX - NX
    ld a,1                          ; the x step: 1 down (toward NX)
    jr nc,.xs
    xor a
    sub l
    ld l,a
    sbc a,a
    sub h
    ld h,a                          ; -HL
    xor a                           ; 0 up
.xs:
    ld (PN_WSX),a
    ld (PN_WDX),hl
    ld a,(PN_LY)
    ld hl,PN_NY
    sub (hl)
    ld c,1
    jr nc,.ys
    neg
    ld c,0
.ys:
    ld l,a
    ld h,0
    ld a,c
    ld (PN_WSY),a
    ld (PN_WDY),hl
    ld de,(PN_WDX)
    or a
    sbc hl,de                       ; dy - dx: carry when dx is the larger (x major)
    ld hl,(PN_WDX)
    ld a,0
    jr c,.mj
    ld hl,(PN_WDY)
    inc a
.mj:
    ld (PN_WMAJ),a
    ld (PN_WN),hl                   ; the steps
    ld hl,(PN_LX)
    ld (PN_WX),hl
    ld a,(PN_LY)
    ld (PN_WY),a
    ld hl,0
    ld (PN_WACC),hl
    xor a
    ld (PN_WC),a                    ; the steps counted from 0: a stamp after the 4th, 8th, ...
    ld hl,(PN_WN)
    ld a,h
    or l
    jr z,.last
.step:
    ld a,(PN_WMAJ)
    or a
    jr nz,.ym
    call pn_wx                      ; x major: x steps, the error takes dy, y steps when it passes dx
    ld hl,(PN_WDY)
    ld de,(PN_WDX)
    call pn_wacc
    call c,pn_wy
    jr .st
.ym:
    call pn_wy
    ld hl,(PN_WDX)
    ld de,(PN_WDY)
    call pn_wacc
    call c,pn_wx
.st:
    ld hl,PN_WC
    inc (hl)
    ld a,(hl)
    and 3
    call z,pn_stamp
    ld hl,(PN_WN)
    dec hl
    ld (PN_WN),hl
    ld a,h
    or l
    jr nz,.step
.last:
    jp pn_stamp
; pn_wx / pn_wy: the walk's x / y one step in its direction.  pn_wacc: HL = the increment, DE = the limit: the error += HL, carry set
; (and the error - DE kept) when it reaches DE.
pn_wx:
    ld hl,(PN_WX)
    ld a,(PN_WSX)
    or a
    jr nz,.d
    inc hl
    jr .s
.d:
    dec hl
.s:
    ld (PN_WX),hl
    ret
pn_wy:
    ld a,(PN_WY)
    ld hl,PN_WSY
    bit 0,(hl)
    jr nz,.d
    inc a
    jr .s
.d:
    dec a
.s:
    ld (PN_WY),a
    ret
pn_wacc:
    push de
    ld de,(PN_WACC)
    add hl,de
    pop de
    or a
    sbc hl,de
    jr nc,.hit
    add hl,de
    ld (PN_WACC),hl
    or a
    ret
.hit:
    ld (PN_WACC),hl
    scf
    ret

; pn_stamp: the eraser's stamp at the walk's point (PN_WX, PN_WY): paper over (x - 8, y - 4, 16, 8) (a square on mode 6's 1 : 2 pixels).
pn_stamp:
    ld hl,(PN_WX)
    ld de,8
    or a
    sbc hl,de
    ld (GA),hl
    ld a,(PN_WY)
    ld l,a
    ld h,0
    ld de,4
    or a
    sbc hl,de
    ld (GA+2),hl
    ld hl,16
    ld (GA+4),hl
    ld hl,8
    ld (GA+6),hl
    KFAR G_FILL
    ld hl,(PN_WX)
    ld a,(PN_WY)
; pn_grow: HL = a screen x, A = a screen y: the stroke's box takes the point's byte column +- 1 and row +- 4, clamped to the picture.
pn_grow:
    ld c,a
    ld de,(PN_OX)
    or a
    sbc hl,de                       ; the picture's x (negative: 0)
    bit 7,h
    jr z,.p
    ld hl,0
.p:
    ld b,3
.s:
    srl h
    rr l
    djnz .s
    ld a,l
    cp 40
    jr c,.c
    ld a,39
.c:
    ld b,a                          ; the byte column
    sub 1
    jr nc,.l
    xor a
.l:
    ld hl,PN_BC0
    cp (hl)
    jr nc,.l2
    ld (hl),a
.l2:
    ld a,b
    inc a
    cp 40
    jr c,.h
    ld a,39
.h:
    ld hl,PN_BC1
    cp (hl)
    jr c,.h2
    ld (hl),a
.h2:
    ld a,c
    ld hl,PN_OY
    sub (hl)
    jr nc,.r
    xor a
.r:
    cp 144
    jr c,.r2
    ld a,143
.r2:
    ld b,a                          ; the row
    sub 4
    jr nc,.rl
    xor a
.rl:
    ld hl,PN_BR0
    cp (hl)
    jr nc,.rl2
    ld (hl),a
.rl2:
    ld a,b
    add a,4
    cp 144
    jr c,.rh
    ld a,143
.rh:
    ld hl,PN_BR1
    cp (hl)
    ret c
    ld (hl),a
    ret

; pn_commit (PAINT 5), at the release: the stroke's box widened to byte pairs; when it fits the undo area (PN_UNDO_MAX bytes) the box's
; rows are saved from the copy (which still holds the state before the stroke) to cold RAM and Undo is enabled, else Undo is disabled and
; the status says so; then the whole picture is saved into the copy; the picture is changed.
pn_commit:
    ld a,(PN_BC0)
    and $FE
    ld (PN_UB0),a
    ld b,a
    ld a,(PN_BC1)
    or 1
    sub b
    inc a
    ld (PN_UBN),a                   ; nc (even)
    ld a,(PN_BR0)
    ld (PN_UR0),a
    ld b,a
    ld a,(PN_BR1)
    sub b
    inc a
    ld (PN_URN),a                   ; nr
    ld c,a                          ; nc x nr <= 2,048 (a row of the box is nc bytes in both parts)
    ld a,(PN_UBN)
    ld e,a
    ld d,0
    ld hl,0
    ld b,c
.m:
    add hl,de
    djnz .m
    ld de,PN_UNDO_MAX
    or a
    sbc hl,de
    jr c,.fits
    jr z,.fits
    ld hl,PN_MBIG
    push ix
    call pn_msg
    pop ix
    call pn_nound
    jr .save
.fits:
    ld a,(PN_MSG)                   ; a message is shown: the tool's name again
    or a
    call nz,pn_status
    xor a                           ; the box from the copy to $5800
    call pn_box
    ld a,1
    ld (PN_UNDO),a
    ld bc,$0100                     ; enable Edit's Undo (menu 1, item 0)
    ld a,1
    call MB_ENABLE
.save:
    ld a,1
    ld (PN_DIRTY),a
; pn_savepic: the whole picture from the screen into the copy.  Clobbers AF, BC, DE, HL.
pn_savepic:
    call pn_shield
    ld hl,(PN_PIC)
    ld (GA+8),hl
    KFAR G_SAVERECT
    jp pn_unshield

; pn_nound: no undo: the flag cleared, Edit's Undo disabled.  Clobbers AF, BC, HL.
pn_nound:
    xor a
    ld (PN_UNDO),a
    ld bc,$0000
    ld a,1
    jp MB_ENABLE

; pn_box: A = 0 save, 2 swap: the undo box (PN_UB0, PN_UBN, PN_UR0, PN_URN) between the copy and cold RAM $5800, both parts, by K_BOX.
; Clobbers AF, BC, DE, HL, IX.
pn_box:
    ld (PN_BOXM),a
    ld a,(PN_UBN)
    srl a
    ld (PN_H),a                     ; H: bytes a row of each part
    ld a,(PN_UB0)
    srl a
    ld (PN_O),a
    ld a,(PN_UR0)
    ld (PN_R),a
    ld hl,0
    ld (PN_BOXD),hl
    ld de,$5800
    call .part
    ld hl,PN_PART
    ld (PN_BOXD),hl
.part:
    call pn_src                     ; HL = the first part's byte at (PN_R, PN_O); DE (the cold RAM) is kept
    ld bc,(PN_BOXD)
    add hl,bc
    ld a,(PN_URN)
    ld b,a
    ld a,(PN_H)
    ld c,a
    ld a,20
    sub c
    push ix
    ld ixh,a                        ; the step from a row's end to the next: 20 - H
    ld a,(PN_BOXM)
    KFAR K_BOX
    pop ix
    ret

; pn_undo (Edit's Undo): the box is swapped with the copy (the box then holds what was undone: Undo again redoes it) and the rows redrawn
; from the copy.
pn_undo:
    ld a,(PN_UNDO)
    or a
    ret z
    ld a,2
    call pn_box
    ld a,(PN_UB0)
    ld (PN_K0),a
    ld a,(PN_UBN)
    ld (PN_NC),a
    srl a
    ld (PN_H),a
    ld b,a
    ld a,20
    sub b
    ld (PN_ADJ),a
    ld a,(PN_UB0)
    srl a
    ld (PN_O),a
    ld a,(PN_UR0)
    ld (PN_R),a
    ld hl,PN_URN
    add a,(hl)
    ld (PN_RE),a
    call pn_shield
    call pn_bands
    call pn_unshield
    ld a,1
    ld (PN_DIRTY),a
    ret

; pn_clear (Edit's Clear): the picture to paper and into the copy; too big to undo.
pn_clear:
    call pn_shield
    ld a,1
    ld (GOP),a
    KFAR G_FILL                     ; GA is the picture's rectangle
    call pn_unshield
    call pn_nound
    ld a,1
    ld (PN_DIRTY),a
    jp pn_savepic

; ---------------------------------------------------------------------------------------------------------------------------
; P1c: New, Open and Save (PAINT 8, 9), as Notepad's (WRITE 13).

; pn_new: a new picture named "Untitled": paper, unchanged.
pn_new:
    call pn_clear
    xor a
    ld (PN_DIRTY),a
    ld hl,PN_SUNT
; pn_setname: HL -> a name (a length byte, 1-30 codes): the picture's name and the title "Paint: name" (AL_TITLE), the title row made
; dirty.  pn_nm: the name and the title only.  IX kept.
pn_setname:
    scf
    jr pn_nm1
pn_nm:
    or a
pn_nm1:
    ld de,PN_NAME
    ld bc,31
    ldir
    push ix
    ld ix,(PN_WIN)
    ld hl,PN_STW
    ld de,PN_NAME
    ld bc,PN_TITLE
    call AL_TITLE
    pop ix
    ret

; pn_alert: HL = a message (in the image): the alert (the library's), made once, opened.
pn_alert:
    ex de,hl
    ld hl,PN_ADLG
    call AL_ALERT
    ld a,2
    ld (PN_DK),a
    ret

; pn_sopen: "Save...": the name dialog (APPLIB 5) with the picture's name in its Field.
pn_sopen:
    ld de,PN_PSAV
    ld a,1
    ld (PN_DK),a
    ld hl,PN_SDLG
    jp AL_NAMEDLG

; pn_dkcmd: A = the dialog open (1 Save, 2 the alert): its E_CMD (K_EV + 1 = the id).  The dialog closes; id 1 of Save saves.
pn_dkcmd:
    ld c,a
    xor a
    ld (PN_DK),a
    ld ix,(PN_ADLG)
    bit 0,c
    jr z,.cl
    ld ix,(PN_SDLG)
.cl:
    push bc
    KFAR W_CLOSE
    pop bc
    ld a,(K_EV+1)
    dec a
    ret nz                          ; Cancel
    dec c
    ret nz                          ; the alert's OK
; pn_save: the name in PN_FBUF: ".pbm" added; the header and the 144 rows written in binary (PAINT 9); the picture is saved under the name.
pn_save:
    ld hl,PN_FBUF
    ld a,(hl)
    or a
    ret z                           ; an empty name: nothing saved
    ld de,PN_SEXT
    call AL_EXTNAME
    ld hl,PN_FBUF
    ld a,3                          ; write, binary
    call FS_OPEN
    jr c,.fail
    ld hl,PN_HDR
    ld bc,11
    call FS_WRITE
    jr c,.fail
    xor a
    ld (PN_O),a
    ld (PN_R),a
.row:
    call pn_src                     ; HL = the row's part-1 start
    ld de,(PN_BAND)
    call pn_rowget
    ld hl,(PN_BAND)
    ld bc,40
    call FS_WRITE
    jr c,.fail
    ld hl,PN_R
    inc (hl)
    ld a,(hl)
    cp 144
    jr nz,.row
    call FS_CLOSE
    jr c,.fail
    xor a
    ld (PN_DIRTY),a
    ld hl,PN_FBUF
    jp pn_setname
.fail:
    ld hl,PN_MSAVE
    jp pn_alert

; pn_open: "Open..." once the discard dialog (if any) is passed: a file picked and checked (11 bytes of header "P4", 320 144, and
; 144 rows of 40), read into the copy row by row, the picture redrawn from it.
pn_open:
    KFAR W_UPDATE                   ; the menu or the dialog just closed is repainted before the wait
    ld hl,PN_PNAME
    call FS_PICK
    jr nc,.picked
    cp FS_CANCEL
    ret z
    jr .cant
.picked:
    ld hl,PN_PNAME
    ld a,2                          ; read, binary
    call FS_OPEN
    jr c,.cant
    ld hl,PN_FILELEN
    or a
    sbc hl,bc
    jr nz,.bad
    ld de,(PN_BAND)
    ld bc,11
    call FS_READ
    jr c,.rfail
    ld hl,(PN_BAND)
    ld de,PN_HDR
    ld b,11
.h:
    ld a,(de)
    cp (hl)
    jr nz,.bad
    inc hl
    inc de
    djnz .h
    xor a
    ld (PN_O),a
    ld (PN_R),a
.row:
    ld de,(PN_BAND)
    ld bc,40
    call FS_READ
    jr c,.rfail
    call pn_src
    ld de,(PN_BAND)
    call pn_rowput
    ld hl,PN_R
    inc (hl)
    ld a,(hl)
    cp 144
    jr nz,.row
    call FS_CLOSE
    call pn_redraw
    xor a
    ld (PN_DIRTY),a
    call pn_nound
    ld hl,PN_PNAME
    jp pn_setname
.bad:
    call FS_CLOSE
    ld hl,PN_MBAD
    jp pn_alert
.rfail:
    call FS_CLOSE
    call pn_redraw                  ; (the rows read so far replaced the copy's)
    ld hl,PN_MREAD
    jp pn_alert
.cant:
    ld hl,PN_MREAD
    jp pn_alert

; pn_redraw: the whole picture from the copy.  Clobbers AF, BC, DE, HL.
pn_redraw:
    xor a
    ld (PN_K0),a
    ld (PN_ADJ),a
    ld (PN_O),a
    ld (PN_R),a
    ld a,40
    ld (PN_NC),a
    ld a,20
    ld (PN_H),a
    ld a,144
    ld (PN_RE),a
    call pn_shield
    call pn_bands
    jp pn_unshield

; pn_rowget: HL = a row's part-1 start in the copy, DE -> a buffer: the row's 40 bytes made (the even columns are in part 2, the odd in
; part 1).  pn_rowput: the reverse.  Clobber AF, BC, DE, HL.
pn_rowget:
    push hl
    push de
    ld bc,PN_PART
    add hl,bc
    ld b,20
.e:
    ld a,(hl)
    ld (de),a
    inc hl
    inc de
    inc de
    djnz .e
    pop de
    inc de
    pop hl
    ld b,20
.o:
    ld a,(hl)
    ld (de),a
    inc hl
    inc de
    inc de
    djnz .o
    ret
pn_rowput:
    push hl
    ld bc,PN_PART
    add hl,bc
    push de
    ld b,20
.e:
    ld a,(de)
    ld (hl),a
    inc hl
    inc de
    inc de
    djnz .e
    pop de
    inc de
    pop hl
    ld b,20
.o:
    ld a,(de)
    ld (hl),a
    inc hl
    inc de
    inc de
    djnz .o
    ret
PN_HDR:     DB "P4", 10, "320 144", 10  ; the PBM header (11 bytes)

; ---------------------------------------------------------------------------------------------------------------------------
; The window and its views (PAINT 2): APPLIB 3 entries.  The tool box (55, 28, 66, 82), the canvas (126, 30, 324, 148), the status line.
PN_TWIN:
    DW CL_CWindow, 48
    DB 16
    DW 416
    DB 176, 0, PN_WINID, 8
    DW PN_TITLE
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
    DW PN_STAT

; ---------------------------------------------------------------------------------------------------------------------------
; The RAM image (to PROG_IMG).
PN_IMG:
    DISP PROG_IMG
    DW CL_View
    DB 207, 6, View_SIZE, 8
CL_Canvas:                          ; Canvas: a View whose Draw and Event are banked
    DW view_destroy, PN_CTD, PN_CTE, view_hittest, k_nop, k_nop
PN_CTD:     KTHUNK pn_cdraw
PN_CTE:     KTHUNK pn_cevent
    DW CL_View
    DB 208, 6, View_SIZE, 8
CL_Palette:                         ; Palette: the same, for the tool box (and later the patterns and brushes)
    DW view_destroy, PN_PTD, PN_PTE, view_hittest, k_nop, k_nop
PN_PTD:     KTHUNK pn_pdraw
PN_PTE:     KTHUNK pn_pevent
PN_SUNT:    DB 8, "Untitled"
PN_STW:     DB 7, "Paint: "
PN_SEXT:    DB ".pbm"
PN_SSVAS:   DB 8, "Save as:"
PN_SSAVE:   DB 4, "Save"
PN_PSAV:    DW PN_SSVAS, PN_FBUF, PN_SSAVE, PN_NAME
PN_MSAVE:   DB 24, "Cannot save the picture."
PN_MREAD:   DB 21, "Cannot read the file."
PN_MBAD:    DB 28, "Not a 320 x 144 PBM picture."
PN_TNAMES:                          ; the tools' names, in the order of the tool box (PAINT 7)
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
PN_MNYET:   DB 13, "Not built yet"
PN_MBIG:    DB 15, "Too big to undo"
PN_STAT:    DB 6, "Pencil"
            DS 26 - 6
PN_MENUS:
    DB 2
    DW PN_M1, PN_M2
PN_M1:
    DB 1, 4, "File", 5
    DB 1, 0, 3, "New"
    DB 2, 0, 7, "Open..."
    DB 3, 0, 7, "Save..."
    DB 0, 2, 0
    DB 4, 0, 4, "Quit"
PN_M2:
    DB 2, 4, "Edit", 2
    DB 1, 1, 4, "Undo"              ; disabled until there is something to undo
    DB 2, 0, 5, "Clear"
    ENT
PN_IMG_LEN  EQU $ - PN_IMG

; The variables (cleared at start; not in the image).
PN_VARS     EQU PROG_IMG + PN_IMG_LEN
PN_WIN      EQU PN_VARS             ; the window, the canvas, the status line
PN_CV       EQU PN_WIN + 2
PN_LBL      EQU PN_CV + 2
PN_PIC      EQU PN_LBL + 2          ; the picture's copy and the band buffer (arena)
PN_BAND     EQU PN_PIC + 2
PN_TOOL     EQU PN_BAND + 2         ; the chosen tool
PN_T        EQU PN_TOOL + 1         ; the tool being drawn
PN_CX       EQU PN_T + 1            ; its cell's top left
PN_CY       EQU PN_CX + 2
PN_K0       EQU PN_CY + 2           ; the band restore: first byte column (of the picture), count, bytes a row of each part, row step, offset
PN_NC       EQU PN_K0 + 1
PN_H        EQU PN_NC + 1
PN_ADJ      EQU PN_H + 1
PN_O        EQU PN_ADJ + 1
PN_R        EQU PN_O + 1            ; the band's first row, the clip's last row, the band's rows
PN_RE       EQU PN_R + 1
PN_NR       EQU PN_RE + 1
PN_DRAW     EQU PN_NR + 1           ; 1 while a stroke is drawn
PN_NX       EQU PN_DRAW + 1         ; the pointer (screen x, y) and the stroke's last point
PN_NY       EQU PN_NX + 2
PN_LX       EQU PN_NY + 1
PN_LY       EQU PN_LX + 2
PN_WX       EQU PN_LY + 1           ; the eraser's walk: the point, |dx|, |dy|, the signs (1 = down), the major axis (1 = y), the error, the steps, a counter
PN_WY       EQU PN_WX + 2
PN_WDX      EQU PN_WY + 1
PN_WDY      EQU PN_WDX + 2
PN_WSX      EQU PN_WDY + 2
PN_WSY      EQU PN_WSX + 1
PN_WMAJ     EQU PN_WSY + 1
PN_WACC     EQU PN_WMAJ + 1
PN_WN       EQU PN_WACC + 2
PN_WC       EQU PN_WN + 2
PN_BC0      EQU PN_WC + 1           ; the stroke's box: byte columns and rows of the picture
PN_BC1      EQU PN_BC0 + 1
PN_BR0      EQU PN_BC1 + 1
PN_BR1      EQU PN_BR0 + 1
PN_UNDO     EQU PN_BR1 + 1          ; 1 when the undo area holds a box
PN_UB0      EQU PN_UNDO + 1         ; the box: first byte column (even), columns (even), first row, rows
PN_UBN      EQU PN_UB0 + 1
PN_UR0      EQU PN_UBN + 1
PN_URN      EQU PN_UR0 + 1
PN_DIRTY    EQU PN_URN + 1          ; 1 when the picture changed since it was new or saved
PN_BOXM     EQU PN_DIRTY + 1        ; pn_box: the mode, the second part's offset
PN_BOXD     EQU PN_BOXM + 1
PN_DLG      EQU PN_BOXD + 2         ; the discard dialog, the Save dialog, the alert (made on first use, APPLIB)
PN_SDLG     EQU PN_DLG + 2
PN_ADLG     EQU PN_SDLG + 2
PN_PEND     EQU PN_ADLG + 2         ; 1 quit, 2 New, 3 Open, 4 Clear: waiting for the discard dialog
PN_DK       EQU PN_PEND + 1         ; the dialog open: 1 Save, 2 the alert
PN_TITLE    EQU PN_DK + 1           ; "Paint: " and the name: a length byte and up to 39 codes
PN_NAME     EQU PN_TITLE + 40       ; the picture's name: a length byte and up to 30 codes
PN_FBUF     EQU PN_NAME + 31        ; the Save dialog's Field
PN_PNAME    EQU PN_FBUF + 31        ; the picked name (FS_PICK)
PN_OX       EQU PN_PNAME + 32       ; the picture's origin (screen x, y) and its byte column
PN_OY       EQU PN_OX + 2
PN_OXC      EQU PN_OY + 1
PN_MSG      EQU PN_OXC + 1          ; 1 when the status line shows a message, not the tool's name
PN_VARS_END EQU PN_MSG + 1
PN_VARS_LEN EQU PN_VARS_END - PN_VARS
    ASSERT PN_VARS_END <= AL_RAM && PN_IMG_LEN <= 1024
    ASSERT (CL_Canvas >> 8) == ((CL_Canvas + 11) >> 8) && (CL_Palette >> 8) == ((CL_Palette + 11) >> 8)
    ASSERT (PN_STAT >> 8) == ((PN_STAT + 26) >> 8)
PN_END:
