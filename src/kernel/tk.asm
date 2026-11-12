; tk.asm -- the toolkit (docs/TOOLKIT.md), slice T1: Check (and radio) and VScroll.  Pool code (mapping K), assembled by step 5
; cartridges in chunk 5 after the kernel, with tk-classes.inc.  Kernel conventions (WINDOWS 4-5): M_DRAW opaque and
; deterministic; IX, IY and the alternate set preserved; no DI.  Uses the cartridge's V_FRAMES (9.1).

E_SCROLL    EQU 11              ; VScroll -> its target, through M_EVENT (9.1)
TK_EV       EQU $F0D8           ; 4 bytes: the E_SCROLL record
TK_NEXT     EQU $F0DC           ; word: V_FRAMES of the next repeat
TK_PX       EQU $F0DE           ; word: the last point while tracking
TK_PY       EQU $F0E0
TK_PART     EQU $F0E1           ; 1 up, 2 down, 3 page up, 4 page down, 5 thumb
TK_DIR      EQU $F0E2           ; 0 decrease, 1 increase
TK_AMT      EQU $F0E3           ; the step: 1 or the page
TK_GRAB     EQU $F0E4           ; py - ty at the press on the thumb
TK_TL       EQU $F0E5           ; vs_geom: the track's rows
TK_TH       EQU $F0E6           ; the thumb's rows (0: none)
TK_TY       EQU $F0E7           ; the thumb's top row

CHK_CHECKED EQU 3               ; Check flags (9.2)
CHK_RADIO   EQU 4
CHK_PRESSED EQU 5

TK_CODE:

; tk_ga: GA = (x + B, y + C, D, E), x and y IX's.  tk_fill: and G_FILL.  Clobber AF, HL (tk_fill: and BC, DE).
tk_fill:
    call tk_ga
    jp G_FILL
tk_ga:
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    ld a,b
    add a,l
    ld l,a
    adc a,h
    sub l
    ld h,a
    ld (GA),hl
    ld a,(ix+View_y)
    add a,c
    ld l,a
    ld h,0
    ld (GA+2),hl
    ld l,d
    ld (GA+4),hl
    ld l,e
    ld (GA+6),hl
    ret

; tk_focused: Z when IX is K_FOCUS and not being drawn by button_blur (the focus look).  Clobbers AF, DE, HL.
tk_focused:
    ld hl,(K_FOCUS)
    call w_cpix
    ret nz
    ld a,(W2_BLUR)
    or a
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; check_draw (9.2).
check_draw:
    call w_clear
    xor a
    call G_SETOP
    ld bc,0
    ld de,13 * 256 + 8
    call tk_ga
    call G_FRAME                ; the box
    bit CHK_CHECKED,(ix+View_flags)
    jr z,.corners
    bit CHK_RADIO,(ix+View_flags)
    jr nz,.dot
    ld bc,3 * 256 + 2           ; the X: (3, 2)-(9, 5), (3, 5)-(9, 2)
    ld de,9 * 256 + 5
    call tk_line
    ld bc,3 * 256 + 5
    ld de,9 * 256 + 2
    call tk_line
    jr .corners
.dot:
    ld bc,4 * 256 + 3
    ld de,5 * 256 + 2
    call tk_fill
.corners:
    bit CHK_RADIO,(ix+View_flags)
    jr z,.text
    ld a,1
    call G_SETOP
    ld bc,0
    call tk_dot
    ld bc,12 * 256
    call tk_dot
    ld bc,7
    call tk_dot
    ld bc,12 * 256 + 7
    call tk_dot
    xor a
    call G_SETOP
.text:
    call w_gatext
    call G_TEXTW                ; HL = tw
    push hl
    ld bc,17 * 256
    ld de,0
    call tk_ga0                 ; GA = (x + 17, y), the string kept
    call G_TEXTP
    call tk_focused
    pop bc                      ; BC = tw (flags kept)
    jr nz,.press
    push bc
    ld bc,17 * 256 + 8
    call tk_xy                  ; HL = x + 17, DE = y + 8
    pop bc
    call G_HLINE
.press:
    bit CHK_PRESSED,(ix+View_flags)
    ret z
    ld a,2
    call G_SETOP
    ld bc,1 * 256 + 1
    ld de,11 * 256 + 6
    jp tk_fill

; tk_dot: one pixel at (x + B, y + C) in the op.  tk_line: the line (x + B, y + C)-(x + D, y + E).
tk_dot:
    ld de,1 * 256 + 1
    jp tk_fill
