; rrect.asm -- G_RRECT, DOCK 6 (mapping R; docs/PAINT.md 7, 18): the outline (and optionally the pattern-filled inside) of a rectangle whose corners are quarter
; ellipses: the rounded rectangle (rx, ry = the corner's radii) and the oval (rx = w / 2, ry = h / 2).  Display only.  Assembled by desk5.asm in chunk 6 after patfill.asm
; (it calls G_PATFILL, the pool's G_FILL, mul16 and div3216).
;
; G_RRECT: GA = x, y, w, h; GA+10 = rx, GA+12 = ry (words: the corner's horizontal and vertical radii, each cut to w / 2 and h / 2, rx to 255 and ry to 100: 255 and 100 make an
; oval; 0 = square corners); GA+14 = the mode (byte: 0 the outline, 1 the inside first, filled with the pattern at GA+8 by REPLACE, then the outline); GOP = the outline's op
; (SET or CLR: XOR would flip twice the pixels where two runs meet).  The shape is clipped to GCLIP.  GA is clobbered, GOP kept, IX and IY kept.  Clobbers AF, BC, DE, HL.
;
; The corner rows rr = 0 .. K - 1 (K = ry, at least 1) from the top edge in, each mirrored to the bottom: a row's inset (how far the shape's edge is inside the rectangle's) is
; rx - round (rx x isqrt (4 ry^2 - (2 (ry - rr) - 1)^2) / (2 ry)); its inside spans [x + inset, x + w - 1 - inset]; the outline is that whole span on the top row (rr = 0), else a
; run on each side from the edge towards the middle as far as the previous row's inset (at least 1 pixel).  The rows between (h - 2 K of them) have the whole width, the outline their
; two side columns.  The state is in hot RAM $E0D0-$E0F5 (free: the pool's G_FILL and G_PATFILL use $E01A-$E07F).

RR_X        EQU $E0D0               ; word: the rectangle
RR_Y        EQU $E0D2
RR_W        EQU $E0D4
RR_H        EQU $E0D6
RR_RX       EQU $E0D8               ; byte: the radii
RR_RY       EQU $E0D9
RR_RR       EQU $E0DA               ; byte: the corner row
RR_K        EQU $E0DB               ; byte: the corner rows
RR_PI       EQU $E0DC               ; byte: the previous row's inset
RR_IN       EQU $E0DD               ; byte: this row's inset
RR_MODE     EQU $E0DE               ; byte
RR_OP       EQU $E0DF               ; byte: the caller's GOP
RR_PAT      EQU $E0E0               ; word: the pattern
RR_4RY2     EQU $E0E2               ; word: 4 ry^2
RR_YR       EQU $E0E4               ; word: the row being drawn
RR_SP       EQU $E0E6               ; word: its span
RR_XL       EQU $E0E8               ; word: its left end
RR_RUN      EQU $E0EA               ; word: its run
RR_CNT      EQU $E0EC               ; word: the middle rows
RR_YM       EQU $E0EE               ; word: the first of them
RR_N        EQU $E0F0               ; word: rr_isqrt's number, root and bit
RR_RES      EQU $E0F2
RR_BIT      EQU $E0F4

G_RRECT:
    ld hl,(GA+4)                    ; w, h: nothing for w <= 0 or h <= 0
    bit 7,h
    ret nz
    ld a,h
    or l
    ret z
    ld (RR_W),hl
    ld de,(GA+6)
    bit 7,d
    ret nz
    ld a,d
    or e
    ret z
    ld (RR_H),de
    ld hl,(GA)
    ld (RR_X),hl
    ld hl,(GA+2)
    ld (RR_Y),hl
    ld hl,(GA+8)
    ld (RR_PAT),hl
    ld a,(GA+14)
    ld (RR_MODE),a
    ld a,(GOP)
    ld (RR_OP),a
    ld hl,(RR_H)                    ; ry = min(GA+12, h / 2, 100)
    srl h
    rr l
    ld a,h
    or a
    jr nz,.c1
    ld a,l
    cp 101
    jr c,.c2
.c1:
    ld l,100
.c2:
    ld a,(GA+13)
    or a
    jr nz,.ry
    ld a,(GA+12)
    cp l
    jr nc,.ry
    ld l,a
.ry:
    ld a,l
    ld (RR_RY),a
    ld hl,(RR_W)                    ; rx = min(GA+10, w / 2, 255)
    srl h
    rr l
    ld a,h
    or a
    jr z,.x1
    ld l,255
.x1:
    ld a,(GA+11)
    or a
    jr nz,.rx
    ld a,(GA+10)
    cp l
    jr nc,.rx
    ld l,a
.rx:
    ld a,l
    ld (RR_RX),a
    ld a,(RR_RY)                    ; K = max(ry, 1)
    or a
    jr nz,.k
    inc a
.k:
    ld (RR_K),a
    ld a,(RR_RY)                    ; 4 ry^2
    ld l,a
    ld h,0
    ld e,a
    ld d,h
    call mul16
    add hl,hl
    add hl,hl
    ld (RR_4RY2),hl
    xor a
    ld (RR_RR),a
    ld (RR_PI),a
.corner:
    xor a                           ; the inset (0 without round corners)
    ld (RR_IN),a
    ld a,(RR_RY)
    or a
    jr z,.rows
    ld hl,RR_RR
    sub (hl)
    add a,a
    dec a                           ; 2 (ry - rr) - 1
    ld l,a
    ld h,0
    ld e,a
    ld d,h
    call mul16                      ; its square (< 65536: DE = 0)
    ex de,hl
    ld hl,(RR_4RY2)
    or a
    sbc hl,de                       ; n = 4 ry^2 - that
    call rr_isqrt                   ; A = isqrt (n)
    ld e,a
    ld d,0
    ld a,(RR_RX)
    ld l,a
    ld h,0
    call mul16                      ; HL = rx x v
    ld a,(RR_RY)
    ld c,a
    ld b,0
    add hl,bc                       ; + ry: rounded
    sla c
    rl b                            ; BC = 2 ry
    ld de,0
    call div3216                    ; HL = u
    ld a,(RR_RX)
    sub l
    jr nc,.i
    xor a
.i:
    ld (RR_IN),a
.rows:
    ld a,(RR_RR)                    ; the top row: y + rr
    ld e,a
    ld d,0
    ld hl,(RR_Y)
    add hl,de
    ld (RR_YR),hl
    call rr_row
    ld hl,(RR_Y)                    ; the bottom row: y + h - 1 - rr, when it is another row
    ld de,(RR_H)
    add hl,de
    dec hl
    ld a,(RR_RR)
    ld e,a
    ld d,0
    or a
    sbc hl,de
    ld de,(RR_YR)
    or a
    sbc hl,de
    jr z,.nb
    add hl,de
    ld (RR_YR),hl
    call rr_row
.nb:
    ld a,(RR_IN)
    ld (RR_PI),a
    ld hl,RR_RR
    inc (hl)
    ld a,(hl)
    ld hl,RR_K
    cp (hl)
    jp c,.corner
    ld hl,(RR_H)                    ; the rows between: h - 2 K from y + K
    ld a,(RR_K)
    ld e,a
    ld d,0
    or a
    sbc hl,de
    sbc hl,de
    jr c,.done
    jr z,.done
    ld (RR_CNT),hl
    ld hl,(RR_Y)
    add hl,de
    ld (RR_YM),hl
    ld a,(RR_MODE)
    or a
    jr z,.sides
    ld a,3
    ld (GOP),a
    ld hl,(RR_X)                    ; the whole width, in the pattern
    ld (GA),hl
    ld hl,(RR_YM)
    ld (GA+2),hl
    ld hl,(RR_W)
    ld (GA+4),hl
    ld hl,(RR_CNT)
    ld (GA+6),hl
    ld hl,(RR_PAT)
    ld (GA+8),hl
    call G_PATFILL
    ld a,(RR_OP)
    ld (GOP),a
.sides:
    ld hl,(RR_X)
    ld (GA),hl
    ld hl,(RR_YM)
    ld (GA+2),hl
    ld hl,1
    ld (GA+4),hl
    ld hl,(RR_CNT)
    ld (GA+6),hl
    call G_FILL                     ; the left side
    ld hl,(RR_X)
    ld de,(RR_W)
    add hl,de
    dec hl
    ld (GA),hl
    call G_FILL                     ; the right side
.done:
    ld a,(RR_OP)
    ld (GOP),a
    ret

; rr_row: the row at y = RR_YR with the inset RR_IN: its inside in the pattern when filled, then its outline (the whole span on the top row, else a run each side).
rr_row:
    ld a,(RR_IN)
    ld c,a
    ld b,0
    ld hl,(RR_W)
    or a
    sbc hl,bc
    sbc hl,bc
    ld (RR_SP),hl                   ; the span: w - 2 inset
    ld hl,(RR_X)
    add hl,bc
    ld (RR_XL),hl                   ; its left end
    ld a,(RR_MODE)
    or a
    jr z,.o
    ld a,3
    ld (GOP),a
    ld hl,(RR_XL)
    ld (GA),hl
    ld hl,(RR_YR)
    ld (GA+2),hl
    ld hl,(RR_SP)
    ld (GA+4),hl
    ld hl,1
    ld (GA+6),hl
    ld hl,(RR_PAT)
    ld (GA+8),hl
    call G_PATFILL
    ld a,(RR_OP)
    ld (GOP),a
.o:
    ld hl,(RR_XL)
    ld (GA),hl
    ld hl,(RR_YR)
    ld (GA+2),hl
    ld hl,1
    ld (GA+6),hl
    ld a,(RR_RR)
    or a
    jr nz,.runs
    ld hl,(RR_SP)                   ; the top row: the whole span
    ld (GA+4),hl
    jp G_FILL
.runs:
    ld a,(RR_PI)                    ; run = max (1, the previous inset - the inset)
    ld hl,RR_IN
    sub (hl)
    jr nc,.r1
    xor a
.r1:
    or a
    jr nz,.r2
    inc a
.r2:
    ld l,a
    ld h,0
    ld (RR_RUN),hl
    ld (GA+4),hl
    call G_FILL                     ; the left run (GA kept)
    ld hl,(RR_XL)
    ld de,(RR_SP)
    add hl,de
    ld de,(RR_RUN)
    or a
    sbc hl,de                       ; xl + span - run
    ld (GA),hl
    jp G_FILL                       ; the right run

; rr_isqrt: HL = n -> A = floor (sqrt (n)) (digit by digit).  Clobbers AF, BC, DE, HL.
rr_isqrt:
    ld (RR_N),hl
    ld hl,0
    ld (RR_RES),hl
    ld hl,$4000
    ld (RR_BIT),hl
.skip:
    ld hl,(RR_BIT)
    ld a,h
    or l
    jr z,.fin
    ld de,(RR_N)
    or a
    sbc hl,de
    jr z,.loop
    jr c,.loop                      ; bit <= n
    ld hl,(RR_BIT)                  ; bit > n: bit >>= 2
    srl h
    rr l
    srl h
    rr l
    ld (RR_BIT),hl
    jr .skip
.loop:
    ld hl,(RR_BIT)
    ld a,h
    or l
    jr z,.fin
    ld de,(RR_RES)
    add hl,de                       ; res + bit
    ex de,hl
    ld hl,(RR_N)
    or a
    sbc hl,de
    jr c,.no                        ; n < res + bit
    ld (RR_N),hl                    ; n -= res + bit; res = res / 2 + bit
    ld hl,(RR_RES)
    srl h
    rr l
    ld de,(RR_BIT)
    add hl,de
    ld (RR_RES),hl
    jr .nx
.no:
    ld hl,(RR_RES)
    srl h
    rr l
    ld (RR_RES),hl
.nx:
    ld hl,(RR_BIT)
    srl h
    rr l
    srl h
    rr l
    ld (RR_BIT),hl
    jr .loop
.fin:
    ld a,(RR_RES)
    ret
