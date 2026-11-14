; s3bl.asm -- G_BLIT and its helpers (uses sc_clip from s3sv.asm): cut out of s3.asm verbatim (docs/SIZE.md 4).  See s3sv.asm.
; ---------------------------------------------------------------------------------------------------------------------
; G_BLIT: GA = x, y, w, h, shifted set -> bitmap pixel (j, k) at (x + j, y + k), inside the clip: new = (old AND m) OR i.
; Clobbers AF, BC, DE, HL.
;
; Copy p = x AND 7 of the set holds each row's screen bytes, so a byte is "LD A,(DE) ; AND (HL) ; INC HL ; OR (HL) ; INC HL ;
; LD (DE),A" (DE the screen, HL the set) and a step to the next byte column.  When the clip holds the bitmap's columns whole, a
; row runs the last nb bodies of an unrolled chain (bl_X or bl_Y, by the parity of the first column and nb), entered by
; JP (IX), left by JP (IY).  Otherwise (the clip cuts the bitmap's columns) a general loop masks each byte with its clip mask.
B_NK        EQU $E05E               ; byte: rows
B_Y         EQU $E04A               ; byte: first screen row
B_K0        EQU $E04B               ; byte: first bitmap row
B_WS2       EQU $E04C               ; byte: 2 ws (a set row)
B_NB        EQU $E04D               ; byte: screen bytes a row
B_C0        EQU $E04E               ; byte: first byte column
B_QA        EQU $E04F               ; byte: first pair drawn
B_XA        EQU $E050               ; word: clipped x range
B_XB        EQU $E052               ; word
B_CM        EQU $E054               ; 6 bytes: clip masks (general loop)
B_N         EQU $E05A               ; byte: bytes left (general loop)
B_T         EQU $E05B               ; byte: scratch (general loop)
B_SROW      EQU $E05C               ; word: the set row of the first drawn row

G_BLIT:
    ld hl,(GA_W)
    bit 7,h
    ret nz
    ld a,h
    or l
    ret z
    ld hl,(GA_H)
    bit 7,h
    ret nz
    ld a,h
    or l
    ret z
    ; --- the usual case: the whole bitmap inside the clip (x >= cx0, x + w <= cx1, y >= cy0, y + h <= cy1)
    ld hl,(GA_X)
    ld de,(GCX0)
    ld a,l
    sub e
    ld a,h
    sbc a,d
    jp m,bl_clip
    ld de,(GA_W)
    add hl,de
    ex de,hl
    ld hl,(GCX1)
    ld a,l
    sub e
    ld a,h
    sbc a,d
    jp m,bl_clip
    ld hl,(GA_Y)
    ld de,(GCY0)
    ld a,l
    sub e
    ld a,h
    sbc a,d
    jp m,bl_clip
    ld de,(GA_H)
    add hl,de
    ex de,hl
    ld hl,(GCY1)
    ld a,l
    sub e
    ld a,h
    sbc a,d
    jp m,bl_clip
    ld a,(GA_Y)
    ld (B_Y),a
    ld a,(GA_H)
    ld (B_NK),a
    ld c,a
    ld a,(GA_W)
    add a,7
    rra
    rra
    rra
    and $1F
    inc a                   ; ws
    ld b,a
    add a,a
    ld (B_WS2),a
    xor a
.cs:
    add a,c
    djnz .cs                ; A = ws h (<= 165)
    ld e,a
    ld d,0
    sla e
    rl d                    ; DE = 2 ws h (a copy)
    ld hl,(GA+8)
    ld a,(GA_X)
    rra                     ; + p x the copy (3 bits)
    jr nc,.b1
    add hl,de
.b1:
    sla e
    rl d
    rra
    jr nc,.b2
    add hl,de
.b2:
    sla e
    rl d
    rra
    jr nc,.p0
    add hl,de
.p0:
    ld (B_SROW),hl
    push ix
    push iy
    exx
    push bc
    push de
    push hl
    exx
    ld hl,(GA_X)
    ld a,h
    rra
    ld a,l
    rra
    rrca
    rrca
    and $3F
    ld c,a                  ; c0
    ld de,(GA_W)
    add hl,de
    dec hl
    ld a,h
    rra
    ld a,l
    rra
    rrca
    rrca
    and $3F
    sub c
    inc a
    ld b,a                  ; nb
    jp bl_fastcb
bl_clip:
    ; --- rows
    ld hl,(GCY1)
    ld (S_HI),hl
    ld hl,(GA_Y)
    ld de,(GA_H)
    ld bc,(GCY0)
    call sc_clip
    ret c
    ld a,e
    sub l
    ld (B_NK),a
    ld a,l
    ld (B_Y),a
    ld de,(GA_Y)
    sub e
    ld (B_K0),a             ; ya - y (0..31)
    ; --- columns
    ld hl,(GCX1)
    ld (S_HI),hl
    ld hl,(GA_X)
    ld de,(GA_W)
    ld bc,(GCX0)
    call sc_clip
    ret c
    ld (B_XA),hl
    ld (B_XB),de
    ; --- ws, p, the set row: set + 2 ws (p h + k0)
    ld a,(GA_W)
    add a,7
    rra
    rra
    rra
    and $1F
    inc a                   ; ws
    ld c,a
    add a,a
    ld (B_WS2),a
    ld a,(GA_X)
    and 7
    ld b,a
    ld a,(B_K0)
    jr z,.p0
    ld hl,GA_H
.ph:
    add a,(hl)
    djnz .ph
.p0:                        ; A = p h + k0 (<= 255)
    ld l,a
    ld h,0
    add hl,hl
    ex de,hl                ; DE = 2 (p h + k0)
    ld hl,(GA+8)
    ld b,c
.ws:
    add hl,de
    djnz .ws
    ld (B_SROW),hl
    push ix
    push iy
    exx
    push bc
    push de
    push hl
    exx
    ; --- fast when the clip holds [x, x + w): xa = x and xb = x + w
    ld hl,(GA_X)
    ld de,(B_XA)
    or a
    sbc hl,de
    jp nz,bl_gen
    ld hl,(GA_X)
    ld de,(GA_W)
    add hl,de
    ld de,(B_XB)
    or a
    sbc hl,de
    jp nz,bl_gen
    ; c0 = xa >> 3, nb = ((xb - 1) >> 3) - c0 + 1; K = 2 ws - 2 nb (0 or 2)
    ld hl,(B_XA)
    call bl_col8
    ld c,a                  ; C = c0
    ld hl,(B_XB)
    dec hl
    call bl_col8
    sub c
    inc a
    ld b,a                  ; B = nb (1..5)
bl_fastcb:                  ; C = c0, B = nb; B_Y, B_NK, B_SROW, B_WS2 set; registers saved
    ; chain: X when c0 + nb is odd, else Y; K = 2 ws - 2 nb (0, or 2: the row's last pair is skipped); entry = its suffix
    ; of nb bodies
    add a,a
    ld e,a
    ld a,(B_WS2)
    sub e
    ld a,c
    ld hl,BL_XE0-2
    jr z,.k0
    ld hl,BL_XE2-2
.k0:
    add a,b
    rra
    jr c,.ch
    ld de,BL_YE0-BL_XE0
    add hl,de
.ch:
    ld e,b
    ld d,0
    add hl,de
    add hl,de
    ld a,(hl)
    inc hl
    ld h,(hl)
    ld l,a
    push hl
    pop ix
    ; screen row start: ROWTAB[ya] + (c0 >> 1), file 2 if c0 is odd
    ld a,(B_Y)
    ld e,a
    ld l,a                  ; BC = the row's first byte: ROWTAB[y] + (c0 >> 1), file 2 if c0 is odd
    ld h,ROWTAB>>9
    add hl,hl
    ld a,c
    srl a
    ld c,(hl)
    inc l
    ld b,(hl)
    jr nc,.f1
    set 5,b
.f1:
    add a,c
    ld c,a
    ; segments (rows in one character row): IYl = the first one's rows, min(8 - (y AND 7), rows); IYh = the rows after it
    ld a,e
    or $F8
    neg
    ld e,a
    ld a,(B_NK)
    sub e
    jr nc,.s1
    add a,e
    ld e,a
    xor a
.s1:
    ld iyh,a                ; rows after the first segment
    ld iyl,e                ; rows in it
    ld hl,(B_SROW)
; fast rows: HL = set, BC = the row's first screen byte, IX = chain entry, IYl = rows left in the segment.  Each chain ends
; with the row step (BL_END).
bl_row:
    ld d,b
    ld e,c
    jp (ix)
bl_seg:                     ; end of a segment: B is line 0 of the next character row (or of the next third)
    ld a,iyh
    or a
    jr z,bl_exit
    sub 8
    ld e,8
    jr nc,.f
    add a,8
    ld e,a
    xor a
.f:
    ld iyh,a
    ld iyl,e
    ld a,c
    add a,32
    ld c,a
    jr c,bl_row
    ld a,b
    sub 8
    ld b,a
    jr bl_row
bl_exit:
    exx
    pop hl
    pop de
    pop bc
    exx
    pop iy
    pop ix
    ret

; The chains: BL_E draws a byte in file 1 and steps to file 2 (same offset), BL_O a byte in file 2 and steps to file 1 (next
; offset).  bl_Xn / bl_Yn enter with n bodies left.
    MACRO BL_E
        ld a,(de)
        and (hl)
        inc hl
        or (hl)
        inc hl
        ld (de),a
        set 5,d
    ENDM
    MACRO BL_LAST           ; the row's last byte: no step
        ld a,(de)
        and (hl)
        inc hl
        or (hl)
        inc hl
        ld (de),a
    ENDM
    MACRO BL_O
        ld a,(de)
        and (hl)
        inc hl
        or (hl)
        inc hl
        ld (de),a
        res 5,d
        inc e
    ENDM
    MACRO BL_END K          ; after a row: skip K pairs, step the row, next row or the segment's end
        IF K
            inc hl
            inc hl
        ENDIF
        inc b
        ld d,b
        ld e,c
        dec iyl
        jp z,bl_seg
        jp (ix)
    ENDM
bl_X05: BL_E
bl_X04: BL_O
bl_X03: BL_E
bl_X02: BL_O
bl_X01: BL_LAST
        BL_END 0
bl_Y05: BL_O
bl_Y04: BL_E
bl_Y03: BL_O
bl_Y02: BL_E
bl_Y01: BL_LAST
        BL_END 0
bl_X25: BL_E
bl_X24: BL_O
bl_X23: BL_E
bl_X22: BL_O
bl_X21: BL_LAST
        BL_END 1
bl_Y25: BL_O
bl_Y24: BL_E
bl_Y23: BL_O
bl_Y22: BL_E
bl_Y21: BL_LAST
        BL_END 1
BL_XE0: DW bl_X01, bl_X02, bl_X03, bl_X04, bl_X05
BL_YE0: DW bl_Y01, bl_Y02, bl_Y03, bl_Y04, bl_Y05
BL_XE2: DW bl_X21, bl_X22, bl_X23, bl_X24, bl_X25
BL_YE2: DW bl_Y21, bl_Y22, bl_Y23, bl_Y24, bl_Y25

; bl_gen: the clip cuts the bitmap's columns.  Bytes cA..cB, each masked by its clip mask: m OR NOT cm, i AND cm.
bl_gen:
    ld hl,(B_XA)
    call bl_col8
    ld c,a                  ; C = cA
    ld hl,(B_XB)
    dec hl
    call bl_col8
    sub c
    inc a
    ld (B_NB),a
    ld b,a
    ld hl,B_CM
    ld a,b
.f:
    ld (hl),$FF
    inc hl
    dec a
    jr nz,.f
    ld a,(B_XA)
    and 7
    ld e,a
    ld d,0
    ld hl,LMASK
    add hl,de
    ld a,(hl)
    ld (B_CM),a
    ld a,(B_XB)
    dec a
    and 7
    ld e,a
    ld hl,RMASK
    add hl,de
    ld a,(hl)
    ld hl,B_CM-1
    ld e,b
    add hl,de
    and (hl)
    ld (hl),a
    ; first pair qA = cA - (x >> 3)
    ld hl,(GA_X)
    sra h
    rr l
    sra h
    rr l
    sra h
    rr l
    ld a,c
    sub l
    add a,a
    ld e,a
    ld d,0
    ld hl,(B_SROW)
    add hl,de
    ld (B_SROW),hl
    ld a,(B_Y)
    call bl_rowc            ; BC = the first byte (C = cA on entry)
    ld a,(B_NK)
    exx
    ld b,a
    exx
    ld hl,(B_SROW)
.row:
    push hl
    ld d,b
    ld e,c
    ld ix,B_CM
    ld a,(B_NB)
    ld (B_N),a
.col:
    ld a,(ix+0)
    cpl
    or (hl)                 ; m OR NOT cm
    ex de,hl
    and (hl)
    ex de,hl
    ld (B_T),a
    inc hl
    ld a,(hl)
    and (ix+0)              ; i AND cm
    inc hl
    push hl
    ld hl,B_T
    or (hl)
    pop hl
    ld (de),a
    ld a,d
    xor $20
    ld d,a
    and $20
    jr nz,.s
    inc e
.s:
    inc ix
    push hl
    ld hl,B_N
    dec (hl)
    pop hl
    jr nz,.col
    pop hl
    ld a,(B_WS2)
    ld e,a
    ld d,0
    add hl,de
    inc b
    ld a,b
    and 7
    jr nz,.ct
    ld a,c
    add a,32
    ld c,a
    jr c,.ct
    ld a,b
    sub 8
    ld b,a
.ct:
    exx
    dec b
    exx
    jr nz,.row
    jp bl_exit

; bl_col8: HL = x (0..511) -> A = x >> 3.  Clobbers F.
bl_col8:
    ld a,h
    rra
    ld a,l
    rra
    rrca
    rrca
    and $3F
    ret

; bl_rowc: A = row, C = byte column -> BC = its screen byte (B high, C low).  Clobbers AF, HL.
bl_rowc:
    ld l,a
    ld h,ROWTAB>>9
    add hl,hl
    ld a,c
    srl a
    push af
    add a,(hl)
    inc l
    ld h,(hl)
    ld c,a
    pop af
    ld b,h
    ret nc
    set 5,b
    ret