tk_line:
    call tk_ga
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    ld de,(GA+4)
    add hl,de
    ld (GA+4),hl
    ld a,(ix+View_y)
    ld hl,GA+6
    add a,(hl)
    ld (hl),a
    jp G_LINE

; tk_ga0: GA x, y only = (x + B, y + C) (GA+4 / +6 kept).  tk_xy: HL = x + B, DE = y + C.  Clobber AF, DE, HL.
tk_ga0:
    call tk_xy
    ld (GA),hl
    ld (GA+2),de
    ret
tk_xy:
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    ld e,b
    ld d,0
    add hl,de
    ld a,(ix+View_y)
    add a,c
    ld e,a
    ret

; check_event (9.2).
check_event:
    ld hl,(K_EV)                ; L = the type, H = data 1
    ld a,l
    cp E_DOWN
    jr z,.down
    cp E_UP
    jr z,.up
    cp E_MOVE
    jr z,.move
    dec a
    jr nz,.no                   ; not E_KEY
    ld a,h
    cp KC_SPACE
    jr z,chk_act
.no:
    or a
    ret
.move:
    ld hl,(K_CAPTURE)
    call w_cpix
    jr nz,.no
    call w_point
    call view_hittest           ; carry: inside
    sbc a,a
    xor (ix+View_flags)
    and 1 << CHK_PRESSED
    jr z,.cons
    xor (ix+View_flags)
    ld (ix+View_flags),a
    jr .draw
.down:
    set CHK_PRESSED,(ix+View_flags)
.draw:
    call W_DRAWVIEW
.cons:
    scf
    ret
.up:
    bit CHK_PRESSED,(ix+View_flags)
    jr z,.cons
    res CHK_PRESSED,(ix+View_flags)
; chk_act: activate (9.2): toggle, or the radio set and its checked siblings cleared; drawn; E_CMD posted.  Carry set.
chk_act:
    bit CHK_RADIO,(ix+View_flags)
    jr nz,.radio
    ld a,(ix+View_flags)
    xor 1 << CHK_CHECKED
    ld (ix+View_flags),a
    jr .done
.radio:
    push ix
    ld l,(ix+View_parent)
    ld h,(ix+View_parent+1)
    ld a,h
    or l
    jr z,.end
    ld de,View_child
    add hl,de
    ld a,(hl)
    inc hl
    ld h,(hl)
    ld l,a
.sib:
    ld a,h
    or l
    jr z,.end
    push hl
    pop ix
    ld a,(ix+0)
    cp LOW CL_Check
    jr nz,.next
    ld a,(ix+1)
    cp HIGH CL_Check
    jr nz,.next
    ld a,(ix+View_flags)
    and (1 << CHK_RADIO) | (1 << CHK_CHECKED)
    cp (1 << CHK_RADIO) | (1 << CHK_CHECKED)
    jr nz,.next
    res CHK_CHECKED,(ix+View_flags)
    call W_DRAWVIEW
.next:
    ld l,(ix+View_next)
    ld h,(ix+View_next+1)
    jr .sib
.end:
    pop ix
    set CHK_CHECKED,(ix+View_flags)
.done:
    call W_DRAWVIEW
    jp b_post

; ---------------------------------------------------------------------------------------------------------------------------
; vs_geom (9.3): TK_TL, TK_TH (0: no thumb), TK_TY for IX.  Clobbers AF, BC, DE, HL.
vs_geom:
    ld a,(ix+View_h)
    sub 20
    ld (TK_TL),a
    ld a,(ix+VScroll_max)
    or a
    jr nz,.thumb
    ld (TK_TH),a
    ld a,(ix+View_y)
    add a,10
    ld (TK_TY),a
    ret
.thumb:
    ld a,(TK_TL)                ; th = tl page / (max + page), at least 6, at most tl
    ld l,a
    ld h,0
    ld e,(ix+VScroll_page)
    ld d,h
    call mul16
    ld a,(ix+VScroll_page)
    add a,(ix+VScroll_max)
    ld c,a
    ld a,0
    adc a,a
    ld b,a
    call div3216
    ld a,h
    or a
    jr nz,.big
    ld a,l
    cp 6
    jr nc,.ge
    ld a,6
.ge:
    ld b,a
    ld a,(TK_TL)
    cp b
    jr c,.th
    ld a,b
    jr .th
.big:
    ld a,(TK_TL)
.th:
    ld (TK_TH),a
    ld b,a                      ; ty = y + 10 + (tl - th) value / max
    ld a,(TK_TL)
    sub b
    ld l,a
    ld h,0
    ld e,(ix+VScroll_value)
    ld d,h
    call mul16
    ld c,(ix+VScroll_max)
    ld b,0
    call div3216
    ld a,(ix+View_y)
    add a,10
    add a,l
    ld (TK_TY),a
    ret

; vs_draw (9.3).
vs_draw:
    call vs_geom
    call w_box                  ; paper, frame, GOP = SET
    ld bc,9
    ld d,(ix+View_w)
    ld e,1
    call tk_fill                ; the up box's line
    ld a,(ix+View_h)
    sub 10
    ld c,a
    ld b,0
    ld d,(ix+View_w)
    ld e,1
    call tk_fill                ; the down box's line
    ld a,(ix+View_w)            ; the arrows: rows k = 0, 1, 2 of 1, 5, 9 pixels, centred on w / 2
    srl a
    ld b,a
    ld c,3
    ld d,1
.arrow:
    push bc
    push de
    ld e,1
    call tk_fill                ; up: (cx - 2k, y + 3 + k)
    pop de
    pop bc
    push bc
    push de
    ld a,(ix+View_h)
    sub 1
    sub c                       ; down: y + h - 4 - k = y + h - 1 - (3 + k)
    ld c,a
    ld e,1
    call tk_fill
    pop de
    pop bc
    dec b
    dec b
    inc c
    ld a,d
    add a,4
    ld d,a
    cp 13
    jr c,.arrow
    ld a,(TK_TH)                ; the thumb
    or a
    jr z,.press
    ld e,a
    ld a,(TK_TY)
    sub (ix+View_y)
    ld c,a
    ld b,2
    ld a,(ix+View_w)
    sub 4
    ld d,a
    call tk_fill
.press:
    ld a,(ix+VScroll_press)
    or a
    ret z
    ld a,2
    call G_SETOP
    ld a,(ix+VScroll_press)
    ld c,1
    dec a
    jr z,.pr
    ld a,(ix+View_h)
    sub 9
    ld c,a
.pr:
    ld b,1
    ld a,(ix+View_w)
    sub 2
    ld d,a
    ld e,8
    jp tk_fill

; vs_event (9.3): E_DOWN starts tracking, a loop until E_UP.  Other events are not consumed.
vs_event:
    ld a,(K_EV)
    cp E_DOWN
    jr z,.down
    or a
    ret
.down:
    call vs_point
    call vs_geom
    ld a,(TK_PY)
    ld e,a
    ld a,(ix+View_y)            ; the part (9.3)
    add a,10
    cp e
    ld bc,1 * 256 + 0           ; B = part, C = dir
    jr z,.notup
    jr nc,.arrow
.notup:
    ld a,(ix+View_y)
    add a,(ix+View_h)
    sub 10
    ld b,2
    inc c
    cp e
    jr z,.arrow
    jr c,.arrow
    ld a,(TK_TH)
    or a
    jr z,.track                 ; no thumb: below the top arrow is page down
    ld a,(TK_TY)
    ld b,3
    dec c
    cp e
    jr z,.thumb
    jr nc,.page
.thumb:
    ld hl,TK_TH
    add a,(hl)
    cp e
    jr z,.track
    jr c,.track
    ld a,e                      ; the thumb: grab = py - ty
    ld hl,TK_TY
    sub (hl)
    ld (TK_GRAB),a
    ld a,5
    ld (TK_PART),a
    jr .loop0
.track:
    ld bc,4 * 256 + 1
.page:
    ld a,(ix+VScroll_page)
    jr .step
.arrow:
    ld a,b
    ld (ix+VScroll_press),a
    ld a,1
.step:
    ld (TK_AMT),a
    ld a,b
    ld (TK_PART),a
    ld a,c
    ld (TK_DIR),a
    call W_DRAWVIEW             ; the arrow drawn pressed (or no change)
    call vs_step
    ld hl,(V_FRAMES)
    ld de,15
    add hl,de
    ld (TK_NEXT),hl
.loop0:
.loop:
    call K_GETEV
    jr nc,.ev
    halt
    ld a,(TK_PART)              ; the repeat
    cp 5
    jr z,.loop
    ld hl,(V_FRAMES)
    ld de,(TK_NEXT)
    or a
    sbc hl,de
    jp m,.loop
    call vs_inside
    call c,vs_step
    ld hl,(V_FRAMES)
    ld de,6
    add hl,de
    ld (TK_NEXT),hl
    jr .loop
.ev:
    cp E_UP
    jr z,.up
    cp E_MOVE
    jr nz,.loop
    call vs_point
    ld a,(TK_PART)
    cp 5
    call z,vs_drag
    jr .loop
.up:
    ld a,(ix+VScroll_press)
    or a
    jr z,.end
    ld (ix+VScroll_press),0
    call W_DRAWVIEW
.end:
    scf
    ret

; vs_point: TK_PX, TK_PY = the point of the event in K_EV.  Clobbers AF, BC, DE.
vs_point:
    call w_point
    ld (TK_PX),bc
    ld a,e
    ld (TK_PY),a
    ret

; vs_inside: carry when (TK_PX, TK_PY) is inside the part pressed (the track's parts against the thumb as it is now).
vs_inside:
    call vs_geom
    ld hl,(TK_PX)
    ld e,(ix+View_x)
    ld d,(ix+View_x+1)
    or a
    sbc hl,de
    jr c,.no
    ld a,h
    or a
    jr nz,.no
    ld a,l
    cp (ix+View_w)
    jr nc,.no
    ld a,(TK_PY)
    ld e,a
    ld a,(ix+View_y)            ; B = lo, C = hi per part
    ld b,a
    add a,10
    ld c,a                      ; up: [y, y + 10)
    ld a,(TK_PART)
    dec a
    jr z,.in
    ld a,(ix+View_y)
    add a,(ix+View_h)
    ld c,a
    sub 10
    ld b,a                      ; down: [y + h - 10, y + h)
    ld a,(TK_PART)
    cp 2
    jr z,.in
    ld c,b                      ; page down: [ty + th, y + h - 10)
    ld a,(TK_TY)
    ld hl,TK_TH
    add a,(hl)
    ld b,a
    ld a,(TK_PART)
    cp 4
    jr z,.in
    ld a,(ix+View_y)            ; page up: [y + 10, ty)
    add a,10
    ld b,a
    ld a,(TK_TY)
    ld c,a
.in:
    ld a,e
    cp b
    jr c,.no
    cp c
    ret
.no:
    or a
    ret

; vs_step: value moved by TK_AMT in TK_DIR, clamped to 0..max; when it changed, drawn and told.
vs_step:
    ld a,(TK_DIR)
    or a
    ld a,(ix+VScroll_value)
    ld hl,TK_AMT
    jr nz,.inc
    sub (hl)
    jr nc,vs_set
    xor a
    jr vs_set
.inc:
    add a,(hl)
    jr c,.max
    cp (ix+VScroll_max)
    jr c,vs_set
    jr z,vs_set
.max:
    ld a,(ix+VScroll_max)
; vs_set: value = A; when it changed: W_DRAWVIEW, then the target told with E_SCROLL (E_CMD posted when there is none).
vs_set:
    cp (ix+VScroll_value)
    ret z
    ld (ix+VScroll_value),a
    call W_DRAWVIEW
    ld l,(ix+VScroll_target)
    ld h,(ix+VScroll_target+1)
    ld a,h
    or l
    jp z,b_post
    ld a,E_SCROLL
    ld (TK_EV),a
    ld a,(ix+VScroll_value)
    ld (TK_EV+1),a
    ld a,(ix+View_id)
    ld (TK_EV+2),a
    xor a
    ld (TK_EV+3),a
    push ix
    push hl
    pop ix
    ld de,TK_EV
    ld a,M_EVENT
    rst $08
    pop ix
    ret

; vs_drag (9.3): the thumb follows TK_PY; value = round(t max / (tl - th)), halves up.
vs_drag:
    call vs_geom
    ld a,(TK_TH)
    ld b,a
    ld a,(TK_TL)
    sub b
    ret z
    ld b,a                      ; B = the span tl - th
    ld a,(TK_PY)
    ld hl,TK_GRAB
    sub (hl)
    jr c,.zero
    ld c,a
    ld a,(ix+View_y)
    add a,10
    ld d,a
    ld a,c
    sub d
    jr nc,.pos
.zero:
    xor a
.pos:
    cp b
    jr c,.ok
    ld a,b
.ok:
    push bc
    ld l,a
    ld h,0
    ld e,(ix+VScroll_max)
    ld d,h
    call mul16                  ; DE:HL = t max
    add hl,hl
    rl e
    rl d                        ; x 2
    pop bc
    ld c,b
    ld b,0
    add hl,bc
    jr nc,.nc
    inc de
.nc:
    sla c
    rl b                        ; BC = 2 span
    call div3216
    ld a,l
    jp vs_set

; TK_SETBAR (9.3): IX = a VScroll, A = value, C = max, B = page -> stored (value at most max), W_DRAWVIEW.
TK_SETBAR:
    ld (ix+VScroll_max),c
    ld (ix+VScroll_page),b
    cp c
    jr c,.ok
    ld a,c
.ok:
    ld (ix+VScroll_value),a
    jp W_DRAWVIEW
TK_END:
