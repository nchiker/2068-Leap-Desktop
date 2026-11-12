; tk2.asm -- the toolkit (docs/TOOLKIT.md), slices T2 and T3: List and Field, TK_SETITEMS and TK_SETTEXT (interface: section 10).
; Pool code (mapping K), assembled by desk5 in chunk 1 after kernel1.asm (10.1: chunk 5 is full); the classes are in
; tk-classes.txt.  Kernel conventions (WINDOWS 4-5): M_DRAW opaque and deterministic; IX, IY and the alternate set preserved; no DI.

TK_LONE     EQU $F0ED           ; byte: 0 = a List's M_DRAW draws in full; else item + 1, drawn alone (10.3)
TK_LCV      EQU $F0EE           ; word: the List of the last E_DOWN a List took (0: none)
TK_LCI      EQU $F0F0           ; byte: its item
TK_LCF      EQU $F0F1           ; word: V_FRAMES then
TK_LY0      EQU $F0F3           ; ls_geom: the first line's top row
TK_LP       EQU $F0F4           ; the pitch (9 or 8)
TK_LN       EQU $F0F5           ; the lines shown
TK_CLIP     EQU $F0F6           ; 8 bytes: the caller's clip (tk_clipin / tk_clipout)
    ASSERT TK_CLIP + 8 <= $F100

LS_DIM      EQU 3               ; List / Field flags (10.1, 10.3)
LS_CELL     EQU 4
KC_DELETE   EQU 12

TK2_CODE:

; ---------------------------------------------------------------------------------------------------------------------------
; tk_clipin: the caller's clip saved, then the clip = it AND IX's inside (x + 1, y + 1, w - 2, h - 2) (10.2).  tk_clipout: the
; saved clip back.  Clobber AF, BC, DE, HL; GA.
tk_clipin:
    ld hl,GCLIP
    ld de,TK_CLIP
    ld bc,8
    ldir
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    inc hl
    ld de,(GCX0)
    call w_max
    ld (GA),hl                  ; x0 = max(cx0, x + 1)
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    ld e,(ix+View_w)
    ld d,(ix+View_w+1)
    add hl,de
    dec hl
    ld de,(GCX1)
    call w_min                  ; x1 = min(cx1, x + w - 1)
    ld de,(GA)
    or a
    sbc hl,de
    ld (GA+4),hl                ; x1 - x0 (G_SETCLIP makes a negative width empty)
    ld a,(ix+View_y)
    inc a
    ld hl,GCY0
    cp (hl)
    jr nc,.y0
    ld a,(hl)
.y0:
    ld c,a                      ; y0 = max(cy0, y + 1)
    ld a,(ix+View_y)
    add a,(ix+View_h)
    dec a
    ld hl,GCY1
    cp (hl)
    jr c,.y1
    ld a,(hl)                   ; y1 = min(cy1, y + h - 1)
.y1:
    ld h,0
    ld l,c
    ld (GA+2),hl
    sub c
    ld l,a
    sbc a,a
    ld h,a
    ld (GA+6),hl
    jp G_SETCLIP
tk_clipout:
    ld hl,TK_CLIP
    ld de,GCLIP
    ld bc,8
    ldir
    ret

; tk_dim: the disabled look (flags bit 3, 10.1): CLR fill (x + 1, r, w - 2, 1) for r = y + 2, y + 4, ... < y + h - 1.
tk_dim:
    bit LS_DIM,(ix+View_flags)
    ret z
    ld a,1
    call G_SETOP
    ld c,2
.l:
    ld a,c
    inc a
    cp (ix+View_h)
    ret nc
    push bc
    ld b,1
    ld a,(ix+View_w)
    sub 2
    ld d,a
    ld e,1
    call tk_fill
    pop bc
    inc c
    inc c
    jr .l

; tk_div: A / B -> C = the quotient, A = the remainder (B > 0).
tk_div:
    ld c,-1
.l:
    inc c
    sub b
    jr nc,.l
    add a,b
    ret

; ===========================================================================================================================
; List (10.3).

; ls_geom: TK_LY0, TK_LP, TK_LN for IX.  Clobbers AF, BC.
ls_geom:
    ld a,(ix+View_y)
    ld b,9
    inc a                       ; proportional: LY0 = y + 1
    bit LS_CELL,(ix+View_flags)
    jr z,.p
    add a,7
    and $F8                     ; cell lines: LY0 = 8 r0, r0 = (y + 8) >> 3
    ld b,8
.p:
    ld (TK_LY0),a
    ld c,a
    ld a,b
    ld (TK_LP),a
    ld a,(ix+View_y)
    add a,(ix+View_h)
    dec a
    sub c                       ; y + h - 1 - LY0
    jr nc,.d
    xor a
.d:
    call tk_div
    ld a,c
    ld (TK_LN),a
    ret

; ls_ly: A = a line k -> A = its top row LY0 + P k.  Clobbers F, C, HL.
ls_ly:
    ld c,a
    ld a,(TK_LY0)
    ld hl,TK_LP
    inc c
.l:
    dec c
    ret z
    add a,(hl)
    jr .l

; ls_band: A = a line -> GA = its band (x + 1, LY0 + P k, w - 2, P).  Clobbers AF, BC, DE, HL.
ls_band:
    call ls_ly
    sub (ix+View_y)
    ld c,a
    ld b,1
    ld a,(ix+View_w)
    sub 2
    ld d,a
    ld a,(TK_LP)
    ld e,a
    jp tk_ga

; ls_maxtop: A = max(0, count - n).  Clobbers F, C.
ls_maxtop:
    ld a,(TK_LN)
    ld c,a
    ld a,(ix+List_count)
    sub c
    ret nc
    xor a
    ret

; list_draw: in full, or the one line TK_LONE names (never with the disabled look).
list_draw:
    call ls_geom
    ld a,(TK_LONE)
    or a
    jr z,.full
    bit LS_DIM,(ix+View_flags)
    jr nz,.full
    dec a
    sub (ix+List_top)
    push af
    call tk_clipin
    ld a,1
    call G_SETOP
    pop af
    push af
    call ls_band
    call G_FILL
    pop af
    call ls_line
    jp tk_clipout
.full:
    call w_box
    call tk_clipin
    ld c,0
.line:
    ld a,c
    ld hl,TK_LN
    cp (hl)
    jr nc,.end
    push bc
    call ls_line
    pop bc
    inc c
    jr .line
.end:
    call tk_dim
    jp tk_clipout

; ls_line: A = a line k: item top + k, when there is one: its text, then its selection look.  Clobbers AF, BC, DE, HL; GA, GOP.
ls_line:
    ld c,a
    add a,(ix+List_top)
    ret c
    cp (ix+List_count)
    ret nc
    ld b,a
    push bc                     ; B = the item, C = the line
    ld l,(ix+List_items)
    ld h,(ix+List_items+1)
    ld e,a
    ld d,0
    add hl,de
    add hl,de
    ld a,(hl)
    inc hl
    ld h,(hl)
    ld l,a
    call w_gastr0               ; GA+4, GA+6 = its codes
    xor a
    call G_SETOP
    pop bc
    push bc
    ld a,c
    call ls_ly                  ; A = the line's top row
    bit LS_CELL,(ix+View_flags)
    jr nz,.cell
    sub (ix+View_y)
    ld c,a
    ld b,3
    call tk_ga0                 ; (x + 3, row)
    call G_TEXTP
    jr .sel
.cell:
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    ld de,9
    add hl,de
    call w_shr3                 ; c0 = (x + 9) >> 3 (B is free here)
    ld (GA),hl
    rrca
    rrca
    rrca
    and $1F
    ld l,a
    ld h,0
    ld (GA+2),hl                ; the cell row
    call G_TEXT8
.sel:
    pop bc
    ld a,b
    cp (ix+List_sel)
    ret nz
    ld a,c
    call ls_band
    call tk_focused
    ld a,2
    jr z,.inv
    xor a
    call G_SETOP
    jp G_FRAME                  ; not focused: the band outlined
.inv:
    call G_SETOP
    jp G_FILL                   ; focused: the band inverted

; ls_one: A = an item (or $FF): drawn alone when it is shown.  Needs ls_geom.  Clobbers AF, BC, DE, HL.
ls_one:
    ld c,a
    inc a
    ret z
    ld a,c
    sub (ix+List_top)
    ret c
    ld hl,TK_LN
    cp (hl)
    ret nc
    ld a,c
    inc a
    ld (TK_LONE),a
    call W_DRAWVIEW
    xor a
    ld (TK_LONE),a
    ret

