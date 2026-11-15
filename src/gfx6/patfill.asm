; patfill.asm -- G_PATFILL and the pattern table, DOCK 6 (mapping R; docs/PAINT.md 7).  Display only: its arguments are in hot RAM (GA, GOP) and the
; pattern is a pointer to 8 bytes in DOCK 6, so a program passes G_PATFILL's pointer, never its own memory.  Assembled by desk5.asm at ORG $C000 after
; the moved graphics library (s3ln.asm's l_min / l_max are used).
;
; G_PATFILL: GA = x, y, w, h; GA+8 = a pointer to 8 pattern bytes (row y AND 7 of the pattern is the byte; its bit 7 is the leftmost pixel, bit 0 the
; rightmost: the pattern is anchored to the screen, x AND 7 and y AND 7, and a byte column is 8 pixels, so every byte column of a row gets the same byte).
; The rectangle is clipped to GCLIP.  GOP: 0 SET (ink where the pattern is 1), 1 CLR (paper where it is 1), 2 XOR, 3 REPLACE (the pattern, both its ink and
; its paper).  GA is kept.  Clobbers AF, BC, DE, HL; the scratch is $E050-$E05F (the moved routines' own, never nested).

PF_C0       EQU $E050               ; byte: first byte column
PF_C1       EQU $E051               ; byte: last byte column
PF_ML       EQU $E052               ; byte: the first column's mask
PF_MR       EQU $E053               ; byte: the last column's mask
PF_Y        EQU $E054               ; byte: the row
PF_YE       EQU $E055               ; byte: the row after the last
PF_P        EQU $E056               ; byte: the row's pattern byte
PF_CC       EQU $E057               ; byte: the column

G_PATFILL:
    ld hl,(GA+4)                    ; x range: x0 = max(x, cx0), x1 = min(x + w, cx1)
    bit 7,h
    ret nz
    ld de,(GA)
    add hl,de
    ld de,(GCX1)
    call l_min
    push hl                         ; x1
    ld hl,(GA)
    ld de,(GCX0)
    call l_max                      ; HL = x0
    pop de                          ; DE = x1
    or a
    sbc hl,de
    ret nc                          ; x0 >= x1
    add hl,de                       ; HL = x0
    ld a,l
    and 7
    ld c,a
    ld a,$FF
    jr z,.ml
.l1:
    srl a
    dec c
    jr nz,.l1
.ml:
    ld (PF_ML),a                    ; $FF >> (x0 AND 7)
    srl h
    rr l
    srl h
    rr l
    srl h
    rr l
    ld a,l
    ld (PF_C0),a
    dec de                          ; the last pixel
    ld a,e
    and 7
    ld c,a
    ld a,7
    sub c
    ld c,a
    ld a,$FF
    jr z,.mr
.l2:
    add a,a
    dec c
    jr nz,.l2
.mr:
    ld (PF_MR),a                    ; $FF << (7 - ((x1 - 1) AND 7))
    ld h,d
    ld l,e
    srl h
    rr l
    srl h
    rr l
    srl h
    rr l
    ld a,l
    ld (PF_C1),a
    ld hl,(GA+6)                    ; y range
    bit 7,h
    ret nz
    ld de,(GA+2)
    add hl,de
    ld de,(GCY1)
    call l_min
    push hl                         ; y1
    ld hl,(GA+2)
    ld de,(GCY0)
    call l_max                      ; HL = y0
    pop de
    ld a,e
    sub l
    ret z
    ret c
    ld a,l
    ld (PF_Y),a
    ld a,e
    ld (PF_YE),a
.row:
    ld a,(PF_Y)
    and 7
    ld e,a
    ld d,0
    ld hl,(GA+8)
    add hl,de
    ld a,(hl)
    ld (PF_P),a
    ld a,(PF_Y)
    ld l,a
    ld h,ROWTAB>>9
    add hl,hl
    ld a,(hl)
    inc l
    ld h,(hl)
    ld l,a                          ; HL = the row's base (file 1)
    ld a,(PF_C0)
    ld (PF_CC),a
.col:
    ld a,(PF_CC)
    ld c,a                          ; C = the column
    ld d,h
    ld e,l
    srl a
    jr nc,.f1
    set 5,d
.f1:
    or e
    ld e,a                          ; DE = the byte
    ld a,(PF_C0)
    cp c
    ld a,$FF
    jr nz,.nl
    ld a,(PF_ML)
.nl:
    ld b,a                          ; B = the mask
    ld a,(PF_C1)
    cp c
    jr nz,.nr
    ld a,(PF_MR)
    and b
    ld b,a
.nr:
    ld a,(PF_P)
    and b
    ld c,a                          ; C = the pattern's bits inside the mask
    ld a,(GOP)
    or a
    jr z,.set
    dec a
    jr z,.clr
    dec a
    jr z,.xor
    ld a,b                          ; REPLACE: (byte AND NOT mask) OR bits
    cpl
    ld b,a
    ld a,(de)
    and b
    or c
    jr .st
.set:
    ld a,(de)
    or c
    jr .st
.clr:
    ld a,c
    cpl
    ld b,a
    ld a,(de)
    and b
    jr .st
.xor:
    ld a,(de)
    xor c
.st:
    ld (de),a
    ld a,(PF_CC)
    ld b,a
    ld a,(PF_C1)
    cp b
    jr z,.rowend
    inc b
    ld a,b
    ld (PF_CC),a
    jr .col
.rowend:
    ld a,(PF_Y)
    inc a
    ld (PF_Y),a
    ld hl,PF_YE
    cp (hl)
    jp c,.row
    ret

; The 16 patterns of the palette (docs/PAINT.md 7): 8 bytes each, bit 7 the leftmost pixel.  Solid first, white last.
PATTAB:
    DB $FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF      ; solid
    DB $EE,$BB,$EE,$BB,$EE,$BB,$EE,$BB      ; 75 %
    DB $AA,$55,$AA,$55,$AA,$55,$AA,$55      ; 50 % checker
    DB $88,$22,$88,$22,$88,$22,$88,$22      ; 25 %
    DB $88,$00,$22,$00,$88,$00,$22,$00      ; 12 %
    DB $FF,$00,$00,$00,$FF,$00,$00,$00      ; horizontal lines
    DB $AA,$AA,$AA,$AA,$AA,$AA,$AA,$AA      ; vertical lines
    DB $C0,$60,$30,$18,$0C,$06,$03,$81      ; diagonal
    DB $88,$00,$00,$00,$22,$00,$00,$00      ; dots
    DB $FF,$80,$80,$80,$FF,$08,$08,$08      ; bricks
    DB $FF,$88,$88,$88,$FF,$88,$88,$88      ; cross-hatch
    DB $00,$38,$7C,$7C,$7C,$38,$00,$00      ; large dots
    DB $81,$42,$24,$18,$18,$24,$42,$81      ; weave
    DB $CC,$CC,$33,$33,$CC,$CC,$33,$33      ; 2 x 2 checker
    DB $03,$06,$0C,$18,$30,$60,$C0,$81      ; back diagonal
    DB $00,$00,$00,$00,$00,$00,$00,$00      ; white
