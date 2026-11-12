; wm.asm -- the window manager, slice W1 (docs/WINDOWS.md sections 2-7 and 14).  Included by kernel.asm.
;
; W_MAP holds one byte a cell (32 x 24 cells of 16 x 8 pixels): bits 0-3 the owner (0 desk, 1-14 window slots, 15 the bar),
; bit 7 dirty.  Every routine that sets a dirty bit also flags the cell's row (W_ROWF) and widens the column range
; [W_CLO, W_CHI), so W_UPDATE scans only rows and columns that can hold a dirty cell.
;
; The map is worked on a run at a time: a run is a stretch of equal bytes in one row, and w_runchain replaces it by another
; byte at 23 T a cell (the window operations change owners with it, W_UPDATE cleans dirty runs with it).
;
; Conventions (section 5): IX preserved unless an output, IY and the alternate set preserved, no DI or EI.

W_DIRTY     EQU $F0C0           ; byte: 0 = no cell dirty
K_FSCOPE    EQU $F0C2           ; word: the focus scope (0 = none)
W_MAP       EQU $F100           ; 768 bytes
W_SLOTS     EQU $F400           ; 16 words
W_MODAL     EQU $F420           ; word
; Internal state (14.2: not part of the interface)
W_AREA      EQU $F422           ; 4 bytes: c0, c1, r0, r1 (cells, half open) for w_rows
W_PARAM     EQU $F426           ; byte: the run routine's slot
W_SKIP      EQU $F427           ; byte: w_rows: 32 - the area's width
W_CLO       EQU $F428           ; byte: dirty cells lie in columns [W_CLO, W_CHI)
W_CHI       EQU $F429
W_ROW       EQU $F42A           ; byte: the row being scanned
W_VMODE     EQU $F42B           ; byte: 0 W_UPDATE, 1 W_DRAWVIEW (clip also to the view's rectangle)
W_GEN       EQU $F42C           ; byte: the batch's number (any start value)
W_ACT       EQU $F42D           ; byte: window_draw's active flag
W_DY        EQU $F42E           ; byte: W_MOVE's dy
W_FRONTT    EQU $F430           ; 16 bytes: 1 for each owner in front of the window being moved
W_ROWF      EQU $F440           ; 24 bytes: not 0 for a row that may hold a dirty cell
W_VIEW      EQU $F458           ; word: the view the records are painted with
W_OLDF      EQU $F45A           ; word: activation's old front window
W_NEWF      EQU $F45C           ; word: activation's new front window
W_DX        EQU $F45E           ; word: W_MOVE's dx
W_VR        EQU $F460           ; 4 words: W_DRAWVIEW's view rectangle, clamped: x0, x1, y0, y1
W_BASE      EQU $F468           ; 4 bytes: an area saved (w_refill)
W_OAREA     EQU $F46C           ; 4 bytes: W_MOVE's old area
W_OCNT      EQU W_FRONTT        ; 16 bytes: W_GEN for each owner with a rectangle in the batch (W_MOVE's table is free then;
                                ; a stale byte that happens to equal W_GEN only costs a look through the batch)
W_RL        EQU $E800           ; rectangle records (W_SAVE): owner, c0, c1, r0, r1.  IY = the next free one while scanning
W_OPENAT    EQU $EFC0           ; 32 words: the record last made or extended for each first column
W_RBATCH    EQU 365             ; a batch is painted at a row start once it holds this many (14.4)

    ASSERT W_OAREA + 4 <= $F480 && (W_ROWF >> 8) == ((W_ROWF + 23) >> 8) && W_CHI == W_CLO + 1
    ASSERT W_RL + 5 * 396 <= W_OPENAT && (W_OPENAT & $FF) == $C0 && (W_SLOTS & $FF) == 0 && (W_MAP & $FF) == 0
    ASSERT (W_OCNT >> 8) == (W_SLOTS >> 8)

; ===========================================================================================================================
; W_INIT (14.4): the desk and the bar in the kernel arena, the root, the map all dirty.  Carry when the kernel arena is full.
; Preserves IX.  Clobbers AF, BC, DE, HL.
W_INIT:
    push ix
    ld hl,(K_CURA)
    push hl
    ld hl,K_KARENA
    call K_ARENA
    ld hl,CL_Desk
    call K_NEW
    jr c,.fail
    ld (ix+View_w+1),2          ; 512
    ld (ix+View_h),192
    ld (W_SLOTS),ix
    ld hl,CL_MenuBar
    call K_NEW
    jr c,.fail
    ld (ix+View_w+1),2
    ld (ix+View_h),8
    ld (W_SLOTS+30),ix
    push ix
    pop de
    ld ix,(W_SLOTS)
    call K_ADDCHILD
    ld de,(W_SLOTS)
    call K_SETROOT              ; also clears K_FSCOPE
    ld hl,W_SLOTS+2
    ld b,28
    xor a
.slots:
    ld (hl),a
    inc l
    djnz .slots
    ld (W_MODAL),a
    ld (W_MODAL+1),a
    ld (W_CLO),a
    ld a,32
    ld (W_CHI),a
    ld hl,W_MAP
    ld b,a
    ld a,$8F
.bar:
    ld (hl),a
    inc l
    djnz .bar
    ld (hl),$80
    ld d,h
    ld e,l
    inc de
    ld bc,767-32
    ldir
    ld hl,W_ROWF
    ld b,24
    ld a,1
    ld (W_DIRTY),a
.rows:
    ld (hl),a
    inc l
    djnz .rows
    call w_openz
    pop hl
    ld (K_CURA),hl
    pop ix
    or a
    ret
.fail:
    pop hl
    ld (K_CURA),hl
    pop ix
    scf
    ret

; w_openz: W_OPENAT cleared (W_UPDATE trusts a pointer there only by its range; the menus' save-under can leave garbage in
; it).  Clobbers AF, B, HL.
w_openz:
    ld hl,W_OPENAT
    ld b,64
    xor a
.z:
    ld (hl),a
    inc l
    djnz .z
    ret

; ===========================================================================================================================
; W_FRONT: HL = the front window (the bar's next sibling), 0 when none is open.  Clobbers AF.
W_FRONT:
    ld hl,(W_SLOTS+30)
    ld a,View_next
    add a,l
    ld l,a
    jr nc,.nc
    inc h
.nc:
    ld a,(hl)
    inc hl
    ld h,(hl)
    ld l,a
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; W_OPEN (14.4): IX = a window.  Carry (nothing changed) when it is open, its rectangle is not valid, a dialog is open or no
; slot is free.  Preserves IX.  Clobbers AF, BC, DE, HL.
W_OPEN:
    ld a,(ix+Window_slot)
    or a
    jp nz,w_fail
    call w_valid
    ret c
    ld hl,(W_MODAL)
    ld a,h
    or l
    jp nz,w_fail
    ld hl,W_SLOTS+2
    ld b,1
.find:
    ld a,(hl)
    inc l
    or (hl)
    jr z,.got                   ; HL -> the free slot's high byte
    inc l
    inc b
    ld a,b
    cp 15
    jr c,.find
    scf
    ret
.got:
    push ix
    pop de
    ld (hl),d
    dec l
    ld (hl),e
    ld (ix+Window_slot),b
    call W_FRONT
    ld (W_OLDF),hl
    call w_tofront
    ld a,(ix+Window_slot)
    ld (W_PARAM),a
    call w_cells
    ld de,rr_take
    call w_rows
    ld hl,(W_OLDF)
    push ix
    pop de
    call w_activate
    call w_isdlg                ; a Dialog is modal (17.2)
    jr nz,.done
    ld (W_MODAL),ix
.done:
    or a
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; W_CLOSE (14.4): IX = a window.  Carry when it is not open.  Preserves IX.  Clobbers AF, BC, DE, HL.
W_CLOSE:
    ld a,(ix+Window_slot)
    or a
    jp z,w_fail
    ld hl,(K_FOCUS)
    call w_under
    jr nc,.nofocus
    ld de,0
    call K_SETFOCUS
.nofocus:
    ld hl,(K_CAPTURE)
    call w_under
    jr nc,.nocap
    ld hl,0
    ld (K_CAPTURE),hl
.nocap:
    call W_FRONT
    push ix
    pop de
    or a
    sbc hl,de
    push af                     ; Z: it was in front
    call K_UNLINK
    ld a,(ix+Window_slot)
    ld (W_PARAM),a
    add a,a
    ld l,a
    ld h,W_SLOTS >> 8
    xor a
    ld (hl),a
    inc l
    ld (hl),a
    call w_cells
    ld (ix+Window_slot),0
    ld de,rr_unown
    call w_rows
    call w_refill
    ld hl,(W_MODAL)             ; the dialog closes: no modal (17.2)
    push ix
    pop de
    or a
    sbc hl,de
    jr nz,.nomodal
    ld (W_MODAL),hl
.nomodal:
    pop af
    jr nz,.done
    ld hl,0
    ld (K_FSCOPE),hl            ; no scope until the next window is activated (none when this was the last)
    call W_FRONT
    ex de,hl
    ld hl,0
    call w_activate
.done:
    or a
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; W_RAISE (14.4): IX = a window.  Carry when it is not open; nothing when it is in front.  Preserves IX.  Clobbers AF, BC, DE, HL.
W_RAISE:
    ld a,(ix+Window_slot)
    or a
    jp z,w_fail
    ld hl,(W_MODAL)             ; a modal dialog: only it may be raised (17.2)
    ld a,h
    or l
    jr z,.free
    push ix
    pop de
    sbc hl,de                   ; carry clear (OR)
    jp nz,w_fail
.free:
    call W_FRONT
    push ix
    pop de
    or a
    sbc hl,de
    ret z                       ; in front already (carry clear)
    add hl,de
    ld (W_OLDF),hl
    call K_UNLINK
    call w_tofront
    ld a,(ix+Window_slot)
    ld (W_PARAM),a
    call w_cells
    ld de,rr_take
    call w_rows
    ld hl,(W_OLDF)
    push ix
    pop de
    jp w_activate

; ---------------------------------------------------------------------------------------------------------------------------
; W_MOVE (14.4): IX = a window, HL = x, DE = y.  Carry (nothing changed) when it is not open or the new rectangle is not valid.
; Preserves IX.  Clobbers AF, BC, DE, HL.
W_MOVE:
    ld a,(ix+Window_slot)
    or a
    jp z,w_fail
    call w_validxy
    ret c
    ld c,(ix+View_x)
    ld b,(ix+View_x+1)
    or a
    sbc hl,bc
    ld (W_DX),hl
    ld a,e
    sub (ix+View_y)
    ld (W_DY),a
    or h
    or l
    ret z                       ; where it is already (carry clear)
    call w_cells                ; (a) the old area: the cells it owns become desk, pending
    ld hl,(W_AREA)
    ld (W_OAREA),hl
    ld hl,(W_AREA+2)
    ld (W_OAREA+2),hl
    ld a,(ix+Window_slot)
    ld (W_PARAM),a
    ld de,rr_unown
    call w_rows
    call w_offset               ; every view under it moves
    ld hl,W_FRONTT              ; (b) the windows in front of it
    ld b,16
    xor a
.zf:
    ld (hl),a
    inc l
    djnz .zf
    push ix
    pop bc
    call W_FRONT
.front:
    ld a,l
    cp c
    jr nz,.mark
    ld a,h
    cp b
    jr z,.place
.mark:
    push hl
    ld de,Window_slot
    add hl,de
    ld a,(hl)
    add a,W_FRONTT & $FF
    ld e,a
    ld d,W_FRONTT >> 8
    ld a,1
    ld (de),a
    pop hl
    ld de,View_next
    add hl,de
    ld a,(hl)
    inc hl
    ld h,(hl)
    ld l,a
    jr .front
.place:                         ; its new cells, except those of windows in front, are its own and dirty
    call w_cells
    ld de,rr_place
    call w_rows
    ld hl,(W_OAREA)             ; (c) what is left pending in the old area goes to the windows behind, or the desk
    ld (W_AREA),hl
    ld hl,(W_OAREA+2)
    ld (W_AREA+2),hl
    call w_refill
    or a
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; W_INVALV: IX = a view.  W_INVAL of its rectangle.  Clobbers AF, BC, DE, HL; GA.
W_INVALV:
    call w_gaview
; W_INVAL (14.4): GA = x, y, w, h.  Every cell the rectangle touches (clamped to the screen) becomes dirty.  GA unchanged.
; Clobbers AF, BC, DE, HL.
W_INVAL:
    call w_gax
    ret c
    push de
    call w_gay
    pop hl
    ret c
    ld a,d
    sub e
    ld b,a                      ; B = rows
    ld c,e                      ; C = r0
    ex de,hl                    ; E = c0, D = c1
    ld a,1
    ld (W_DIRTY),a
    call w_widen                ; the column range
    push ix
    ld a,d
    sub e
    ld d,a                      ; D = columns, 1..32
    add a,a
    add a,d                     ; 3 bytes a cell in the chain
    neg
    add a,w_setend & $FF
    ld ixl,a
    ld a,w_setend >> 8
    adc a,$FF
    ld ixh,a                    ; IX = the chain's entry for this width
    ld a,c
    call w_cell                 ; HL = (c0, r0)
    ld a,c
    add a,W_ROWF & $FF
    ld e,a
    ld a,32
    sub d
    ld c,a
    ld d,W_ROWF >> 8            ; DE = the first row's flag
    ld a,b                      ; A = rows left
    ld b,0                      ; BC = from a row's end to the next row's start
    jp (ix)

; w_gax: GA's columns, clamped to the screen -> BC = the first pixel column, HL = the last, E = c0, D = c1 (cells, half
; open).  Carry when there are none.  Clobbers AF.
w_gax:
    ld hl,(GA)
    ld b,h
    ld c,l
    ld de,(GA+4)
    add hl,de
    dec hl
    ld a,b
    or h
    cp 2
    call nc,w_spanx             ; not both on the screen: clamped
    ld a,l
    sub c
    ld a,h
    sbc a,b
    ret c
    ld a,l
    and $F0
    or h
    rrca
    rrca
    rrca
    rrca
    inc a
    ld d,a
    ld a,c
    and $F0
    or b
    rrca
    rrca
    rrca
    rrca
    ld e,a
    or a
    ret
; w_gay: the same for GA's rows: BC = the first pixel row, HL = the last, E = r0, D = r1.
w_gay:
    ld hl,(GA+2)
    ld b,h
    ld c,l
    ld de,(GA+6)
    add hl,de
    dec hl
    ld a,191
    cp l
    sbc a,a                     ; 0 when the low byte is a screen row
    or b
    or h
    call nz,w_spany
    ld a,l
    sub c
    ld a,h
    sbc a,b
    ret c
    ld a,l
    rrca
    rrca
    rrca
    and $1F
    inc a
    ld d,a
    ld a,c
    rrca
    rrca
    rrca
    and $1F
    ld e,a
    ret

; w_spanx / w_spany: BC = first, HL = last (signed words) -> BC = max(first, 0), HL = min(last, 511 / 191); when the last
; is negative, HL < BC.  Clobbers AF, DE.
w_spanx:
    ld de,511
    jr w_span
w_spany:
    ld de,191
w_span:
    bit 7,b
    jr z,.first
    ld bc,0
.first:
    bit 7,h
    jr nz,.none
    ld a,e
    sub l
    ld a,d
    sbc a,h
    ret nc
    ex de,hl
    ret
.none:
    ld bc,1
    ld h,b
    ld l,b
    ret

; The two chains.  w_runchain's entries are reached by their low byte alone (w_runjp), so it must lie in one page: it goes
; before or after the 128 bytes of W_INVAL's chain and the helpers packed with it, whichever fits.
    MACRO W_RUNCHAIN
; w_runchain: at most n cells from HL equal to A become E; entered at w_runend - 4 n.  Z: all n done, HL is the cell after them
; (a true 16-bit step on the last).  NZ: stopped at a cell that differs, HL -> it.  A is kept.
w_runchain:
    DUP 31
    cp (hl)
    ret nz
    ld (hl),e
    inc l
    EDUP
    cp (hl)
    ret nz
    ld (hl),e
    inc hl
w_runend:
    cp a
    ret
    ENDM

w_runfirst = (($ & $FF) <= 127)
    IF w_runfirst
    W_RUNCHAIN
    ENDIF
w_setblock:
; w_setchain: SET 7 on n cells from HL, entered at w_setend - 3 n (W_INVAL): then the row's flag, and the next row or the end.
w_setchain:
    DUP 31
    set 7,(hl)
    inc l
    EDUP
    set 7,(hl)
    inc hl
w_setend:
    ld (de),a
    inc e
    add hl,bc
    dec a
    jr z,.done
    jp (ix)
.done:
    pop ix
    ret
; w_widen: E = c0, D = c1: the column range takes them in.  Clobbers AF, HL.
w_widen:
    ld hl,W_CLO
    ld a,e
    cp (hl)
    jr nc,.lo
    ld (hl),a
.lo:
    inc l
    ld a,(hl)
    cp d
    ret nc
    ld (hl),d
    ret
w_max:                          ; HL = max(HL, DE), unsigned.  Clobbers AF, DE.
    ld a,l
    sub e
    ld a,h
    sbc a,d
    ret nc
    ex de,hl
    ret
    ASSERT $ - w_setblock == 128
    IF !w_runfirst
    W_RUNCHAIN
    ENDIF
    ASSERT (w_runend & $FF) >= 128 && (w_runend >> 8) == (w_runchain >> 8)

; w_cell: A = row (0..23), E = column (0..31) -> HL = W_MAP + 32 row + column.  Clobbers AF.
w_cell:
    rrca
    rrca
    rrca
    ld l,a
    and 3
    add a,W_MAP >> 8
    ld h,a
    ld a,l
    and $E0
    or e
    ld l,a
    ret
; ===========================================================================================================================
; W_UPDATE (section 6, 14.4): repaints every dirty cell.  Returns at once when W_DIRTY = 0.  Preserves IX.  Clobbers AF, BC,
; DE, HL; GA and GOP undefined; the clip is the whole screen after.
W_UPDATE:
    ld a,(W_DIRTY)
    or a
    ret z
    push ix
    push iy
    xor a
    ld (W_DIRTY),a
    ld (W_VMODE),a
    ld d,a                      ; D = the byte of the run that was all of the row above's columns, else 0
    ld hl,(W_CLO)
    ld a,l
    sub h
    add a,32
    ld (W_SKIP),a               ; from the columns' end to their start in the next row
    call w_lreset
    ld hl,W_ROWF
    ld b,24
.row:
    ld a,(hl)
    or a
    call nz,w_udirty
    and d                       ; a row not flagged: nothing to repeat
    ld d,a
    inc l
    djnz .row
    call w_paint
    ld hl,32
    ld (W_CLO),hl               ; no columns: W_CLO = 32, W_CHI = 0
    pop iy
    pop ix
; w_clipall: the clip = the whole screen (what G_SETCLIP of the screen leaves).  Clobbers HL.
w_clipall:
    ld hl,0
    ld (GCLIP),hl
    ld (GCLIP+4),hl
    ld hl,512
    ld (GCLIP+2),hl
    ld hl,192
    ld (GCLIP+6),hl
    ret

; w_udirty: HL -> a row's flag (not 0), B = 24 - the row, D as in W_UPDATE.  The row's dirty runs are cleaned and recorded,
; and the rows below it while each repeats a run that is all of the columns.  HL, B: the last row done.  A = D.
w_udirty:
    ld (hl),0
    ld a,24
    sub b
    ld (W_ROW),a
    ld a,iyh
    cp (W_RL + 5 * W_RBATCH) >> 8
    jr c,.room
    jr nz,.full
    ld a,iyl
    cp (W_RL + 5 * W_RBATCH) & $FF
    jr c,.room
.full:
    call w_paint                ; a full batch: painted before this row
    call w_lreset
    ld d,0
.room:
    ld bc,(W_CLO)
    ld e,c
    call w_rowset
.first:
    ld c,l
    ld a,(hl)
    and $7F
    ld e,a
    call w_runjp
    jr nz,.more
    cp d
    jr nz,.one
    inc (iy-1)                  ; the row above's only run again: its rectangle, the batch's last, grows.  No record was
    ld a,(W_ROW)                ; made, so the next row needs no batch test
    cp 23
    jr z,.out
    inc a
    ld (W_ROW),a
    push hl
    add a,W_ROWF & $FF
    ld l,a
    ld h,W_ROWF >> 8
    ld a,(hl)
    ld (hl),0
    pop hl
    or a
    jr z,.none                  ; not flagged
    ld a,(W_SKIP)
    add a,l
    ld l,a
    jr nc,.nc
    inc h
.nc:
    ld a,b
    xor $80                     ; the next row's chain constant
    ld b,a
    jr .first
.one:                           ; one run is all of the columns
    or a
    jp p,.none
    push af
    call w_addrun
    pop af
    ld d,a
    jr .out
.run:
    ld c,l
    ld a,(hl)
    and $7F
    ld e,a
    call w_runjp
    jr z,.last
.more:
    or a
    call m,w_addrun
    jr .run
.last:
    or a
    call m,w_addrun
.none:
    ld d,0
.out:
    ld a,(W_ROW)
    ld c,a
    add a,W_ROWF & $FF
    ld l,a
    ld h,W_ROWF >> 8
    ld a,24
    sub c
    ld b,a
    ld a,d
    ret

; w_lreset: an empty batch.  IY = the first record.  Clobbers HL.
w_lreset:
    ld iy,W_RL
    ld hl,W_GEN
    inc (hl)
    ret

; w_rowset: row W_ROW, E = its first column, B = the column after the last -> HL = the first cell, B = the row's chain
; constant, IX = w_runend.  Clobbers AF.
w_rowset:
    ld a,(W_ROW)
w_rowseta:
    call w_cell
    ld a,l
    sub e
    add a,b                     ; the low byte of the end cell's address
    add a,a
    add a,a
    neg
    add a,w_runend & $FF
    ld b,a
    ld ix,w_runend
    ret

; w_addrun: E = owner, the cells from low byte C to low byte L of row W_ROW.  Extends the rectangle made or extended for c0
; at the row above when it has the same owner and columns; else a new record.  Preserves B, HL.  Clobbers AF, C, DE.
w_addrun:
    push hl
    ld a,l
    sub c
    ld d,a                      ; the run's length (L may have passed the page's end)
    ld a,c
    and 31
    ld c,a                      ; c0
    add a,d
    ld d,a                      ; c1
    ld a,c
    add a,a
    add a,W_OPENAT & $FF
    ld l,a
    ld h,W_OPENAT >> 8
    push hl                     ; -> W_OPENAT[c0]
    ld a,(hl)
    inc l
    ld h,(hl)
    ld l,a                      ; HL = the candidate record
    ld a,h
    cp W_RL >> 8
    jr c,.new                   ; below the list: not one of this batch's
    ld a,l
    sub iyl
    ld a,h
    sbc a,iyh
    jr nc,.new                  ; at or past the list's end
    ld a,(hl)
    cp e
    jr nz,.new
    inc hl
    ld a,(hl)
    cp c
    jr nz,.new
    inc hl
    ld a,(hl)
    cp d
    jr nz,.new
    inc hl
    inc hl
    ld a,(W_ROW)
    cp (hl)
    jr nz,.new                  ; it does not end at this row
    inc a
    ld (hl),a                   ; r1 = row + 1
    pop hl
    pop hl
    ret
