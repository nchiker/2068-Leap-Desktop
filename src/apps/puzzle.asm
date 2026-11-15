; puzzle.asm -- program 5, the 15-tile Puzzle (docs/PUZZLE.md): the first K-RESIDENT program (docs/SPACE_PLAN.md).  Its code and tables are in the pool, so it starts and runs under
; mapping K: it calls G_*, W_*, K_* and the toolkit directly; the app library (AL_*, DOCK 2-3) is reached by KFAR.  Its class, strings and tables stay in the pool (K reads them there);
; its variables are the first bytes of PROG_IMG ($C000), cleared at the start.  Assembled by desk5.asm in chunk 1, after the toolkit.
;
; The board is 16 cells of 64 x 32 pixels (256 x 128: square on the 1 : 2 pixels) drawn from the board view's origin (the window may be dragged): PZ_B holds the tile in each cell (0 = the gap).  A press on a tile in the
; gap's row or column slides the run between it and the gap; the arrow keys slide the neighbour from that side (Left: the tile on the gap's right moves left, and so on); N and the
; "New game" button deal again (120 random legal moves from the solved board: always solvable).  Solved: the win sound and "Solved: n".  SS+Q or the close box quits.

PZ_WINID    EQU 255
PZ_B        EQU PROG_IMG            ; 16 bytes: the tile in each cell (0 the gap)
PZ_G        EQU PZ_B + 16           ; byte: the gap's cell
PZ_WON      EQU PZ_G + 1            ; byte: 1 when solved
PZ_MV       EQU PZ_WON + 1          ; word: the moves
PZ_WIN      EQU PZ_MV + 2           ; word: the window
PZ_BV       EQU PZ_WIN + 2          ; word: the board view
PZ_LV       EQU PZ_BV + 2           ; word: the label view
PZ_RND      EQU PZ_LV + 2           ; word: the LFSR
PZ_I        EQU PZ_RND + 2          ; byte: the cell being drawn
PZ_N        EQU PZ_I + 1            ; byte: the digits of a tile's number
PZ_C        EQU PZ_N + 1            ; byte: a slide's current cell
PZ_T        EQU PZ_C + 1            ; byte: its target cell
PZ_S        EQU PZ_T + 1            ; byte: its step (+1, -1, +4, -4)
PZ_TXT      EQU PZ_S + 1            ; 3 bytes: a tile's number
PZ_LBL      EQU PZ_TXT + 3          ; 14 bytes: the label's text, a length byte then "Moves: n"
PZ_VEND     EQU PZ_LBL + 14

PZ_START:
    ld de,PROG_IMG
    ld hl,PZ_VEND
    call k_zero
    ld hl,(V_FRAMES)                ; the LFSR's seed (never 0)
    set 0,l
    ld (PZ_RND),hl
    ld hl,PZ_TWIN
    KFAR AL_NEW                     ; the window
    ld (PZ_WIN),ix
    KFAR AL_VIEW                    ; the board
    ld (PZ_BV),de
    KFAR AL_VIEW                    ; the moves
    ld (PZ_LV),de
    KFAR AL_VIEW                    ; the New game button
    call pz_deal
    ld ix,(PZ_WIN)
    call W_OPEN
    ld a,1
    call K_MSET
pz_loop:
    call K_GETEV
    jr nc,.ev
    halt
    jr pz_loop
.ev:
    cp E_CMD
    jr z,.cmd
    cp E_KEY
    call z,pz_key
    call TK_DISPATCH
    jr pz_loop
.cmd:
    ld a,(K_EV+1)
    cp PZ_WINID
    jp z,K_QUIT                     ; the close box or SS+Q
    cp 2
    call z,pz_new                   ; the New game button
    jr pz_loop

; pz_key: E_KEY: the arrows slide the neighbour into the gap, N deals again.  Clobbers AF, BC, DE, HL.
pz_key:
    ld a,(K_EV+1)
    ld hl,PZ_G
    ld b,(hl)                       ; B = the gap
    cp 'n'
    jr z,pz_new
    cp 'N'
    jr z,pz_new
    cp 8                            ; Left: the tile on the gap's right slides left
    jr z,.left
    cp 9
    jr z,.right
    cp 10                           ; Down: the tile above the gap slides down
    jr z,.down
    cp 11
    ret nz
    ld a,b                          ; Up: the tile below the gap
    add a,4
    cp 16
    ret nc
    jr .go