; ls_focus / ls_blur: List's M_FOCUS / M_BLUR: the selected line drawn alone (the blur without the focus look).
ls_focus:
    call ls_geom
    ld a,(ix+List_sel)
    jr ls_one
ls_blur:
    ld hl,W2_BLUR
    inc (hl)
    call ls_focus
    ld hl,W2_BLUR
    dec (hl)
    ret

; ls_select: A = an item j: selected; top moved to show it (a full draw and the bar), else the old and the new line drawn alone.
; Needs ls_geom.  Clobbers AF, BC, DE, HL.
ls_select:
    ld c,(ix+List_sel)
    ld (ix+List_sel),a
    ld b,a
    cp (ix+List_top)
    jr c,.new                   ; j < top: top' = j
    ld a,(TK_LN)
    dec a
    ld d,a                      ; n - 1
    add a,(ix+List_top)
    cp b
    jr nc,.same                 ; j <= top + n - 1
    ld a,b
    sub d                       ; top' = j - n + 1
.new:
    cp (ix+List_top)
    jr z,.same
    ld (ix+List_top),a
    call W_DRAWVIEW
    jr ls_bar
.same:
    ld a,c
    cp b
    jr z,.one                   ; the same item: one line
    push bc
    call ls_one
    pop bc
.one:
    ld a,b
    jr ls_one

; ls_bar: the bar, when there is one, set from the List (10.3).  Needs ls_geom.  Clobbers AF, BC, DE, HL.
ls_bar:
    ld l,(ix+List_bar)
    ld h,(ix+List_bar+1)
    ld a,h
    or l
    ret z
    call ls_maxtop
    ld c,a
    ld a,(TK_LN)
    ld b,a
    ld a,(ix+List_top)
    push ix
    push hl
    pop ix
    call TK_SETBAR
    pop ix
    ret

; list_event (10.3).  The type and the key are read through DE.
list_event:
    ex de,hl
    ld a,(hl)
    inc hl
    ld h,(hl)                   ; H = data 1
    cp E_SCROLL
    jr z,.scroll
    cp E_DOWN
    jr z,.down
    cp E_UP
    jr z,.cons
    cp E_MOVE
    jr z,.move
    dec a
    jr nz,.no                   ; not E_KEY
    call ls_geom
    ld a,h
    cp K_DOWN
    jr z,.kdown
    cp K_UP
    jr z,.kup
    cp KC_ENTER
    jr nz,.no
    ld a,(ix+List_sel)
    inc a
    jp nz,b_post                ; ENTER with a selection: E_CMD
.no:
    or a
    ret
.move:
    ld hl,(K_CAPTURE)
    call w_cpix
    jr nz,.no
.cons:
    scf
    ret
.kdown:
    ld a,(ix+List_sel)
    inc a
    jr z,.ktop                  ; none: top
    cp (ix+List_count)
    jr nc,.cons
    jr .sel
.kup:
    ld a,(ix+List_sel)
    inc a
    jr z,.ktop
    sub 2
    jr c,.cons                  ; sel = 0
    jr .sel
.ktop:
    ld a,(ix+List_count)
    or a
    jr z,.cons                  ; empty
    ld a,(ix+List_top)
.sel:
    call ls_select
    scf
    ret
.scroll:
    call ls_geom
    call ls_maxtop
    cp h
    jr c,.top                   ; max(0, count - n) < the bar's value
    ld a,h
.top:
    cp (ix+List_top)
    jr z,.cons
    ld (ix+List_top),a
    call W_DRAWVIEW
    jr .cons
.down:
    call ls_geom
    call w_point                ; E = py
    ld a,(TK_LP)
    ld b,a
    ld a,(TK_LY0)
    ld c,a
    ld a,e
    sub c
    jr c,.miss
    call tk_div                 ; C = k
    ld a,c
    ld hl,TK_LN
    cp (hl)
    jr nc,.miss
    add a,(ix+List_top)
    jr c,.miss
    cp (ix+List_count)
    jr nc,.miss
    ld b,a                      ; B = j
    ld hl,(TK_LCV)
    call w_cpix
    jr nz,.first
    ld a,(TK_LCI)
    cp b
    jr nz,.first
    cp (ix+List_sel)
    jr nz,.first
    ld hl,(V_FRAMES)
    ld de,(TK_LCF)
    or a
    sbc hl,de
    ld de,21
    sbc hl,de
    jr nc,.first
    call .miss                  ; the second click: E_CMD, the memory cleared
    jp b_post
.first:
    ld (TK_LCV),ix
    ld a,b
    ld (TK_LCI),a
    ld hl,(V_FRAMES)
    ld (TK_LCF),hl
    jr .sel
.miss:
    ld hl,0
    ld (TK_LCV),hl
    scf
    ret

; TK_SETITEMS (10.3): IX = a List, HL = items, A = count.  Preserves IX.  Clobbers AF, BC, DE, HL.
TK_SETITEMS:
    ld (ix+List_items),l
    ld (ix+List_items+1),h
    ld (ix+List_count),a
    ld (ix+List_sel),$FF
    ld (ix+List_top),0
    ld hl,0
    ld (TK_LCV),hl
    call ls_geom
    call ls_bar
    jp W_DRAWVIEW

; ===========================================================================================================================
; Field (10.4).

; fd_buf: HL = buf.  fd_dy: A = ty - y = floor((h - 8) / 2), F clobbered.
fd_buf:
    ld l,(ix+Field_buf)
    ld h,(ix+Field_buf+1)
    ret
fd_dy:
    ld a,(ix+View_h)
    sub 8
    srl a
    ret

; fd_tw: B = i, C = j -> DE = tw(i, j) (0 when j <= i).  Preserves BC.  Clobbers AF, HL.
fd_tw:
    ld de,0
    ld a,c
    sub b
    ret c
    ret z
    push bc
    ld c,a
    call fd_buf
    inc hl
    ld a,b
    add a,l
    ld l,a
    jr nc,.nc
    inc h
.nc:
    ld b,c
.l:
    ld a,(hl)
    inc hl
    push hl
    ld l,a
    ld h,PROP6_W >> 8
    ld a,(hl)
    add a,e
    ld e,a
    jr nc,.n
    inc d
.n:
    pop hl
    djnz .l
    pop bc
    ret

; fd_over: DE = a width -> carry when it is more than w - 5.  Clobbers AF, BC, HL.
fd_over:
    ld l,(ix+View_w)
    ld h,(ix+View_w+1)
    ld bc,-5
    add hl,bc
    or a
    sbc hl,de
    ret

; fd_adjust: first adjusted (10.4).  Clobbers AF, BC, DE, HL.
fd_adjust:
    ld a,(ix+Field_caret)
    cp (ix+Field_first)
    jr nc,.r2
    ld (ix+Field_first),a       ; 1. first = caret when first > caret
.r2:
    ld b,(ix+Field_first)
    ld c,(ix+Field_caret)
    call fd_tw
    call fd_over
    jr nc,.r3
    inc (ix+Field_first)        ; 2. while tw(first, caret) > w - 5
    jr .r2
.r3:
    ld a,(ix+Field_first)
    or a
    ret z
    dec a
    ld b,a
    call fd_buf
    ld c,(hl)
    call fd_tw
    call fd_over
    ret c
    dec (ix+Field_first)        ; 3. while first > 0 and tw(first - 1, L) <= w - 5
    jr .r3

; field_draw (10.4).
field_draw:
    call w_box                  ; GOP = SET
    call tk_clipin
    call fd_buf
    ld a,(hl)
    inc hl
    ld e,(ix+Field_first)
    ld d,0
    add hl,de
    ld (GA+4),hl
    sub e
    jr nc,.n
    xor a
.n:
    ld l,a
    ld h,d
    ld (GA+6),hl                ; codes first..L - 1
    call fd_dy
    ld c,a
    ld b,3
    call tk_ga0                 ; at (x + 3, ty)
    call G_TEXTP
    call tk_focused
    jr nz,.dim
    ld b,(ix+Field_first)
    ld c,(ix+Field_caret)
    call fd_tw                  ; tw <= w - 5: a byte
    ld a,e
    add a,2
    ld b,a
    call fd_dy
    ld c,a
    ld de,1 * 256 + 9
    call tk_fill                ; the caret: (x + 2 + tw(first, caret), ty, 1, 9)
