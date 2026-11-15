; icon.asm -- G_ICON, DOCK 6 (mapping R; docs/ICON.md): the opaque bitmap copy.  Display only.  Assembled by desk5.asm in chunk 6 after patfill.asm (it uses
; G_PATFILL's scratch, its pf_nx, l_min / l_max and the pool's mul16).
;
; G_ICON: GA = x, y, w, h (screen pixels; x and w multiples of 8, w <= 512, h <= 192); GA+8 = a pointer to the bitmap, in DOCK 6 or cold RAM ($7800..): h rows of w / 8 bytes, bit 7 the
; leftmost pixel, 1 = ink, rows packed.  The pixels inside GCLIP are REPLACED (ink and paper); a partial edge byte keeps the pixels outside the clip.  Nothing off the screen is
; drawn.  GA is kept, GOP is ignored.  Clobbers AF, BC, DE, HL; scratch $E050-$E05C (G_PATFILL's $E050-$E057, and three more).

GI_S        EQU $E058               ; byte: the bitmap's row stride (w / 8)
GI_OFF      EQU $E059               ; byte: the first drawn column's byte offset in a bitmap row
GI_BP       EQU $E05A               ; word: the bitmap row being drawn

G_ICON:
    ld hl,(GA+4)                    ; x range: x0 = max(x, cx0), x1 = min(x + w, cx1)
    bit 7,h
    ret nz
    ld de,(GA)
    add hl,de
    ld de,(GCX1)
    call l_min
    bit 7,h
    ret nz                          ; x1 < 0: wholly left of the screen
    push hl                         ; x1
    ld hl,(GA)
    ld de,(GCX0)
    call l_max                      ; HL = x0 (>= 0)
    pop de                          ; DE = x1
    or a
    sbc hl,de
    ret nc                          ; x0 >= x1
    add hl,de                       ; HL = x0
    push de
    push hl
    ld de,(GA)
    or a
    sbc hl,de                       ; x0 - x: the clipped-off columns
    srl h
    rr l
    srl h
    rr l
    srl h
    rr l
    ld a,l
    ld (GI_OFF),a
    pop hl
    pop de
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
    ld hl,PF_C0
    sub (hl)
    inc a
    ld (PF_N),a                     ; the byte columns
    ld hl,(GA+4)
    srl h
    rr l
    srl h
    rr l
    srl h
    rr l
    ld a,l
    ld (GI_S),a                     ; the stride
    ld hl,(GA+6)                    ; y range
    bit 7,h
    ret nz
    ld de,(GA+2)
    add hl,de
    ld de,(GCY1)
    call l_min
    bit 7,h
    ret nz                          ; y1 < 0
    push hl                         ; y1
    ld hl,(GA+2)
    ld de,(GCY0)
    call l_max                      ; HL = y0 (>= 0)
    pop de
    or a
    sbc hl,de
    ret nc                          ; y0 >= y1
    add hl,de
    ld a,l
    ld (PF_Y),a
    ld a,e
    ld (PF_YE),a
    ld de,(GA+2)
    or a
    sbc hl,de                       ; the clipped-off rows
    ld a,(GI_S)
    ld e,a
    ld d,0
    call mul16                      ; HL = rows x stride
    ld a,(GI_OFF)
    ld e,a
    ld d,0
    add hl,de
    ld de,(GA+8)
    add hl,de
    ld (GI_BP),hl                   ; the first drawn row's first drawn byte
.row:
    ld a,(PF_Y)
    ld l,a
    ld h,ROWTAB>>9
    add hl,hl
    ld a,(hl)
    inc l
    ld h,(hl)
    ld l,a                          ; HL = the row's base (file 1)
    ld a,(PF_C0)
    ld d,h
    ld e,l
    srl a
    jr nc,.f1
    set 5,d
.f1:
    or e
    ld e,a                          ; DE = the first screen byte
    ld hl,(GI_BP)
    ld a,(PF_N)
    ld b,a
    ld a,(PF_ML)
    ld c,a
    dec b
    jr nz,.many
    ld a,(PF_MR)                    ; one byte: both masks
    and c
    ld c,a
    call gi_m
    jr .rowend
.many:
    call gi_m                       ; the first byte
    dec b
    jr z,.last
.mid:
    ld a,(hl)                       ; the b whole bytes between
    ld (de),a
    inc hl
    bit 5,d
    jr z,.a
    res 5,d
    inc e
    jr .n
.a:
    set 5,d
.n:
    djnz .mid
.last:
    ld a,(PF_MR)
    ld c,a
    call gi_m
.rowend:
    ld hl,(GI_BP)
    ld a,(GI_S)
    ld e,a
    ld d,0
    add hl,de
    ld (GI_BP),hl
    ld a,(PF_Y)
    inc a
    ld (PF_Y),a
    ld hl,PF_YE
    cp (hl)
    jp c,.row
    ret

; gi_m: the screen byte at DE takes the bitmap byte at HL under the mask C (new = old XOR ((old XOR bitmap) AND mask)); both advance (DE to the next byte column).  Clobbers AF, C.
gi_m:
    ld a,(hl)                       ; the bitmap byte
    ex de,hl                        ; HL = the screen byte, DE = the bitmap's
    xor (hl)
    and c
    xor (hl)
    ld (hl),a
    ex de,hl
    inc hl
    jp pf_nx
