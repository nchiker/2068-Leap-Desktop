; lift.asm -- G_LIFT, DOCK 6 (mapping R; docs/PAINT.md 22.1): the screen's pixels copied to a bitmap, the mirror of G_ICON.  Display only.  Assembled by desk5.asm in chunk 6
; after icon.asm (it uses G_PATFILL's scratch and pf_nx's file arithmetic, not its routines).
;
; G_LIFT: GA = x, y, w, h (screen pixels; x and w multiples of 8, the box wholly on the screen, w >= 8, h >= 1); GA+8 = the destination: h rows of w / 8 bytes, bit 7 the leftmost
; pixel, 1 = ink, rows packed (the layout G_ICON reads), in cold RAM ($7800..) or anywhere visible under R.  No clipping: the caller keeps the box inside the picture.  GA is kept.
; Clobbers AF, BC, DE, HL; scratch $E050-$E05C (G_ICON's).

G_LIFT:
    ld hl,(GA)
    srl h
    rr l
    srl h
    rr l
    srl h
    rr l
    ld a,l
    ld (PF_C0),a                    ; the first byte column
    ld hl,(GA+4)
    srl h
    rr l
    srl h
    rr l
    srl h
    rr l
    ld a,l
    or a
    ret z
    ld (PF_N),a                     ; the byte columns
    ld a,(GA+6)
    or a
    ret z
    ld a,(GA+2)
    ld (PF_Y),a                     ; the first row
    ld hl,GA+6
    add a,(hl)
    ld (PF_YE),a                    ; the row after the last
    ld hl,(GA+8)
.row:
    push hl
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
    jr nc,.g1
    set 5,d
.g1:
    or e
    ld e,a                          ; DE = the first screen byte
    pop hl                          ; HL = the destination
    ld a,(PF_N)
    ld b,a
    bit 5,d
    jr z,.ev
    ld a,(de)                       ; an odd first column (file 2): one byte, then pairs from an even column
    ld (hl),a
    inc hl
    res 5,d
    inc e
    dec b
    jr z,.fd
.ev:
    ld c,b
    srl b
    jr z,.np
.pr:
    ld a,(de)                       ; a pair: an even column (file 1), the odd one after it (file 2, the same offset)
    ld (hl),a
    inc hl
    set 5,d
    ld a,(de)
    ld (hl),a
    inc hl
    res 5,d
    inc e
    djnz .pr
.np:
    bit 0,c
    jr z,.fd
    ld a,(de)
    ld (hl),a
    inc hl
.fd:
    ld a,(PF_Y)
    inc a
    ld (PF_Y),a
    ld c,a
    ld a,(PF_YE)
    cp c
    jp nz,.row
    ret