.new:
    ld a,e
    add a,W_OCNT & $FF
    ld l,a
    ld h,W_OCNT >> 8
    ld a,(W_GEN)
    ld (hl),a                   ; the owner has a rectangle in this batch
    pop hl                      ; -> W_OPENAT[c0]
    ld a,iyl
    ld (hl),a
    inc l
    ld a,iyh
    ld (hl),a
    ld (iy+0),e
    ld (iy+1),c
    ld (iy+2),d
    ld a,(W_ROW)
    ld (iy+3),a
    inc a
    ld (iy+4),a
    ld de,5
    add iy,de
    pop hl
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; w_paint: paints the batch (the records up to IY), owner 15, the windows front to back, then 0 (section 6).  Clobbers AF,
; BC, DE, HL, IX.
w_paint:
    ld a,15
    call w_pown
    call W_FRONT
.win:
    ld a,h
    or l
    jr z,w_pown                 ; the desk
    push hl
    ld de,Window_slot
    add hl,de
    ld a,(hl)
    call w_pown
    pop hl
    ld de,View_next
    add hl,de
    ld a,(hl)
    inc hl
    ld h,(hl)
    ld l,a
    jr .win
; w_pown: A = an owner: its records painted with W_SLOTS[owner].  Clobbers AF, BC, DE, HL, IX.
w_pown:
    ld c,a
    add a,W_OCNT & $FF
    ld l,a
    ld h,W_OCNT >> 8
    ld a,(W_GEN)
    cp (hl)
    ret nz                      ; no record of this batch is the owner's
    ld l,c
    sla l
    ld a,(hl)
    inc l
    ld h,(hl)
    ld l,a
    ld (W_VIEW),hl
; w_precs: C = an owner: its records in the batch painted with W_VIEW, in order.  Clobbers AF, BC, DE, HL, IX.
w_precs:
    ld hl,W_RL
.rec:
    ld a,l
    sub iyl
    ld a,h
    sbc a,iyh
    ret nc
    ld a,(hl)
    cp c
    jr nz,.skip
    push hl
    push bc
    call w_prec
    pop bc
    pop hl
.skip:
    ld de,5
    add hl,de
    jr .rec

; w_prec: HL -> a record.  The clip and the shield on its pixels (also within W_VR when W_VMODE), M_DRAW to W_VIEW.  The clip
; is written as G_SETCLIP would leave it: the rectangle is on the screen.  Clobbers AF, BC, DE, HL, IX.
w_prec:
    ex de,hl
    inc de
    ld a,(de)                   ; c0
    inc de
    ld l,a
    ld h,0
    add hl,hl
    add hl,hl
    add hl,hl
    add hl,hl
    ld (GCLIP),hl
    ld (GA),hl
    ld b,h
    ld c,l
    ld a,(de)                   ; c1
    inc de
    ld l,a
    ld h,0
    add hl,hl
    add hl,hl
    add hl,hl
    add hl,hl
    ld (GCLIP+2),hl
    or a
    sbc hl,bc
    ld (GA+4),hl
    ld a,(de)                   ; r0 (8 r1 is 192 at most: a byte)
    inc de
    add a,a
    add a,a
    add a,a
    ld l,a
    ld h,0
    ld (GCLIP+4),hl
    ld (GA+2),hl
    ld c,l
    ld a,(de)                   ; r1 (8 r1 is 192 at most: a byte)
    inc de
    add a,a
    add a,a
    add a,a
    ld l,a
    ld h,0
    ld (GCLIP+6),hl
    sub c
    ld l,a
    ld (GA+6),hl
    ld a,(W_VMODE)
    or a
    call nz,w_gavr
    call P_SHIELD
    ld ix,(W_VIEW)
    ld a,M_DRAW
    rst $08
    jp P_UNSHIELD

; w_gavr: the clip and GA = the clip intersected with W_VR (both on the screen and meeting).  Clobbers AF, DE, HL.
w_gavr:
    ld hl,(GCLIP)
    ld de,(W_VR)
    call w_max
    ld (GCLIP),hl
    ld (GA),hl
    push hl
    ld hl,(GCLIP+2)
    ld de,(W_VR+2)
    call w_min
    ld (GCLIP+2),hl
    pop de
    or a
    sbc hl,de
    ld (GA+4),hl
    ld hl,(GCLIP+4)
    ld de,(W_VR+4)
    call w_max
    ld (GCLIP+4),hl
    ld (GA+2),hl
    push hl
    ld hl,(GCLIP+6)
    ld de,(W_VR+6)
    call w_min
    ld (GCLIP+6),hl
    pop de
    or a
    sbc hl,de
    ld (GA+6),hl
    ret
w_min:                          ; HL = min(HL, DE), unsigned.  Clobbers AF, DE.
    ld a,l
    sub e
    ld a,h
    sbc a,d
    ret c
    ex de,hl
    ret

; ===========================================================================================================================
; W_DRAWVIEW (14.4): IX = a view, drawn now where its top-level owner shows.  Preserves IX.  Clobbers AF, BC, DE, HL; GA, GOP.
W_DRAWVIEW:
    push ix
    push iy
    push ix
    pop hl
.climb:                         ; HL = a view on the way up
    push hl
    ld de,View_flags
    add hl,de
    bit 1,(hl)
    pop hl
    jp nz,.none                 ; hidden
    ld de,(W_SLOTS)
    or a
    sbc hl,de
    add hl,de
    ld c,0
    jr z,.found                 ; the desk
    ld de,(W_SLOTS+30)
    or a
    sbc hl,de
    add hl,de
    ld c,15
    jr z,.found                 ; the bar
    push hl
    ld de,View_parent
    add hl,de
    ld e,(hl)
    inc hl
    ld d,(hl)
    ld hl,(W_SLOTS)
    or a
    sbc hl,de
    pop hl
    jr z,.window                ; its parent is the desk: an open window
    ld a,d
    or e
    jp z,.none                  ; not in the desktop's tree
    ex de,hl
    jr .climb
.window:
    ld de,Window_slot
    add hl,de
    ld c,(hl)
.found:
    ld a,c
    ld (W_PARAM),a
    call w_gaview
    call w_gax
    jr c,.none
    ld (W_VR),bc
    inc hl
    ld (W_VR+2),hl
    ld (W_AREA),de
    call w_gay
    jr c,.none
    ld (W_VR+4),bc
    inc hl
    ld (W_VR+6),hl
    ld (W_AREA+2),de
    ld (W_VIEW),ix
    ld a,1
    ld (W_VMODE),a
    call w_lreset
    ld a,(W_AREA+2)
.row:
    ld hl,W_AREA+3
    cp (hl)
    jr nc,.paint
    ld (W_ROW),a
    call w_vscan
    ld a,(W_ROW)
    inc a
    jr .row
.paint:
    ld a,(W_PARAM)
    ld c,a
    call w_precs
    xor a
    ld (W_VMODE),a
    call w_clipall
.none:
    pop iy
    pop ix
    ret

; w_vscan: row W_ROW, the columns of W_AREA: each maximal run of cells owned by W_PARAM (dirty or not) is recorded.
w_vscan:
    ld bc,(W_AREA)
    ld e,c
    call w_rowset
.run:
    ld c,l                      ; where a run of the owner's would start
.more:
    call w_runskip              ; over one run of equal bytes; nothing changes
    ld e,a
    push af
    ld a,(W_PARAM)
    xor e
    add a,a
    jr nz,.other
    pop af
    jr z,.rec                   ; the columns end in the owner's run
    ld a,(W_PARAM)
    xor (hl)
    add a,a
    jr z,.more                  ; the owner's still (the dirty bit differs): the same run
    call .rec
    jr .run
.other:
    pop af
    jr nz,.run
    ret
.rec:
    ld a,(W_PARAM)
    ld e,a
    jp w_addrun

; ===========================================================================================================================
; Helpers.

; w_cells: IX = a window (valid rectangle) -> W_AREA = its cells.  Clobbers AF, DE, HL.
w_cells:
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    ld a,l
    and $F0
    or h
    rrca
    rrca
    rrca
    rrca
    ld (W_AREA),a
    ld e,(ix+View_w)
    ld d,(ix+View_w+1)
    add hl,de
    ld a,l
    and $F0
    or h
    rrca
    rrca
    rrca
    rrca
    ld (W_AREA+1),a
    ld a,(ix+View_y)
    ld e,a
    rrca
    rrca
    rrca
    and $1F
    ld (W_AREA+2),a
    ld a,e
    add a,(ix+View_h)
    rrca
    rrca
    rrca
    and $1F
    ld (W_AREA+3),a
    ret

; w_rows: DE = a run routine, W_PARAM = its slot, W_AREA = the cells.  In each row of the area, every run of equal bytes goes
; to the routine: HL -> its first cell, E = the slot + $80, Z when the cells are the slot's.  The routine leaves through
; w_runskip (no change) or w_runchg (the run becomes E, a dirty byte).  A row that changed is flagged; when anything is dirty
; the column range takes in the area.  Clobbers AF, BC, DE, HL.
w_rows:
    ld hl,(W_AREA+2)            ; L = r0, H = r1
    ld a,h
    sub l
    ret z
    ret c
    ld c,a                      ; C = rows
    ld b,l                      ; B = r0
    ld hl,(W_AREA)              ; L = c0, H = c1
    ld a,l
    sub h
    ret nc                      ; no columns
    add a,32
    ld (W_SKIP),a               ; from a row's end to the next row's start
    push ix
    push iy
    push de
    pop iy
    ld a,b
    add a,W_ROWF & $FF
    ld e,a
    ld d,W_ROWF >> 8
    push de                     ; (SP) -> the row's flag
    ex de,hl                    ; E = c0, D = c1
    ld a,b
    ld b,d
    call w_rowseta
    ld d,0                      ; D: not 0 when the row changed
.run:
    call .go
    jr nz,.run
    ex (sp),hl                  ; HL -> the row's flag, (SP) = the cell after the row's last
    ld a,d
    or (hl)
    ld (hl),a
    jr z,.clean
    ld a,1
    ld (W_DIRTY),a
    ld d,0
.clean:
    inc l
    ex (sp),hl
    ld a,(W_SKIP)
    add a,l
    ld l,a
    jr nc,.nc
    inc h
.nc:
    ld a,b
    xor $80                     ; the next row's chain constant: its cells are 32 on
    ld b,a
    dec c
    jr nz,.run
    pop hl
    pop iy
    pop ix
    ld a,(W_DIRTY)
    or a
    ret z
    ld de,(W_AREA)
    jp w_widen
.go:
    ld a,(W_PARAM)
    or $80
    ld e,a
    xor (hl)
    add a,a                     ; Z: the slot's cells
    jp (iy)

; Run routines for w_rows.
rr_title:                       ; every cell of the slot's becomes dirty
    jr z,w_runchg
    jr w_runskip
rr_unown:                       ; every cell of the slot's becomes the desk's, dirty (pending)
    jr nz,w_runskip
    ld e,$80
    jr w_runchg
rr_place:                       ; every cell whose owner is not in front of the slot's window becomes the slot's, dirty
    ld a,(hl)
    and $0F
    add a,W_FRONTT & $FF
    push hl
    ld l,a
    ld h,W_FRONTT >> 8
    ld a,(hl)
    pop hl
    or a
    jr z,w_runchg
    jr w_runskip
rr_fill0:                       ; every cell of the desk's (pending) becomes the slot's, dirty
    ld a,(hl)
    add a,a
    jr z,w_runchg
    jr w_runskip
rr_take:                        ; every cell not the slot's becomes the slot's, dirty
    jr nz,w_runchg
; w_runskip / w_runchg / w_runjp: the run at HL (to the end of the row's columns at most) becomes E; w_runskip leaves it as
; it is, w_runchg also notes the change in D.  HL -> the cell after it, A = its old byte, Z at the end of the columns.
; B and IX from w_rowset.
w_runskip:
    ld e,(hl)
    DB $3E                      ; LD A,n: skips the LD D,E
w_runchg:
    ld d,e
w_runjp:
    ld a,l
    add a,a
    add a,a
    add a,b
    ld ixl,a
    ld a,(hl)
    jp (ix)

; w_valid: IX's rectangle; w_validxy: HL = x, DE = y with IX's w and h.  Carry when it breaks section 3.  Preserve HL, DE;
; clobber AF, BC.
w_valid:
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    ld e,(ix+View_y)
    ld d,0
w_validxy:
    ld a,d
    or a
    jr nz,w_fail
    ld a,e
    cp 8
    jr c,w_fail
    and 7
    jr nz,w_fail
    ld a,l
    and $0F
    jr nz,w_fail
    ld a,h
    cp 2
    jr nc,w_fail
    ld c,(ix+View_w)
    ld b,(ix+View_w+1)
    ld a,c
    and $0F
    jr nz,w_fail
    ld a,b
    cp 3
    jr nc,w_fail
    or a
    jr nz,.wide
    ld a,c
    cp 48
    jr c,w_fail
.wide:
    push hl
    add hl,bc
    ld a,h
    cp 2
    jr c,.xok
    jr nz,.xbad
    ld a,l
    or a
    jr z,.xok
.xbad:
    pop hl
    jr w_fail
.xok:
    pop hl
    ld a,(ix+View_h)
    ld c,a
    and 7
    jr nz,w_fail
    ld a,c
    cp 16
    jr c,w_fail
    add a,e
    jr c,w_fail
    cp 193
    jr nc,w_fail
    or a
    ret
w_fail:
    scf
    ret

; w_tofront: IX = a window not in the desk's list: linked as the bar's next sibling, its parent the desk.  Clobbers AF, DE, HL.
w_tofront:
    ld hl,(W_SLOTS)
    ld (ix+View_parent),l
    ld (ix+View_parent+1),h
    ld hl,(W_SLOTS+30)
    ld de,View_next
    add hl,de
    ld e,(hl)
    inc hl
    ld d,(hl)
    ld (ix+View_next),e
    ld (ix+View_next+1),d
    push ix
    pop de
    ld (hl),d
    dec hl
    ld (hl),e
    ret

; w_under: HL = a view or 0 -> carry when it is IX or under IX.  Clobbers AF, DE, HL.
w_under:
    push ix
    pop de
.l:
    ld a,h
    or l
    ret z
    ld a,l
    cp e
    jr nz,.up
    ld a,h
    cp d
    scf
    ret z
.up:
    push de
    ld de,View_parent
    add hl,de
    ld a,(hl)
    inc hl
    ld h,(hl)
    ld l,a
    pop de
    jr .l

; w_refill: the desk-owned (pending) cells of W_AREA go to the windows, front to back, first come first served.  Clobbers AF,
; BC, DE, HL.
w_refill:
    ld hl,(W_AREA)
    ld (W_BASE),hl
    ld hl,(W_AREA+2)
    ld (W_BASE+2),hl
    push ix
    call W_FRONT
.l:
    ld a,h
    or l
    jr z,.end
    push hl
    pop ix
    call w_cells
    call w_clip
    ld a,(ix+Window_slot)
    ld (W_PARAM),a
    ld de,rr_fill0
    call w_rows
    ld l,(ix+View_next)
    ld h,(ix+View_next+1)
    jr .l
.end:
    pop ix
    ret

; w_clip: W_AREA = W_AREA intersected with W_BASE.  Clobbers AF, DE, HL.
w_clip:
    ld hl,W_AREA
    ld de,W_BASE
    ld a,(de)
    cp (hl)
    jr c,.c1
    ld (hl),a
.c1:
    inc l
    inc e
    ld a,(de)
    cp (hl)
    jr nc,.c2
    ld (hl),a
.c2:
    inc l
    inc e
    ld a,(de)
    cp (hl)
    jr c,.c3
    ld (hl),a
.c3:
    inc l
    inc e
    ld a,(de)
    cp (hl)
    ret nc
    ld (hl),a
    ret

; w_offset: every view under IX (IX first, pre-order) gets View_x += W_DX, View_y += W_DY.  Clobbers AF, BC, DE, HL.
w_offset:
    push ix
    pop hl
    ld b,h
    ld c,l
.node:
    push hl
    ld de,View_x
    add hl,de
    ld e,(hl)
    inc hl
    ld d,(hl)
    push hl
    ld hl,(W_DX)
    add hl,de
    ex de,hl
    pop hl
    ld (hl),d
    dec hl
    ld (hl),e
    inc hl
    inc hl
    ld a,(W_DY)
    add a,(hl)
    ld (hl),a
    pop hl
    push hl
    ld de,View_child
    add hl,de
    ld e,(hl)
    inc hl
    ld d,(hl)
    pop hl
    ld a,d
    or e
    jr z,.up
    ex de,hl
    jr .node
.up:
    ld a,l
    cp c
    jr nz,.sib
    ld a,h
    cp b
    ret z
.sib:
    push hl
    ld de,View_next
    add hl,de
    ld e,(hl)
    inc hl
    ld d,(hl)
    pop hl
    ld a,d
    or e
    jr z,.par
    ex de,hl
    jr .node
.par:
    ld de,View_parent
    add hl,de
    ld a,(hl)
    inc hl
    ld h,(hl)
    ld l,a
    jr .up
    ASSERT View_y == View_x + 2

; w_activate (14.4): HL = old, DE = f (windows or 0).  Carry clear.  Preserves IX.  Clobbers AF, BC, DE, HL.
w_activate:
    or a
    sbc hl,de
    jr z,.same
    add hl,de
    push ix
    ld (W_OLDF),hl
    ld (W_NEWF),de
    ld a,h
    or l
    jr z,.scope
    push hl
    pop ix
    ld hl,(K_FOCUS)
    call w_under
    ld hl,0
    jr nc,.keep
    ld hl,(K_FOCUS)
.keep:
    ld (ix+Window_focus),l
    ld (ix+Window_focus+1),h
.scope:
    ld hl,(W_NEWF)
    ld (K_FSCOPE),hl
    ld de,0
    ld a,h
    or l
    jr z,.clear
    push hl
    pop ix
    ld e,(ix+Window_focus)
    ld d,(ix+Window_focus+1)
    ld a,d
    or e
    jr z,.walk
    call K_SETFOCUS
    jr nc,.titles
.walk:
    ld de,0
    call K_SETFOCUS
    call K_FOCUSNEXT
    jr .titles
.clear:
    call K_SETFOCUS
.titles:
    ld hl,(W_OLDF)
    call w_titledmg
    ld hl,(W_NEWF)
    call w_titledmg
    pop ix
.same:
    or a
    ret

; w_titledmg: HL = a window or 0: when it is open, the cells of its title row it owns become dirty.  Clobbers AF, BC, DE, HL, IX.
w_titledmg:
    ld a,h
    or l
    ret z
    push hl
    pop ix
    ld a,(ix+Window_slot)
    or a
    ret z
    ld (W_PARAM),a
    call w_cells
    ld a,(W_AREA+2)
    inc a
    ld (W_AREA+3),a
    ld de,rr_title
    jp w_rows

; ===========================================================================================================================
; Draw methods (14.3).  GCLIP is set and the pointer shielded by the caller; each draws its whole rectangle.

; group_draw: Group's M_DRAW: M_DRAW to each child not hidden whose rectangle meets the clip.  Preserves IX.
group_draw:
    push ix
    ld l,(ix+View_child)
    ld h,(ix+View_child+1)
.l:
    ld a,h
    or l
    jr z,.end
    push hl
    pop ix
    bit 1,(ix+View_flags)
    jr nz,.n
    call w_meets
    jr nc,.n
    ld a,M_DRAW
    rst $08
.n:
    ld l,(ix+View_next)
    ld h,(ix+View_next+1)
    jr .l
.end:
    pop ix
    ret

; w_meets: IX = a view -> carry when its rectangle is not empty and meets GCLIP.  Clobbers AF, BC, DE, HL.
w_meets:
    ld e,(ix+View_w)
    ld d,(ix+View_w+1)
    ld a,d
    or e
    ret z
    ld a,(ix+View_h)
    or a
    ret z
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    ld bc,(GCLIP+2)
    ld a,l
    sub c
    ld a,h
    sbc a,b
    ret nc                      ; x >= x1
    add hl,de
    ld bc,(GCLIP)
    ld a,c
    sub l
    ld a,b
    sbc a,h
    ret nc                      ; x0 >= x + w
    ld a,(GCLIP+6)
    ld c,a
    ld a,(ix+View_y)
    cp c
    ret nc                      ; y >= y1
    add a,(ix+View_h)
    jr c,.yes                   ; y + h > 255
    ld c,a
    ld a,(GCLIP+4)
    cp c                        ; carry when y0 < y + h
    ret
.yes:
    scf
    ret

; desk_draw: paper over (0, 8, 512, 184).
desk_draw:
    ld a,1
    call G_SETOP
    ld hl,8
    jr w_fullw
; w_fullw: G_FILL (0, HL, 512, 192 - HL).
w_fullw:
    ld (GA+2),hl
    ex de,hl
    ld hl,192
    or a
    sbc hl,de
    ld a,e
    or a
    jr nz,.h
    ld l,8                      ; the bar: 8 rows
.h:
    ld (GA+6),hl
    ld hl,0
    ld (GA),hl
    ld hl,512
    ld (GA+4),hl
    jp G_FILL

; window_draw (14.3): frame, title bar, content, then the children.  The pixels are 14.3's; the order differs for speed: the
; title band and the content are filled whole-width (x, w are byte aligned, so no partial bytes), then the frame is drawn on top.
window_draw:
    xor a
    ld (W_ACT),a
    ld a,(ix+Window_slot)
    or a
    jr z,.title
    call W_FRONT
    push ix
    pop de
    or a
    sbc hl,de
    jr nz,.title
    ld a,1
    ld (W_ACT),a
.title:                         ; rows y .. y + 8: ink when active, else paper
    ld a,(W_ACT)
    xor 1
    call G_SETOP
    call w_gaview
    ld hl,9
    ld (GA+6),hl
    call G_FILL
    ld a,1                      ; rows y + 9 .. y + h - 1: paper
    call G_SETOP
    ld hl,(GA+2)
    ld de,9
    add hl,de
    ld (GA+2),hl
    ld l,(ix+View_h)
    ld h,0
    ld de,-9
    add hl,de
    ld (GA+6),hl
    call G_FILL
    xor a
    call G_SETOP
    ld a,(W_ACT)
    or a
    jr nz,.sides
    ld de,0
    call .hline                 ; inactive: the top line and the separator
    ld de,8
    call .hline
.sides:
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    call .vline
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    ld e,(ix+View_w)
    ld d,(ix+View_w+1)
    add hl,de
    dec hl
    call .vline
    ld e,(ix+View_h)
    ld d,0
    dec de
    call .hline                 ; the bottom line
    ld l,(ix+Window_title)
    ld h,(ix+Window_title+1)
    ld a,h
    or l
    jp z,group_draw
    ld b,(hl)                   ; n
    inc hl
    ld (GA+4),hl
    push hl
    ld l,(ix+View_w)
    ld h,(ix+View_w+1)
    ld de,-16
    add hl,de
    ex de,hl                    ; DE = room (w - 16)
    pop hl                      ; HL = the codes
    ld c,0
    bit 7,d
    jr nz,.tn
    ld a,b
    or a
    jr z,.tn
.tw:
    push hl
    ld l,(hl)
    ld h,PROP6_W >> 8
    ld a,(hl)
    ex de,hl
    ld e,a
    ld d,0
    or a
    sbc hl,de
    ex de,hl                    ; DE = room left
    pop hl
    jr c,.tn
    inc c
    inc hl
    djnz .tw
.tn:
    ld l,c
    ld h,0
    ld (GA+6),hl
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    ld de,8
    add hl,de
    ld (GA),hl
    ld l,(ix+View_y)
    ld h,0
    ld (GA+2),hl
    ld a,(W_ACT)
    add a,a                     ; active: XOR, else SET
    call G_SETOP
    call G_TEXTP
    jp group_draw
.hline:                         ; DE = a row offset: G_HLINE (x, y + DE, w)
    ld l,(ix+View_y)
    ld h,0
    add hl,de
    ex de,hl
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    ld c,(ix+View_w)
    ld b,(ix+View_w+1)
    jp G_HLINE
.vline:                         ; HL = x: G_VLINE (x, y, h)
    ld e,(ix+View_y)
    ld d,0
    ld c,(ix+View_h)
    ld b,d
    jp G_VLINE

; w_gaview: GA = IX's rectangle.  Clobbers HL.
w_gaview:
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    ld (GA),hl
    ld l,(ix+View_y)
    ld h,0
    ld (GA+2),hl
    ld l,(ix+View_w)
    ld h,(ix+View_w+1)
    ld (GA+4),hl
    ld l,(ix+View_h)
    ld h,0
    ld (GA+6),hl
    ret
; window_destroy: Window's M_DESTROY: closed first when open.
window_destroy:
    ld a,(ix+Window_slot)
    or a
    call nz,W_CLOSE
    jp view_destroy