.down:
    ld a,b
    sub 4
    ret c
    jr .go
.left:
    ld a,b
    and 3
    cp 3
    ret z
    ld a,b
    inc a
    jr .go
.right:
    ld a,b
    and 3
    ret z
    ld a,b
    dec a
.go:
    ld b,a
    jp pz_move

; pz_new: a new game: dealt, the board and the label redrawn.
pz_new:
    call pz_deal
    ld ix,(PZ_BV)
    call W_INVALV
    call W_UPDATE
    ret

; pz_deal: the solved board, then 200 random tries at a legal move (about 120 succeed; no drawing); the moves 0; the label.  Clobbers AF, BC, DE, HL.
pz_deal:
    ld hl,PZ_B
    ld b,15
    ld a,1
.s:
    ld (hl),a
    inc hl
    inc a
    djnz .s
    ld (hl),0
    ld a,15
    ld (PZ_G),a
    xor a
    ld (PZ_WON),a
    ld h,a
    ld l,a
    ld (PZ_MV),hl
    ld a,200
    ld (PZ_T),a
.r:
    call pz_rnd
    and 3
    ld d,a                          ; the direction
    ld a,(PZ_G)
    ld e,a                          ; the gap
    and 3
    ld b,a                          ; its column
    ld a,d
    or a
    jr nz,.d1
    ld a,b                          ; 0: the gap goes left (the tile on its left comes right)
    or a
    jr z,.n
    ld a,e
    dec a
    jr .sw
.d1:
    dec a
    jr nz,.d2
    ld a,b                          ; 1: right
    cp 3
    jr z,.n
    ld a,e
    inc a
    jr .sw
.d2:
    dec a
    jr nz,.d3
    ld a,e                          ; 2: up
    sub 4
    jr c,.n
    jr .sw
.d3:
    ld a,e                          ; 3: down
    add a,4
    cp 16
    jr nc,.n
.sw:
    ld (PZ_G),a                     ; the neighbour is the new gap; its tile moves into the old one
    ld c,a
    ld b,0
    ld hl,PZ_B
    add hl,bc
    ld a,(hl)
    ld (hl),0
    ld d,0
    ld hl,PZ_B
    add hl,de
    ld (hl),a
.n:
    ld hl,PZ_T
    dec (hl)
    jr nz,.r
    jp pz_label

; pz_rnd: A = a random byte (a 16-bit Galois LFSR, 8 steps).  Clobbers F, B, HL.
pz_rnd:
    ld hl,(PZ_RND)
    ld b,8
.l:
    srl h
    rr l
    jr nc,.n
    ld a,h
    xor $B4
    ld h,a
.n:
    djnz .l
    ld (PZ_RND),hl
    ld a,l
    ret

; pz_move: B = the cell pressed (or the neighbour a key chose): when it is in the gap's row or column, the run of tiles between it and the gap slides one cell toward the gap; the
; cells that changed are redrawn; the moves, the label and the win.  Clobbers AF, BC, DE, HL.
pz_move:
    ld a,(PZ_WON)
    or a
    ret nz
    ld a,(PZ_G)
    ld c,a
    ld a,b
    cp c
    ret z
    ld (PZ_T),a
    xor c
    ld d,a                          ; t XOR g
    ld e,1
    and $0C
    jr z,.st                        ; the same row
    ld a,d
    and 3
    ret nz                          ; neither the row nor the column
    ld e,4
.st:
    ld a,(PZ_T)
    cp c
    jr nc,.pos
    ld a,e
    neg
    ld e,a
.pos:
    ld a,e
    ld (PZ_S),a
    ld a,c
    ld (PZ_C),a
.l:
    ld a,(PZ_C)
    call pz_inval                   ; the cell about to be filled
    ld a,(PZ_C)
    ld hl,PZ_S
    add a,(hl)
    ld e,a                          ; the next cell: its tile moves into this one
    ld d,0
    ld hl,PZ_B
    add hl,de
    ld d,(hl)
    ld (hl),0
    ld a,(PZ_C)
    ld c,a
    ld b,0
    ld hl,PZ_B
    add hl,bc
    ld (hl),d
    ld a,e
    ld (PZ_C),a
    ld hl,PZ_T
    cp (hl)
    jr nz,.l
    ld a,(PZ_C)
    call pz_inval                   ; the target cell is the new gap
    ld a,(PZ_C)
    ld (PZ_G),a
    ld hl,(PZ_MV)
    inc hl
    ld (PZ_MV),hl
    ld hl,PZ_B                      ; solved: 1 .. 15 and the gap last
    ld b,15
    ld a,1
.c:
    cp (hl)
    jr nz,.up
    inc hl
    inc a
    djnz .c
    ld a,1
    ld (PZ_WON),a
    IFDEF SOUND
    ld a,5                          ; the win sound
    call K_BEEP
    ENDIF
.up:
    call pz_label
    jp W_UPDATE

; pz_label: PZ_LBL = "Moves:  n" (or "Solved: n"), drawn (the leading zeros of the four digits are blanks).  Clobbers AF, BC, DE, HL, IX.
pz_label:
    ld hl,PZ_SMOVES
    ld a,(PZ_WON)
    or a
    jr z,.p
    ld hl,PZ_SSOLVED
.p:
    ld de,PZ_LBL
    ld bc,9
    ldir                            ; the length (12) and 8 characters
    ld hl,(PZ_MV)
    ld bc,-1000
    call .d
    ld bc,-100
    call .d
    ld bc,-10
    call .d
    ld a,l
    add a,'0'
    ld (de),a
    ld hl,PZ_LBL + 9
    ld b,3
.z:
    ld a,(hl)
    cp '0'
    jr nz,.zd
    ld (hl),' '
    inc hl
    djnz .z
.zd:
    ld ix,(PZ_LV)
    jp W_DRAWVIEW
.d:                                 ; one decimal digit of HL (BC = - its weight) at DE
    ld a,'0' - 1
.dl:
    inc a
    add hl,bc
    jr c,.dl
    sbc hl,bc
    ld (de),a
    inc de
    ret
PZ_SMOVES:  DB 12, "Moves:  "
PZ_SSOLVED: DB 12, "Solved: "