.dim:
    call tk_dim
    jp tk_clipout

; field_event (10.4).
field_event:
    ld hl,(K_EV)                ; L = the type, H = data 1
    ld a,l
    cp E_DOWN
    jp z,.down
    cp E_UP
    jr z,.cons
    cp E_MOVE
    jr z,.move
    dec a
    jr nz,.no                   ; not E_KEY
    ld c,h
    ld a,h
    cp KC_ENTER
    jp z,b_post
    call fd_buf
    ld b,(hl)                   ; B = L
    cp KC_DELETE
    jr z,.del
    cp K_LEFT
    jr z,.left
    cp K_RIGHT
    jr z,.right
    cp 32
    jr c,.no
    cp 127
    jr c,.ins
.no:
    or a
    ret
.move:
    ld hl,(K_CAPTURE)
    call w_cpix
    jr nz,.no
.cons:
    scf
    ret
.left:
    ld a,(ix+Field_caret)
    or a
    jr z,.cons
    dec (ix+Field_caret)
    jr .chg
.right:
    ld a,(ix+Field_caret)
    cp b
    jr nc,.cons
    inc (ix+Field_caret)
    jr .chg
.ins:
    ld a,b
    cp (ix+Field_cap)
    jr nc,.cons                 ; full
    inc (hl)
    ld e,b
    ld d,0
    add hl,de                   ; HL -> code L - 1 (buf when L = 0)
    ld d,h
    ld e,l
    inc de
    ld a,b
    sub (ix+Field_caret)        ; the codes after the caret
    push bc
    ld c,a
    ld b,0
    jr z,.put
    lddr
.put:
    pop bc
    ld a,c
    ld (de),a                   ; DE -> code caret
    inc (ix+Field_caret)
    jr .chg
.del:
    ld a,(ix+Field_caret)
    or a
    jr z,.cons
    dec (hl)
    ld e,a
    ld d,0
    add hl,de
    ld d,h
    ld e,l                      ; DE -> code caret - 1
    inc hl
    ld a,b
    sub (ix+Field_caret)
    ld c,a
    ld b,0
    jr z,.d0
    ldir
.d0:
    dec (ix+Field_caret)
.chg:
    call fd_adjust
    call W_DRAWVIEW
    scf
    ret
.down:                          ; the caret before the first code whose middle is right of px
    call w_point                ; BC = px
    push bc
    ld b,3
    call tk_xy
    ex de,hl                    ; DE = x + 3
    pop hl
    or a
    sbc hl,de
    push hl                     ; r = px - (x + 3)
    call fd_buf
    ld b,(hl)
    ld a,(ix+Field_first)
    ld c,a
    inc hl
    ld e,a
    ld d,0
    add hl,de
    ex de,hl                    ; DE -> code first
    pop hl
.walk:                          ; HL = r = px - pen, C = k
    ld a,c
    cp b
    jr nc,.at                   ; k = L
    bit 7,h
    jr nz,.at                   ; r < 0
    ld a,(de)
    inc de
    push hl
    ld l,a
    ld h,PROP6_W >> 8
    ld a,(hl)                   ; a = the advance
    pop hl
    push af
    srl a
    inc h
    dec h
    jr nz,.ge                   ; r >= 256
    cp l
    jr z,.ge
    jr c,.ge
    pop af
    jr .at                      ; r < floor(a / 2)
.ge:
    pop af
    push de
    ld e,a
    ld d,0
    or a
    sbc hl,de
    pop de
    inc c
    jr .walk
.at:
    ld (ix+Field_caret),c
    jr .chg

; TK_SETTEXT (10.4): IX = a Field, HL = a string.  Preserves IX.  Clobbers AF, BC, DE, HL.
TK_SETTEXT:
    ld a,(hl)
    cp (ix+Field_cap)
    jr c,.ok
    ld a,(ix+Field_cap)
.ok:
    ld (ix+Field_caret),a
    ld (ix+Field_first),0
    push hl
    call fd_buf
    ld (hl),a
    inc hl
    ex de,hl
    pop hl
    inc hl
    ld c,a
    ld b,0
    or a
    jr z,.e
    ldir
.e:
    call fd_adjust
    jp W_DRAWVIEW
TK2_END:
