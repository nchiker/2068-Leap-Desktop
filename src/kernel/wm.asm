; wm.asm -- the window manager, slice W1 (docs/WINDOWS.md sections 2-7 and 14).  Included by kernel.asm.
;
; W_MAP holds one byte a cell (32 x 24 cells of 16 x 8 pixels): bits 0-3 the owner (0 desk, 1-14 window slots, 15 the bar),
; bit 7 dirty.  Every routine that sets a dirty bit also flags the cell's row (W_ROWF) and widens the column range
; [W_CLO, W_CHI), so W_UPDATE scans only rows and columns that can hold a dirty cell.
;
; The map is worked on a run at a time: a run is a stretch of equal bytes in one row, and w_runchain replaces it by another
; byte at 23 T a cell (the window operations change owners with it, W_UPDATE cleans dirty runs with it).  The two unrolled
; chains (w_runchain, w_setchain) are in kernel.asm, at fixed places in the kernel's first page.
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
W_ACT       EQU $F42D           ; byte: window_draw: 0 for the active look, 1 for the inactive one
W_DY        EQU $F42E           ; byte: W_MOVE's dy
W_FRONTT    EQU $F430           ; 16 bytes: not 0 for each owner in front of the window being moved
W_ROWF      EQU $F440           ; 24 bytes: not 0 for a row that may hold a dirty cell
W_VIEW      EQU $F458           ; word: the view the records are painted with
W_DX        EQU $F45E           ; word: W_MOVE's dx
W_VR        EQU $F460           ; W_DRAWVIEW's view rectangle, clamped: x0, x1 (words), y0, y1 (bytes)
W_BASE      EQU $F468           ; 4 bytes: an area saved (w_refill, W_MOVE's old area)
W_OCNT      EQU W_FRONTT        ; 16 bytes: W_GEN for each owner with a rectangle in the batch (W_MOVE's table is free then;
                                ; a stale byte that happens to equal W_GEN only costs a look through the batch)
W_RL        EQU $E800           ; rectangle records (W_SAVE): owner, c0, c1, r0, r1.  IY = the next free one while scanning
W_OPENAT    EQU $EFC0           ; 32 words: the record last made or extended for each first column
W_RBATCH    EQU 365             ; a batch is painted at a row start once it holds this many (14.4)

    ASSERT W_BASE + 4 <= $F470 && (W_ROWF >> 8) == ((W_ROWF + 23) >> 8) && W_CHI == W_CLO + 1
    ASSERT W_RL + 5 * 396 <= W_OPENAT && (W_OPENAT & $FF) == $C0 && (W_SLOTS & $FF) == 0 && (W_MAP & $FF) == 0
    ASSERT (W_OCNT >> 8) == (W_SLOTS >> 8) && W_MODAL == W_SLOTS + 32

; ===========================================================================================================================
; W_INIT (14.4): the desk and the bar in the kernel arena, the root, the map all dirty.  Carry when the kernel arena is full.
; Preserves IX.  Clobbers AF, BC, DE, HL; GA.
W_INIT:
    push ix
    ld hl,(K_CURA)
    push hl
    ld hl,K_KARENA
    ld (K_CURA),hl
    ld hl,CL_Desk
    call K_NEW
    jr c,.out
    ld (ix+View_w+1),2          ; 512
    ld (ix+View_h),192
    ld (W_SLOTS),ix
    ld hl,W_SLOTS+2             ; the other slots and W_MODAL
    ld b,32
    xor a
    call w_fill
    ld hl,CL_MenuBar
    call K_NEW
    jr c,.out
    ld (ix+View_w+1),2
    ld (ix+View_h),8
    ld (W_SLOTS+30),ix
    push ix
    pop de
    ld ix,(W_SLOTS)
    call K_ADDCHILD
    push ix
    pop de
    call K_SETROOT              ; also clears K_FSCOPE
    ld hl,W_MAP                 ; the map: row 0 the bar's, the rest the desk's; then every cell is damaged
    ld b,32
    ld a,$0F
    call w_fill
    ex de,hl
    ld hl,W_MAP+768
    call k_zero
    ld hl,32
    ld (W_CLO),hl               ; no columns yet: W_CLO = 32, W_CHI = 0
    call W_INVALV               ; (IX = the desk: the whole screen)
    call w_openz
    or a
.out:
    pop hl
    ld (K_CURA),hl
    pop ix
    ret

; w_openz: W_OPENAT cleared (W_UPDATE trusts a pointer there only by its range; the menus' save-under can leave garbage in
; it).  w_fill: B bytes from HL become A.  Clobber F, B, HL (w_openz: A too).
w_openz:
    ld hl,W_OPENAT
    ld b,64
    xor a
w_fill:
    ld (hl),a
    inc hl
    djnz w_fill
    ret

; w_band: D = y, E = h: GA = (0, y, 512, h).  w_bandfill: A = the op too: G_FILL of it.  Clobber HL (w_bandfill: all).
w_bandfill:
    ld (GOP),a
    call w_band
    jp G_FILL
w_band:
    ld hl,0
    ld (GA),hl
    ld l,d
    ld (GA+2),hl
    ld l,e
    ld (GA+6),hl
    ld hl,512
    ld (GA+4),hl
    ret

; ===========================================================================================================================
; W_FRONT: HL = the front window (the bar's next sibling), 0 when none is open.  Clobbers AF.
; w_hlnext / w_hlparent: HL = a view -> HL = its View_next / View_parent.  w_hlfld: HL = the word at HL + A.  Clobber AF.
w_hlparent:
    ld a,View_parent
    jr w_hlfld
W_FRONT:
    ld hl,(W_SLOTS+30)
w_hlnext:
    ld a,View_next
w_hlfld:
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

; w_isfront: Z when IX is the front window.  w_cpix: Z when HL = IX.  HL = HL - IX, DE = IX (ADD HL,DE gives HL back).
; Carry clear when Z.  Clobber AF.
w_isfront:
    call W_FRONT
w_cpix:
    push ix
    pop de
    or a
    sbc hl,de
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; W_OPEN (14.4): IX = a window.  Carry (nothing changed) when it is open, its rectangle is not valid, a dialog is open or no
; slot is free.  Preserves IX.  Clobbers AF, BC, DE, HL.
W_OPEN:
    ld a,(ix+Window_slot)
    or a
    jr nz,w_fail
    call w_valid
    ret c
    ld a,(W_MODAL+1)
    or a
    jr nz,w_fail
    ld hl,W_SLOTS+3             ; the lowest free slot, by the high bytes
    ld b,14
.find:
    ld a,(hl)
    or a
    jr z,.got
    inc l
    inc l
    djnz .find
    jr w_fail
.got:
    push ix
    pop de
    ld (hl),d
    dec l
    ld (hl),e
    ld a,l
    rra                         ; the slot (carry clear)
    ld (ix+Window_slot),a
    call W_FRONT
    call w_infront
    call w_isdlg                ; a Dialog is modal (17.2)
    ret nz
    ld (W_MODAL),ix
    ret

; w_valid: IX's rectangle; w_validxy: HL = x, DE = y with IX's w and h.  Carry when it breaks section 3.  Preserve HL, DE;
; clobber AF, BC.
w_valid:
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    ld e,(ix+View_y)
    ld d,0
w_validxy:
    ld a,l
    or (ix+View_w)
    and $0F
    jr nz,w_fail                ; x and w: multiples of 16
    ld a,e
    or (ix+View_h)
    and 7
    or d
    jr nz,w_fail                ; y and h: multiples of 8; y < 256
    ld a,e
    cp 8
    jr c,w_fail                 ; y >= 8
    ld a,(ix+View_h)
    cp 16
    jr c,w_fail                 ; h >= 16
    add a,e
    jr c,w_fail
    cp 193
    jr nc,w_fail                ; y + h <= 192
    ld c,(ix+View_w)
    ld b,(ix+View_w+1)
    ld a,c
    sub 48
    ld a,b
    sbc a,0
    jr c,w_fail                 ; w >= 48
    push hl
    add hl,bc
    dec hl                      ; x + w - 1 (17 bits with the carry): under 512
    ld a,h
    rra
    or a
    pop hl
    ret z
w_fail:
    scf
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; W_RAISE (14.4): IX = a window.  Carry when it is not open, or a modal dialog is open and this is not it (17.2: the dialog
; is always in front); nothing when it is in front.  Preserves IX.  Clobbers AF, BC, DE, HL.
W_RAISE:
    ld a,(ix+Window_slot)
    sub 1
    ret c
    call w_isfront
    ret z                       ; in front already (carry clear)
    add hl,de                   ; HL = the front window
    ld a,(W_MODAL+1)            ; a view is never in page 0: the high byte tells
    or a
    jr nz,w_fail
    push hl
    call K_UNLINK
    pop hl
; w_infront: IX = a window not in the desk's list, HL = the front window: IX goes in front of it; the map rule; activation.
w_infront:
    push hl
    call w_tofront
    call w_cells
    ld de,rr_take
    call w_rows
    pop hl
    push ix
    pop de
; w_activate (14.4): HL = old, DE = f (windows; old may be 0, f only when old is).  Carry clear.  Preserves IX.  Clobbers AF, BC,
; DE, HL.
w_activate:
    or a
    sbc hl,de
    ret z                       ; the same window, or none
    add hl,de
    push ix
    push de                     ; f, then old: their title rows, at the end
    push hl
    push de                     ; f
    ld a,h
    or a
    jr z,.scope                 ; no old window
    push hl
    pop ix
    call w_funder               ; old's Window_focus = K_FOCUS when that is under old, else 0
    ld hl,(K_FOCUS)
    jr c,.keep
    ld hl,0
.keep:
    ld (ix+Window_focus),l
    ld (ix+Window_focus+1),h
.scope:
    pop ix                      ; f
    ld (K_FSCOPE),ix
    ld e,(ix+Window_focus)
    ld d,(ix+Window_focus+1)
    ld a,d
    sub 1                       ; carry: f has no focus of its own
    call nc,K_SETFOCUS          ; carry: refused
    jr nc,.titles
    ld de,0
    call K_SETFOCUS
    call K_FOCUSNEXT
.titles:
    pop hl
    call w_titledmg
    pop hl
    call w_titledmg
    pop ix
    or a
    ret

; w_titledmg: HL = a window or 0: when it is open, the cells of its title row it owns become dirty.  Clobbers AF, BC, DE, HL, IX.
w_titledmg:
    ld a,h
    or a
    ret z
    push hl
    pop ix
    ld a,(ix+Window_slot)
    or a
    ret z
    call w_cells
    ld hl,W_AREA+2
    ld a,(hl)
    inc a
    inc l
    ld (hl),a                   ; one row
    ld de,rr_title
    jp w_rows

; ---------------------------------------------------------------------------------------------------------------------------
; W_CLOSE (14.4): IX = a window.  Carry when it is not open.  Preserves IX.  Clobbers AF, BC, DE, HL.
W_CLOSE:
    ld a,(ix+Window_slot)
    sub 1
    ret c
    call w_funder
    ld de,0
    call c,K_SETFOCUS
    ld hl,(K_CAPTURE)
    call w_under
    jr nc,.nocap
    ld hl,0
    ld (K_CAPTURE),hl
.nocap:
    call w_isfront
    push af                     ; Z: it was in front
    call K_UNLINK
    call w_cells
    ld a,(ix+Window_slot)
    add a,a
    ld l,a
    ld h,W_SLOTS >> 8
    xor a
    ld (hl),a
    inc l
    ld (hl),a
    ld (ix+Window_slot),a
    ld de,rr_unown
    call w_rows
    call w_refill
    push ix
    pop de
    ld hl,W_MODAL               ; the dialog closes: no modal (17.2)
    call k_clrptr
    pop af
    jr nz,.done
    call W_FRONT
    ex de,hl
    ld hl,0
    ld (K_FSCOPE),hl            ; no scope until the next window is activated (none when this was the last)
    jp w_activate
.done:
    or a
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; W_MOVE (14.4): IX = a window, HL = x, DE = y.  Carry (nothing changed) when it is not open or the new rectangle is not valid.
; Preserves IX.  Clobbers AF, BC, DE, HL.
W_MOVE:
    ld a,(ix+Window_slot)
    sub 1
    ret c
    call w_validxy
    ret c
    ld c,(ix+View_x)
    ld b,(ix+View_x+1)
    sbc hl,bc                   ; (carry clear)
    ld (W_DX),hl
    ld a,e
    sub (ix+View_y)
    ld (W_DY),a
    or h
    or l
    ret z                       ; where it is already (carry clear)
    call w_cells                ; (a) the old area: the cells it owns become the desk's, pending
    call w_savearea
    ld de,rr_unown
    call w_rows
    call w_offset               ; every view under it moves
    ld hl,W_FRONTT              ; (b) the windows in front of it
    ld b,16
    xor a
    call w_fill
    call W_FRONT
.front:
    call w_cpix
    jr z,.place
    add hl,de
    push hl
    ld de,Window_slot
    add hl,de
    ld a,(hl)
    add a,W_FRONTT & $FF
    ld l,a
    ld h,W_FRONTT >> 8
    ld (hl),h                   ; not 0
    pop hl
    call w_hlnext
    jr .front
.place:                         ; its new cells, except those of windows in front, are its own and dirty
    call w_cells
    ld de,rr_place
    call w_rows
    jr w_refill2                ; (c) what is left pending in the old area goes to the windows behind, or the desk

; w_refill: the desk-owned (pending) cells of W_AREA (w_refill2: of W_BASE) go to the windows, front to back, first come first
; served.  Carry clear.  Clobbers AF, BC, DE, HL.
w_refill:
    call w_savearea
w_refill2:
    push ix
    call W_FRONT
.l:
    ld a,h
    or a
    jr z,.end
    push hl
    pop ix
    call w_cells
    call w_clip
    ld de,rr_fill0
    call w_rows
    ld l,(ix+View_next)
    ld h,(ix+View_next+1)
    jr .l
.end:
    pop ix
    ret

; w_savearea: W_BASE = W_AREA.  Clobbers BC, DE, HL.
w_savearea:
    ld hl,W_AREA
    ld de,W_BASE
    ld bc,4
    ldir
    ret

; w_clip: W_AREA = W_AREA intersected with W_BASE.  Clobbers AF, B, DE, HL.
w_clip:
    ld hl,W_AREA
    ld de,W_BASE
    ld b,2
.l:
    ld a,(de)
    cp (hl)
    jr c,.lo
    ld (hl),a                   ; the larger start
.lo:
    inc l
    inc e
    ld a,(de)
    cp (hl)
    jr nc,.hi
    ld (hl),a                   ; the smaller end
.hi:
    inc l
    inc e
    djnz .l
    ret
    ASSERT (W_AREA >> 8) == ((W_AREA + 3) >> 8) && (W_BASE >> 8) == ((W_BASE + 3) >> 8)

; w_offset: IX and every view under it get View_x += W_DX, View_y += W_DY (4 bytes of stack a level).  Clobbers AF, DE, HL.
w_offset:
    ld hl,(W_DX)
    ld e,(ix+View_x)
    ld d,(ix+View_x+1)
    add hl,de
    ld (ix+View_x),l
    ld (ix+View_x+1),h
    ld a,(W_DY)
    add a,(ix+View_y)
    ld (ix+View_y),a
    ld l,(ix+View_child)
    ld h,(ix+View_child+1)
.kids:
    ld a,h
    or a
    ret z
    push ix
    push hl
    pop ix
    call w_offset
    ld l,(ix+View_next)
    ld h,(ix+View_next+1)
    pop ix
    jr .kids

; w_cells: IX = a window (its rectangle is on the screen) -> W_AREA = its cells, W_PARAM = its slot.  Clobbers AF, BC, DE, HL.
w_cells:
    ld a,(ix+Window_slot)
    ld (W_PARAM),a
    ld c,(ix+View_x)
    ld b,(ix+View_x+1)
    ld l,(ix+View_w)
    ld h,(ix+View_w+1)
    add hl,bc
    dec hl
    call w_gax.cells
    ld (W_AREA),de
    ld c,(ix+View_y)
    ld a,c
    add a,(ix+View_h)
    dec a
    ld l,a
    call w_gay.cells
    ld (W_AREA+2),de
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

; w_under: HL = a view or 0 -> carry when it is IX or under IX.  w_funder: the same for K_FOCUS.  Clobber AF, DE, HL.
w_funder:
    ld hl,(K_FOCUS)
w_under:
    push ix
    pop de
.l:
    ld a,h
    or a
    ret z
    sbc hl,de
    scf
    ret z
    add hl,de
    call w_hlparent
    jr .l

; w_owner: IX = a view -> carry when it is not on the desktop (A = 0); else A = its owner: 0 the desk, 15 the bar, or the slot
; of the window it is in.  C = the flags of the views from it up to the owner's view, ORed.  Preserves IX.  Clobbers F, DE, HL.
w_owner:
    push ix
    ld c,0
    ld de,0                     ; DE = the view below the one in IX on the way up (0: none)
.up:
    ld a,(ix+View_flags)
    or c
    ld c,a
    ld l,(ix+View_parent)
    ld h,(ix+View_parent+1)
    ld a,h
    or a
    jr z,.root
    push ix
    pop de
    push hl
    pop ix
    jr .up
.root:                          ; IX = the root of its tree, which must be the desk
    push de
    ld hl,(W_SLOTS)
    call w_cpix
    pop de
    jr nz,.none
    ld a,d
    or a
    jr z,.out                   ; the desk itself: 0
    ld hl,(W_SLOTS+30)
    sbc hl,de
    ld a,15
    jr z,.out                   ; the bar, or a view under it
    ld hl,Window_slot
    add hl,de
    ld a,(hl)                   ; an open window's slot (carry clear)
    DB $DA                      ; JP C,nn: skips the two bytes below
.none:
    xor a
    scf
.out:
    pop ix
    ret

; ===========================================================================================================================
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
    ld a,d
    sub e                       ; A = columns, 1..32
    cp 17
    jr nc,w_invwide
; w_invcols: E = c0, A = columns (1..16), C = r0, B = rows (not 0): their dirty bits and row flags set.
w_invcols:
    push ix
    ld ix,w_setend
    ld d,a
    add a,a
    add a,d                     ; 3 bytes a cell in the chain
    neg
    add a,w_setend & $FF
    ld ixl,a                    ; IX = the chain's entry for this width (the chain is in one page)
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
w_invwide:                      ; over 16 columns: the first 16, then the rest
    push de
    push bc
    ld a,16
    call w_invcols
    pop bc
    pop de
    ld a,e
    add a,16
    ld e,a
    ld a,d
    sub e
    jr w_invcols

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
.cells:                         ; BC = the first pixel column, HL = the last (on the screen) -> E = c0, D = c1
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
.cells:                         ; C = the first pixel row, L = the last -> E = r0, D = r1
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
    jr z,w_min                  ; the last is on the screen or past it: at most the limit
    ld bc,1                     ; the last is negative: none
    ld h,b
    ld l,b
    ret
w_min:                          ; HL = min(HL, DE), unsigned.  Clobbers AF, DE.
    ld a,l
    sub e
    ld a,h
    sbc a,d
    ret c
    ex de,hl
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
    ld (W_DIRTY),a              ; (W_VMODE is 0 outside W_DRAWVIEW)
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
    ld h,2                      ; 512
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
    push iy
    pop hl
    ld (hl),e
    inc hl
    ld (hl),c
    inc hl
    ld (hl),d
    inc hl
    ld a,(W_ROW)
    ld (hl),a
    inc hl
    inc a
    ld (hl),a
    inc hl
    push hl
    pop iy
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
    call w_hlnext
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

; w_gavr: the clip (just written from a record) and GA = the clip intersected with W_VR (both on the screen and meeting): GA
; is worked out, then G_SETCLIP makes the clip from it.  Clobbers AF, BC, DE, HL.
w_gavr:
    ld hl,(GCLIP)
    ld de,(W_VR)
    call w_max
    ld (GA),hl
    push hl
    ld hl,(GCLIP+2)
    ld de,(W_VR+2)
    call w_min
    pop de
    or a
    sbc hl,de
    ld (GA+4),hl
    ld a,(GCLIP+4)              ; the rows fit a byte each (GA's high bytes are 0 from w_prec)
    ld hl,W_VR+4
    cp (hl)
    jr nc,.y0
    ld a,(hl)
.y0:
    ld (GA+2),a
    ld c,a
    inc hl
    ld a,(GCLIP+6)
    cp (hl)
    jr c,.y1
    ld a,(hl)
.y1:
    sub c
    ld (GA+6),a
    jp G_SETCLIP

; ===========================================================================================================================
; W_DRAWVIEW (14.4): IX = a view, drawn now where its top-level owner shows.  Preserves IX.  Clobbers AF, BC, DE, HL; GA, GOP.
W_DRAWVIEW:
    call w_owner
    ret c                       ; not on the desktop
    bit 1,c
    ret nz                      ; hidden, or inside a hidden view
    push ix
    push iy
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
    ld h,l
    inc h
    ld l,c
    ld (W_VR+4),hl              ; y0, y1 as bytes
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


; ===========================================================================================================================
; Draw methods (14.3).  GCLIP is set and the pointer shielded by the caller; each draws its whole rectangle.

; group_draw: Group's M_DRAW: M_DRAW to each child not hidden whose rectangle meets the clip.  Preserves IX.
group_draw:
    push ix
    ld l,(ix+View_child)
    ld h,(ix+View_child+1)
.l:
    ld a,h
    or a
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
    ld a,(ix+View_y)
    ld hl,GCLIP+6
    cp (hl)
    ret nc                      ; y >= y1
    add a,(ix+View_h)
    ret c                       ; y + h > 255
    ld c,a
    ld a,(GCLIP+4)
    cp c                        ; carry when y0 < y + h
    ret

    IFDEF LOOK_MAC
; desk_draw (docs/LOOK.md 9): the 25% grey, as text.  The 8x8 glyph of code 0 is the tile ($88, $22, ...; desk5.asm patches
; FONTP), DESK_STR is 64 zero bytes (RAM that boot clears and nothing writes), and G_TEXT8 draws the cells of character rows
; 1-23 that lie wholly inside the clip; the desk is drawn under a clip of whole cells.  Clobbers AF, BC, DE, HL; GA.
desk_draw:
    xor a
    call G_SETOP                ; opaque, ink = the tile's bits
    ld hl,DESK_STR
    ld (GA+4),hl
    ld hl,64
    ld (GA+6),hl
    ld l,h
    ld (GA),hl                  ; column 0
    inc l
    ld (GA+2),hl                ; row 1
.row:
    call G_TEXT8
    ld hl,GA+2
    inc (hl)
    ld a,(hl)
    cp 24
    jr c,.row
    ret

; window_draw (LOOK 3.2): (x, y, w, h) the window's rectangle; the face is (x, y, w - 2, h - 1), the shadow fills the last two
; columns and the last row.  Paper over the whole rectangle first (so the shadow's two corners are paper, which is what the
; 25% desk has there: LOOK 9), then the lines of W_LINES in ink (the stripes too when active), then the title, centred, in ink
; (active: on a paper gap in the stripes), then the children.  W_ACT = 0 active, 1 inactive (cw_draw reads it).
window_draw:
    call w_isfront              ; a window that W_FRONT returns is open
    ld a,h
    or l
    ld b,9                      ; active: the six lines and three stripes
    jr z,.act
    ld a,1
    ld b,6
.act:
    ld (W_ACT),a
    push bc
    ld a,1
    call G_SETOP
    call w_gaview
    call G_FILL
    xor a
    call G_SETOP
    pop bc
    ld de,W_LINES
.line:                          ; DE -> (dx, dy, dw, dh); a negative value v means v + w (dx, dw) or v + h (dy, dh)
    push bc
    ld c,(ix+View_w)
    ld b,(ix+View_w+1)
    ld a,(de)
    inc de
    call .rel
    ld a,l
    add a,(ix+View_x)
    ld l,a
    ld a,h
    adc a,(ix+View_x+1)
    ld h,a
    ld (GA),hl
    call .relh
    add a,(ix+View_y)
    ld (GA+2),a
    ld a,(de)
    inc de
    call .rel
    ld (GA+4),hl
    call .relh
    ld (GA+6),a
    push de
    call G_FILL
    pop de
    pop bc
    djnz .line
    ld l,(ix+Window_title)      ; the title: n' = the codes whose PROP6_W sum is <= w - 66
    ld h,(ix+Window_title+1)
    ld a,h
    or a
    jp z,group_draw
    ld b,(hl)                   ; n
    inc hl
    ld (GA+4),hl
    push hl
    ld l,(ix+View_w)
    ld h,(ix+View_w+1)
    ld de,-66
    add hl,de
    ex de,hl                    ; DE = the room
    pop hl                      ; HL = the codes
    ld c,0                      ; C = the codes that fit
    bit 7,d
    jr nz,.tn
    inc b
    jr .next
.tw:
    push hl
    ld l,(hl)
    ld h,PROP6_W >> 8
    ld l,(hl)
    ld a,e
    sub l
    ld e,a
    pop hl
    jr nc,.fits
    dec d
    jp m,.tn
.fits:
    inc c
    inc hl
.next:
    djnz .tw
.tn:
    ld l,c
    ld h,0
    ld (GA+6),hl
    call G_TEXTW                ; HL = tw
    ld b,h
    ld c,l
    ld l,(ix+View_w)
    ld h,(ix+View_w+1)
    dec hl
    dec hl
    or a
    sbc hl,bc
    srl h
    rr l
    ld e,(ix+View_x)
    ld d,(ix+View_x+1)
    add hl,de                   ; HL = tx = x + (w - 2 - tw) / 2
    ld a,(W_ACT)
    or a
    jr nz,.text                 ; inactive: no stripes, no gap
    ld a,b
    or c
    jr z,.text                  ; no codes: no gap
    push hl
    ld de,(GA+4)
    push de
    ld de,(GA+6)
    push de
    ld de,-6
    add hl,de
    ld (GA),hl                  ; the gap: (tx - 6, y + 1, tw + 12, 7), paper
    ld hl,12
    add hl,bc
    ld (GA+4),hl
    ld l,7
    ld (GA+6),hl                ; (tw + 12 < 256: H = 0)
    ld a,(ix+View_y)
    inc a
    ld (GA+2),a
    ld a,1
    call G_SETOP
    call G_FILL
    xor a
    call G_SETOP
    pop hl
    ld (GA+6),hl
    pop hl
    ld (GA+4),hl
    pop hl
.text:
    ld (GA),hl
    ld a,(ix+View_y)
    ld (GA+2),a
    call G_TEXTP
    jp group_draw
.relh:                          ; A = the next table byte, a negative one + h.  Clobbers F.
    ld a,(de)
    inc de
    or a
    ret p
    add a,(ix+View_h)
    ret
.rel:                           ; A = a table byte, BC = w -> HL = A sign-extended, + w when negative.  Clobbers F.
    ld l,a
    ld h,0
    or a
    ret p
    dec h
    add hl,bc
    ret

; W_LINES: window_draw's ink fills (dx, dy, dw, dh), each as .line reads it.  The first six always, the three stripes when active.
W_LINES:
    DB 0, 0, -2, 1              ; the top: (x, y, w - 2, 1)
    DB 0, 8, -2, 1              ; the separator: (x, y + 8, w - 2, 1)
    DB 0, -2, -2, 1             ; the bottom: (x, y + h - 2, w - 2, 1)
    DB 0, 0, 1, -1              ; the left side: (x, y, 1, h - 1)
    DB -3, 1, 3, -2             ; the right side and the shadow beside it: (x + w - 3, y + 1, 3, h - 2)
    DB 2, -1, -2, 1             ; the shadow under: (x + 2, y + h - 1, w - 2, 1)
    DB 2, 2, -6, 1              ; the stripes: (x + 2, y + r, w - 6, 1), r = 2, 4, 6
    DB 2, 4, -6, 1
    DB 2, 6, -6, 1

    ELSE
; desk_draw: paper over (0, 8, 512, 184).
desk_draw:
    ld a,1
    ld de,8 * 256 + 184
    jp w_bandfill

; window_draw (14.3): frame, title bar, content, then the children.  The pixels are 14.3's; the order differs for speed: the
; title band and the content are filled whole-width (x, w are byte aligned, so no partial bytes), then the frame is drawn on top.
window_draw:
    call w_isfront              ; a window that W_FRONT returns is open
    ld a,h
    or l
    jr z,.title
    ld a,1
.title:
    ld (W_ACT),a                ; 0 active, 1 inactive
    call G_SETOP                ; rows y .. y + 8: ink when active, else paper
    call w_gaview
    ld hl,9
    ld (GA+6),hl
    call G_FILL
    ld a,1                      ; rows y + 9 .. y + h - 1: paper
    call G_SETOP
    ld hl,GA+2
    ld a,(hl)
    add a,9
    ld (hl),a
    ld a,(ix+View_h)
    sub 9
    ld (GA+6),a
    call G_FILL
    xor a                       ; the lines, in ink, each one G_FILL of GA with a field or two changed
    call G_SETOP
    ld hl,GA+6
    ld (hl),1
    ld a,(W_ACT)
    or a
    jr z,.bottom
    ld l,(GA+2) & $FF           ; inactive: the separator (y + 8) and the top line
    dec (hl)
    call G_FILL
    xor a
    call .yfill
.bottom:
    ld a,(ix+View_h)
    dec a
    call .yfill
    ld a,(ix+View_h)            ; the sides: one pixel wide, the whole height
    ld (GA+6),a
    ld hl,1
    ld (GA+4),hl
    xor a
    call .yfill
    call w_garight
    call G_FILL
    ld l,(ix+Window_title)
    ld h,(ix+Window_title+1)
    ld a,h
    or a
    jp z,group_draw
    ld b,(hl)                   ; n
    inc hl
    ld (GA+4),hl
    push hl
    ld l,(ix+View_w)
    ld h,(ix+View_w+1)
    ld de,-16
    add hl,de
    ex de,hl                    ; DE = the room (w - 16)
    pop hl                      ; HL = the codes
    ld c,0                      ; C = the codes that fit
    bit 7,d
    jr nz,.tn
    inc b
    jr .next
.tw:
    push hl
    ld l,(hl)
    ld h,PROP6_W >> 8
    ld l,(hl)
    ld a,e
    sub l
    ld e,a
    pop hl
    jr nc,.fits
    dec d
    jp m,.tn
.fits:
    inc c
    inc hl
.next:
    djnz .tw
.tn:
    ld l,c
    ld h,0
    ld (GA+6),hl
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    ld de,8
    add hl,de
    ld (GA),hl                  ; (x + 8, y): GA+2 is y since the sides
    ld a,(W_ACT)
    xor 1
    add a,a                     ; active: XOR, else SET
    call G_SETOP
    call G_TEXTP
    jp group_draw
.yfill:                         ; A = a row of the window: G_FILL of GA at that row
    add a,(ix+View_y)
    ld (GA+2),a
    jp G_FILL

    ENDIF

; w_garight: GA's x += IX's w - 1 (from a rectangle's left side to its right one).  Clobbers DE, HL.
w_garight:
    ld hl,(GA)
    ld e,(ix+View_w)
    ld d,(ix+View_w+1)
    add hl,de
    dec hl
    ld (GA),hl
    ret

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

; w_gastr0: HL = a string (a length byte, then the codes) or 0 (no text) -> GA+4 = the codes, GA+6 = their count.  w_gastr: the
; same for a string that is there.  HL = the count.  Clobber AF.
w_gatext:                       ; the same for the string of a Button or a Label in IX
    ld l,(ix+Button_text)
    ld h,(ix+Button_text+1)
    ASSERT Label_text == Button_text
w_gastr0:
    ld a,h
    or a
    jr nz,w_gastr
    ld hl,w_gastr.zero
w_gastr:
    ld a,(hl)
    inc hl
    ld (GA+4),hl
    ld l,a
.zero EQU $ + 1                 ; a zero byte: the empty string
    ld h,0
    ld (GA+6),hl
    ret

; w_shr3: HL = HL >> 3 (unsigned).  Clobbers F, B.
w_shr3:
    ld b,3
.l:
    srl h
    rr l
    djnz .l
    ret

; window_destroy: Window's M_DESTROY: closed first when open.
window_destroy:
    ld a,(ix+Window_slot)
    or a
    call nz,W_CLOSE
    jp view_destroy