; pz_geom: A = a cell -> GA = (x, y, 64, 32) of that cell on the screen (from the board view's origin).  Clobbers AF, BC, DE, HL.
pz_geom:
    ld c,a
    and 3
    rrca
    rrca                            ; 64 col
    ld l,a
    ld h,0
    push ix
    ld ix,(PZ_BV)
    ld e,(ix+View_x)
    ld d,(ix+View_x+1)
    add hl,de
    ld (GA),hl
    ld a,c
    and $0C
    add a,a
    add a,a
    add a,a                         ; 32 row
    add a,(ix+View_y)
    ld l,a
    ld h,0
    ld (GA+2),hl
    pop ix
    ld hl,64
    ld (GA+4),hl
    ld l,32
    ld (GA+6),hl
    ret

; pz_inval: A = a cell: its rectangle becomes dirty.  Clobbers AF, BC, DE, HL.
pz_inval:
    call pz_geom
    jp W_INVAL

; pz_draw: the board's M_DRAW (IX = the view; the clip is the repaint rectangle): every tile, each clipped.  Clobbers AF, BC, DE, HL.
pz_draw:
    xor a
    ld (PZ_I),a
.l:
    ld a,(PZ_I)
    call pz_geom
    call pz_vis
    jr c,.n                         ; the cell is outside the repaint rectangle
    ld a,(PZ_I)
    ld c,a
    ld b,0
    ld hl,PZ_B
    add hl,bc
    ld a,(hl)
    or a
    call nz,pz_tile
.n:
    ld hl,PZ_I
    inc (hl)
    ld a,(hl)
    cp 16
    jr c,.l
    ret

; pz_vis: GA = a cell's rectangle (64 x 32): NC when it meets the clip, carry when it does not.  Clobbers AF, DE, HL.
pz_vis:
    ld hl,(GA)
    ld de,(GCX1)
    or a
    sbc hl,de
    jr nc,.no                       ; x >= the clip's right edge
    ld hl,(GA)
    ld de,64
    add hl,de
    ld de,(GCX0)
    or a
    sbc hl,de
    jr c,.no
    jr z,.no                        ; x + 64 <= the clip's left edge
    ld hl,(GA+2)
    ld de,(GCY1)
    or a
    sbc hl,de
    jr nc,.no
    ld hl,(GA+2)
    ld de,32
    add hl,de
    ld de,(GCY0)
    or a
    sbc hl,de
    jr c,.no
    ret nz                          ; NC: it is visible
.no:
    scf
    ret

; pz_tile: A = a tile 1 .. 15, PZ_I its cell: the 38 x 30 frame and its number in bold, centred.  Clobbers AF, BC, DE, HL.
pz_tile:
    ld hl,PZ_TXT
    ld c,1
    cp 10
    jr c,.o
    ld (hl),'1'
    inc hl
    inc c
    sub 10
.o:
    add a,'0'
    ld (hl),a
    ld a,c
    ld (PZ_N),a
    xor a
    call G_SETOP                    ; SET
    ld a,(PZ_I)
    call pz_geom
    ld hl,(GA)
    inc hl
    ld (GA),hl
    ld hl,(GA+2)
    inc hl
    ld (GA+2),hl
    ld hl,62
    ld (GA+4),hl
    ld l,30
    ld (GA+6),hl
    call G_FRAME
    ld a,(PZ_I)
    call pz_geom
    ld hl,PZ_TXT
    ld (GA+4),hl
    ld a,(PZ_N)
    ld l,a
    ld h,0
    ld (GA+6),hl
    ld a,(PZ_N)                     ; centred by the digits (about 6 pixels each): x + 32 - 3 n
    ld c,a
    add a,a
    add a,c
    neg
    add a,32
    ld e,a
    ld d,0
    ld hl,(GA)
    add hl,de
    ld (GA),hl
    ld hl,(GA+2)
    ld de,12
    add hl,de
    ld (GA+2),hl
    call G_TEXTP
    ld hl,(GA)                      ; bold: again one pixel on
    inc hl
    ld (GA),hl
    jp G_TEXTP

; pz_event: the board's M_EVENT (IX = the view, DE = K_EV): a press on a cell.  Carry = consumed.
pz_event:
    ex de,hl
    ld a,(hl)
    cp E_DOWN
    jr nz,.no
    inc hl
    ld a,(hl)                       ; x low
    inc hl
    ld d,(hl)                       ; y
    sub (ix+View_x)                 ; the offset in the view (0 .. 255: the low byte is enough)
    rlca
    rlca
    and 3                           ; the column (x / 64)
    ld e,a
    ld a,d
    sub (ix+View_y)
    rlca
    rlca
    rlca
    and 7                           ; the row (y / 32)
    add a,a
    add a,a
    add a,e
    ld b,a
    call pz_move
    scf
    ret
.no:
    or a
    ret

; The class (a View whose Draw and Event are this program's), the window's table (APPLIB 3 entries) and the strings: all in the pool (K reads them there).
    IF ((($ + 6) & $FF) + 2 * 6) > 256    ; the method table must not cross a page
    ALIGN 256, 0
    ENDIF
    DW CL_View
    DB 209, 6, View_SIZE, 8
CL_Board:
    DW view_destroy, pz_draw, pz_event, view_hittest, k_nop, k_nop
PZ_STITLE:  DB 6, "Puzzle"
PZ_SNEW:    DB 8, "New game"
PZ_TWIN:
    DW CL_CWindow, 64
    DB 24
    DW 400
    DB 160, 0, PZ_WINID, 8
    DW PZ_STITLE
    DW CL_Board, 80
    DB 48
    DW 256
    DB 128, 0, 1, 0
    DW 0
    DW CL_Label, 352
    DB 56
    DW 96
    DB 9, 0, 3, 0
    DW PZ_LBL
    DW CL_Button, 352
    DB 96
    DW 96
    DB 16, $11, 2, 0
    DW PZ_SNEW
    DW 0
