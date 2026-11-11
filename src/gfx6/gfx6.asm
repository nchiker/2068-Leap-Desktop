; gfx6.asm -- mode 6 (512 x 192) graphics core of docs/GRAPHICS_SPIKE.md.  S1: addressing, clip, draw op, rectangle fill,
; horizontal / vertical lines, frame, whole-screen clear (interface: section 12).  S2: 8x8 text, proportional text and its width
; (interface: section 14).  Both binding.
;
; Mode 6 (section 3): byte column c = x >> 3 lives in file c AND 1 ($4000 / $6000) at offset c >> 1 of the Spectrum row address.
; So inside a row the byte columns alternate files: f1 offset k, f2 offset k, f1 offset k + 1, ...  The row-major code keeps HL on
; file 1 and DE on file 2 at the same offset, so E = L at the start of every row (one register, C, restores both).
;
; Every routine preserves IX, IY and the alternate set, never executes DI or EI, and uses at most 32 bytes of stack.
; Needs ROWTAB (src/gfx6/tables.inc) on a 512-byte boundary and the page-aligned tables of src/gfx6/tables4.inc: RMASKP directly
; after LMASKP, PROP6_I directly after PROP6_W, SHL 8 pages after SHR.

; ---------------------------------------------------------------------------------------------------------------------
; Variables ($E000-$E03F, section 12.1)
GA          EQU $E000               ; argument block: x, y, w, h (signed words)
GA_X        EQU GA+0
GA_Y        EQU GA+2
GA_W        EQU GA+4
GA_H        EQU GA+6
GOP         EQU $E010               ; draw op
GLH         EQU $E011               ; line height (G_TEXTP code 13)
GCLIP       EQU $E012               ; clip: x0, x1, y0, y1 (words, half-open, inside the screen)
GCX0        EQU GCLIP+0
GCX1        EQU GCLIP+2
GCY0        EQU GCLIP+4
GCY1        EQU GCLIP+6
G_BC0       EQU $E01A               ; byte: first byte column of the clipped rectangle
G_BC1       EQU $E01B               ; byte: last byte column
G_Y0        EQU $E01C               ; byte: first row
G_R         EQU $E01D               ; byte: rows
G_ROWS      EQU $E01E               ; byte: rows left after the current segment (row-major paths)
G_SAVESP    EQU $E022               ; word: G_CLS keeps SP here
G_FR        EQU $E024               ; 8 bytes: G_FRAME's copy of x, y, w, h
G_LM        EQU $E02C               ; byte: left edge mask
G_RM        EQU $E02D               ; byte: right edge mask
G_FILLB     EQU $E02E               ; byte: the fill byte of the whole-byte blocks ($FF SET, 0 CLR)
; S2 scratch (G_TEXTP / G_TEXTW; reuses S1's scratch bytes: no routine calls another that uses them)
G_PX        EQU $E01A               ; word: pen x
G_PY        EQU $E01C               ; word: pen y
G_X0        EQU $E01E               ; word: the start x (code 13 returns to it)
G_RB        EQU $E020               ; word: ROWTAB of the line's first drawn row
G_COL       EQU $E022               ; word: byte column of the glyph (slow path)
G_COLB      EQU $E024               ; word: byte column being drawn (slow path)
G_TWM       EQU $E026               ; word: G_TEXTW's widest line
G_D0        EQU $E028               ; byte: (spare)
G_N         EQU $E029               ; byte: rows drawn on this line (0 = none)
G_S         EQU $E02A               ; byte: rows before the character-row crossing (= G_N when none)
G_KF        EQU $E02B               ; byte (signed): the last pen byte column of the fast region
G_RS        EQU $E02C               ; byte: row size of the op's pass block
G_CH        EQU $E02D               ; byte: code (slow path)
G_P         EQU $E02E               ; byte: x AND 7 (slow path)
G_ONE       EQU $E02F               ; byte: $FF when the glyph fits one byte (slow path)
G_TBL       EQU $E030               ; byte: shift table page (slow path)
G_M         EQU $E031               ; byte: clip mask (slow path)
G_MN        EQU $E032               ; byte: rows left (masked pass)
G_MS        EQU $E033               ; byte: rows to the crossing (masked pass)
GFX6_VARS_END EQU $E040

OP_SET      EQU 0
OP_CLR      EQU 1
OP_XOR      EQU 2

GFX6_CODE:

; ---------------------------------------------------------------------------------------------------------------------
; G_INIT: GOP = SET, GLH = 8, clip = whole screen.  Clobbers AF, HL.
G_INIT:
    ld a,8
    ld (GLH),a
    xor a
    ld (GOP),a
    ld hl,0
    ld (GCX0),hl
    ld (GCY0),hl
    ld hl,512
    ld (GCX1),hl
    ld hl,192
    ld (GCY1),hl
    ret

; G_SETOP: A = op (0 SET, 1 CLR, 2 XOR) -> GOP.  Clobbers nothing.
G_SETOP:
    ld (GOP),a
    ret

; ---------------------------------------------------------------------------------------------------------------------
; G_ROWADDR: A = y (0..191) -> HL = ROWTAB[y] (row y, byte column 0, file 1).  Clobbers AF.
G_ROWADDR:
    ld l,a
    ld h,ROWTAB>>9
    add hl,hl
    ld a,(hl)
    inc l
    ld h,(hl)
    ld l,a
    ret

; G_ADDR: HL = x (0..511), E = y (0..191) -> HL = the byte holding pixel (x, y), A = its mask ($80 >> (x AND 7)).  Clobbers F, DE.
G_ADDR:
    ld a,l
    and 7
    ld d,a                  ; D = bit index
    ld a,h
    rra
    ld a,l
    rra
    rrca
    rrca
    and $3F                 ; A = byte column
    ld l,e
    ld e,a                  ; E = byte column
    ld h,ROWTAB>>9
    add hl,hl
    ld a,(hl)
    inc l
    ld h,(hl)
    ld l,a                  ; HL = row base, file 1
    ld a,e
    srl a                   ; A = offset, carry = odd column (file 2)
    jr nc,.f1
    set 5,h
.f1:
    or l
    ld l,a
    ld a,$80
    inc d
.m:
    dec d
    ret z
    rrca
    jr .m

; ---------------------------------------------------------------------------------------------------------------------
; G_SETCLIP: GA = x, y, w, h -> clip = the rectangle intersected with the screen (x0 <= x1, y0 <= y1; empty when equal).
; Clobbers AF, BC, DE, HL.
G_SETCLIP:
    ld hl,(GA_X)
    ld de,(GA_W)
    ld bc,512
    call sc_axis
    ld (GCX0),hl
    ld (GCX1),de
    ld hl,(GA_Y)
    ld de,(GA_H)
    ld bc,192
    call sc_axis
    ld (GCY0),hl
    ld (GCY1),de
    ret

; sc_axis: HL = s, DE = n (both -16384..16383), BC = limit (> 0) -> HL = a = clamp(s, 0, limit), DE = b = clamp(s + n, a, limit).
sc_axis:
    push hl
    add hl,de
    ex (sp),hl              ; (SP) = e = s + n (no overflow in the argument range), HL = s
    bit 7,h
    jr z,.a_pos
    ld hl,0                 ; s < 0
    jr .a_ok
.a_pos:
    or a
    sbc hl,bc
    jr c,.a_in              ; s < limit
    ld h,b
    ld l,c                  ; s >= limit: a = limit
    jr .a_ok
.a_in:
    add hl,bc
.a_ok:                      ; HL = a
    pop de                  ; DE = e
    bit 7,d
    jr nz,.b_a              ; e < 0 <= a
    ex de,hl                ; HL = e, DE = a
    or a
    sbc hl,de
    jr c,.b_a2              ; e < a
    add hl,de
    or a
    sbc hl,bc
    jr nc,.b_lim            ; e >= limit
    add hl,bc               ; HL = e
    ex de,hl                ; HL = a, DE = e
    ret
.b_lim:
    ex de,hl                ; HL = a
    ld d,b
    ld e,c                  ; b = limit
    ret
.b_a2:
    ex de,hl                ; HL = a
.b_a:
    ld d,h
    ld e,l                  ; b = a
    ret

; ---------------------------------------------------------------------------------------------------------------------
; G_HLINE: HL = x, DE = y, BC = w -> G_FILL (x, y, w, 1).  G_VLINE: HL = x, DE = y, BC = h -> G_FILL (x, y, 1, h).
; GA is overwritten.  Clobbers AF, BC, DE, HL.
G_HLINE:
    ld (GA_X),hl
    ld (GA_Y),de
    ld (GA_W),bc
    ld hl,1
    ld (GA_H),hl
    jr G_FILL

G_VLINE:
    ld (GA_X),hl
    ld (GA_Y),de
    ld (GA_H),bc
    ld hl,1
    ld (GA_W),hl
    jr G_FILL

; ---------------------------------------------------------------------------------------------------------------------
; G_FRAME: GA = x, y, w, h -> the outline in the draw op, each pixel once: top row, bottom row (h >= 2), then the left and right
; columns between them (h >= 3; the right one only when w >= 2).  GA is overwritten.  Clobbers AF, BC, DE, HL.
G_FRAME:
    ld hl,(GA_W)
    bit 7,h
    ret nz
    ld a,h
    or l
    ret z                   ; w <= 0
    ld hl,(GA_H)
    bit 7,h
    ret nz
    ld a,h
    or l
    ret z                   ; h <= 0
    ld hl,GA
    ld de,G_FR
    ld bc,8
    ldir                    ; G_FR = x, y, w, h
    ld hl,1
    ld (GA_H),hl
    call G_FILL             ; top: (x, y, w, 1)
    ld hl,(G_FR+6)
    dec hl
    ld a,h
    or l
    ret z                   ; h = 1
    ld de,(G_FR+2)
    add hl,de
    ld (GA_Y),hl            ; y + h - 1
    call G_FILL             ; bottom: (x, y + h - 1, w, 1)
    ld hl,(G_FR+6)
    dec hl
    dec hl
    ld a,h
    or l
    ret z                   ; h = 2
    ld (GA_H),hl            ; h - 2
    ld hl,(G_FR+2)
    inc hl
    ld (GA_Y),hl            ; y + 1
    ld hl,1
    ld (GA_W),hl
    call G_FILL             ; left: (x, y + 1, 1, h - 2)
    ld hl,(G_FR+4)
    dec hl
    ld a,h
    or l
    ret z                   ; w = 1
    ld de,(G_FR+0)
    add hl,de
    ld (GA_X),hl            ; x + w - 1
    jr G_FILL               ; right: (x + w - 1, y + 1, 1, h - 2)

; ---------------------------------------------------------------------------------------------------------------------
; G_FILL: GA = x, y, w, h -> the draw op on every pixel of the rectangle inside the clip.  GA is kept.  Clobbers AF, BC, DE, HL.
;
; After clipping the rectangle covers byte columns bc0..bc1 (n = bc1 - bc0 + 1) and rows y0..y0+R-1.  Three paths:
;   n = 1      -> vcol: a vertical walk, unrolled 8 rows a character row, mask LM AND RM;
;   n = 2..8   -> a straight-line row body for this n and op (no jumps inside the row).  HL = P, the file of bc0 at bc0 >> 1;
;                 DE = Q, the other file at (bc0 + 1) >> 1; columns alternate P, Q, P, ...  Left edge mask C, right edge IXl;
;                 serpentine (rows alternate left-to-right and right-to-left, so the pointers never need resetting);
;   n >= 9     -> the edge columns by vcol, then the whole bytes row-major: an unrolled block of alternating file 1 / file 2
;                 elements entered at an offset (IY), file 1 first (an odd first column is walked by vcol too).
; Row-major paths run one character row (a "segment" of up to 8 rows) with INC H / INC D and DJNZ, then G_SEG crosses to the
; next one (G_SEG for the row bodies, IXh = rows left; G_SEGW for the blocks, C = L = E at the row start).
G_FILL:
    ; --- y: R = min(y + h, cy1) - max(y, cy0)
    ld hl,(GA_H)
    bit 7,h
    ret nz                  ; h < 0 (h = 0 gives R <= 0 below; y + h cannot overflow)
    ld de,(GA_Y)
    add hl,de
    ld bc,(GCY1)
    or a
    sbc hl,bc
    jp p,.y1c
    add hl,bc
.y1d:
    ex de,hl                ; HL = y, DE = y1
    ld bc,(GCY0)
    or a
    sbc hl,bc
    jp m,.y0c
    add hl,bc
.y0d:
    ex de,hl                ; HL = y1, DE = y0
    or a
    sbc hl,de
    ret m
    ret z
    ld h,l
    ld l,e
    ld (G_Y0),hl            ; G_Y0 = y0, G_R = R
    ; --- x: x0 = max(x, cx0), xl = min(x + w, cx1) - 1
    ld hl,(GA_W)
    bit 7,h
    ret nz
    ld de,(GA_X)
    add hl,de
    ld bc,(GCX1)
    or a
    sbc hl,bc
    jp p,.x1c
    add hl,bc
.x1d:
    ex de,hl
    ld bc,(GCX0)
    or a
    sbc hl,bc
    jp m,.x0c
    add hl,bc
.x0d:
    ex de,hl                ; HL = x1, DE = x0
    or a
    sbc hl,de
    ret m
    ret z
    add hl,de
    dec hl                  ; HL = xl (0..511), DE = x0 (0..511)
    push ix
    push iy
    ; --- masks: IXh = LM, IXl = RM; C = bc0, B = bc1
    ld c,l
    ld b,RMASKP>>8
    ld a,(bc)               ; RMASKP[xl AND $FF] = RMASK[xl AND 7]
    ld ixl,a
    ld c,e
    dec b                   ; LMASKP is the page below RMASKP
    ld a,(bc)               ; LMASKP[x0 AND $FF] = LMASK[x0 AND 7]
    ld ixh,a
    ld a,h
    rra
    ld a,l
    rra
    rrca
    rrca
    and $3F
    ld b,a
    ld a,d
    rra
    ld a,e
    rra
    rrca
    rrca
    and $3F
    ld c,a
    ld a,b
    sub c                   ; n - 1
    jr z,.one
    cp 8
    jr nc,.wide
    ; --- n = 2..8: IY = SB_TAB[op][n - 1]; C = left mask, IXl = right mask (complemented for CLR), IXh = P's low byte
    ld e,a
    ld a,(GOP)
    cp OP_CLR
    jr nz,.nclr
    ld a,ixh
    cpl
    ld ixh,a
    ld a,ixl
    cpl
    ld ixl,a
    ld a,OP_CLR
.nclr:
    add a,a
    add a,a
    add a,a
    add a,e
    add a,a
    add a,SB_TAB&$FF        ; (SB_TAB is 64-byte aligned: no carry)
    ld l,a
    ld h,SB_TAB>>8
    ld a,(hl)
    ld iyl,a
    inc l
    ld a,(hl)
    ld iyh,a
    ld a,(G_Y0)
    ld l,a
    ld h,ROWTAB>>9
    add hl,hl
    ld a,(hl)
    inc l
    ld h,(hl)
    ld l,a                  ; HL = row base, file 1
    ld a,c
    srl a
    jr c,.sodd
    or l
    ld l,a                  ; P = file 1 at k
    ld e,a                  ; Q = file 2 at k
    ld a,h
    or $20
    ld d,a
    jr .seg
.sodd:
    or l
    ld l,a                  ; P = file 2 at k
    inc a
    ld e,a                  ; Q = file 1 at k + 1
    ld d,h
    set 5,h
.seg:
    ld c,ixh                ; C = left mask
    ld a,(G_Y0)             ; first segment: B = min(8 - (y0 AND 7), R); IXh = the rows after it
    or $F8
    neg
    ld b,a
    ld a,(G_R)
    sub b
    jr nc,.seg1
    add a,b
    ld b,a
    xor a
.seg1:
    ld ixh,a
    jp (iy)

.y1c:
    ld h,b
    ld l,c
    jp .y1d
.y0c:
    ld h,b
    ld l,c
    jp .y0d
.x1c:
    ld h,b
    ld l,c
    jp .x1d
.x0c:
    ld h,b
    ld l,c
    jp .x0d

    ; --- one byte column
.one:
    ld a,ixh
    and ixl
    ld e,a
    ld a,c
    call vcol
    jp fill_exit

    ; --- n >= 9: edges by vcol, then whole bytes row-major from an even column
.wide:
    ld (G_BC0),bc           ; G_BC0 = bc0, G_BC1 = bc1
    ld a,ixh
    ld (G_LM),a
    ld a,ixl
    ld (G_RM),a
    inc a
    jr z,.wr                ; right edge whole
    ld a,(G_RM)
    ld e,a
    ld a,b
    call vcol
    ld hl,G_BC1
    dec (hl)
.wr:
    ld a,(G_LM)
    inc a
    jr z,.wl                ; left edge whole
    ld a,(G_LM)
    ld e,a
    ld a,(G_BC0)
    call vcol
    ld hl,G_BC0
    inc (hl)
.wl:
    ld a,(G_BC0)
    rra
    jr nc,.weven
    ld e,$FF                ; an odd first whole column: walked too, so the block starts in file 1
    ld a,(G_BC0)
    call vcol
    ld hl,G_BC0
    inc (hl)
.weven:
    ld a,(GOP)
    ld c,$FF
    ld hl,FAST_S_END        ; file 1 / file 2 elements, ending in file 2 (HL, DE swapped below when the run ends in file 1)
    or a
    jr z,.wop
    ld c,0
    dec a
    jr z,.wop
    ld hl,FASTX_S_END
.wop:
    ld a,c
    ld (G_FILLB),a
    ld a,(G_BC0)
    ld c,a
    ld a,(G_BC1)
    sub c
    inc a                   ; whole bytes (1..64)
    ld e,a
    ld d,0
    ex de,hl
    add hl,hl
    ld a,(GOP)
    cp OP_XOR
    jr nz,.wsz
    add hl,hl
.wsz:
    ex de,hl
    or a
    sbc hl,de
    push hl
    pop iy                  ; IY = block end - elements * size
    ld a,(G_Y0)
    ld l,a
    ld h,ROWTAB>>9
    add hl,hl
    ld a,(hl)
    inc l
    ld h,(hl)
    ld l,a
    ld a,c
    srl a
    or l
    ld l,a
    ld e,a
    ld a,h
    or $20
    ld d,a
    ld a,(G_BC1)
    rra
    jr c,.wend              ; bc1 odd: the run ends in file 2, as the block does
    ex de,hl                ; bc1 even: HL on file 2, DE on file 1, so the block's last element (DE) is in file 1.  The row
.wend:                      ; tail and G_SEGW treat HL and DE alike.
    ld c,l
    ld a,(G_Y0)
    or $F8
    neg
    ld b,a
    ld a,(G_R)
    sub b
    jr nc,.sf1
    add a,b
    ld b,a
    xor a
.sf1:
    ld (G_ROWS),a
    ld a,(G_FILLB)
    jp (iy)

;---------------------------------------------------------------------------------------------------------------------
; Crossing to the next character row (a segment ran out, B = 0): set B for the next segment, or end G_FILL.
; G_SEG: the row bodies (P and Q at the row start; IXh = rows left).
; G_SEGW: the whole-byte blocks (C = L = E at the row start).
G_SEG:
    ld a,ixh                ; rows left
    sub 8
    jr c,.last
    ld ixh,a
    ld b,8
.go:
    ld a,l
    add a,32
    ld l,a
    ld a,e
    add a,32                ; (same carry as for L: E and L share the character row bits)
    ld e,a
    jr c,.third             ; into the next third: H, D are already there
    ld a,h
    sub 8
    ld h,a
    ld a,d
    sub 8
    ld d,a
.third:
    jp (iy)
.last:
    add a,8
    jr z,fill_exit
    ld b,a
    ld ixh,0
    jr .go

G_SEGW:
    ld a,(G_ROWS)
    sub 8
    jr c,.last
    ld (G_ROWS),a
    ld b,8
.go:
    ld a,c
    add a,32
    ld c,a
    ld l,a
    ld e,a
    jr c,.third
    ld a,h
    sub 8
    ld h,a
    ld a,d
    sub 8
    ld d,a
.third:
    ld a,(G_FILLB)
    jp (iy)
.last:
    add a,8
    jr z,fill_exit
    ld b,a
    xor a
    ld (G_ROWS),a
    jr .go

fill_exit:
    pop iy
    pop ix
    ret

; vcol: A = byte column, E = mask (as for SET) -> the draw op on that column over rows G_Y0 .. G_Y0 + G_R - 1.
; Clobbers AF, BC, DE, HL, IX, IY.
vcol:
    ld b,a
    ld a,(GOP)
    ld iy,V_SET_END
    or a
    jr z,.o
    ld iy,V_XOR_END
    cp OP_XOR
    jr z,.o
    ld iy,V_CLR_END
    ld a,e
    cpl
    ld e,a
.o:
    ld c,e
    ld a,(G_Y0)
    ld l,a
    ld h,ROWTAB>>9
    add hl,hl
    ld a,(hl)
    inc l
    ld h,(hl)
    ld l,a
    ld a,b
    srl a
    jr nc,.f1
    set 5,h
.f1:
    or l
    ld l,a
    ld a,(G_Y0)
    and 7
    ld d,a
    ld a,(G_R)
    ld e,a
    jp vwalk

; ---------------------------------------------------------------------------------------------------------------------
; Row bodies for n = 2..8 byte columns.  Column i is in P (HL) when i is even, Q (DE) when odd; column 0 takes the left mask
; (C), column n - 1 the right mask (IXl), the others are whole.  A pointer is stepped only when it is used again in the row.
    MACRO SB_LDA q
        IF q
            ld a,(de)
        ELSE
            ld a,(hl)
        ENDIF
    ENDM
    MACRO SB_STA q
        IF q
            ld (de),a
        ELSE
            ld (hl),a
        ENDIF
    ENDM
    MACRO SB_INC q
        IF q
            inc e
        ELSE
            inc l
        ENDIF
    ENDM
    MACRO SB_DEC q
        IF q
            dec e
        ELSE
            dec l
        ENDIF
    ENDM
    MACRO SB_EDGE op, right
        IF op == 0
            IF right
                or ixl
            ELSE
                or c
            ENDIF
        ELSE
            IF op == 1
                IF right
                    and ixl
                ELSE
                    and c
                ENDIF
            ELSE
                IF right
                    xor ixl
                ELSE
                    xor c
                ENDIF
            ENDIF
        ENDIF
    ENDM
    MACRO SB_FILL op
        IF op == 0
            ld a,$FF
        ENDIF
        IF op == 1
            xor a
        ENDIF
    ENDM
    MACRO SB_COL op, n
SBQ = SBI & 1
        IF SBI == 0 || SBI == n - 1
            SB_LDA SBQ
            SB_EDGE op, SBI
            SB_STA SBQ
        ELSE
            IF op == 2
                SB_LDA SBQ
                cpl
                SB_STA SBQ
            ELSE
                SB_STA SBQ
            ENDIF
        ENDIF
    ENDM
; Serpentine: a row left to right (stepping P and Q forward), the next right to left (stepping them back), so no row needs its
; pointers reset.  Left mask C, right mask IXl.
    MACRO SBODY op, n, name
name:
SBI = 0
        DUP n
            SB_COL op, n
            IF SBI + 2 <= n - 1
                SB_INC SBQ
            ENDIF
            IF SBI == 0 && n > 2
                SB_FILL op
            ENDIF
SBI = SBI + 1
        EDUP
        inc h
        inc d
        dec b
        jp nz,.bwd
SBI = (n + 1) / 2 - 1
        IF SBI > 0
            DUP SBI
                dec l
            EDUP
        ENDIF
SBI = n / 2 - 1
        IF SBI > 0
            DUP SBI
                dec e
            EDUP
        ENDIF
        jp G_SEG
.bwd:
SBI = n - 1
        DUP n
            SB_COL op, n
            IF SBI >= 2
                SB_DEC SBQ
            ENDIF
            IF SBI == n - 1 && n > 2
                SB_FILL op
            ENDIF
SBI = SBI - 1
        EDUP
        inc h
        inc d
        djnz name
        jp G_SEG
    ENDM

    SBODY 0, 2, SB_S2
    SBODY 0, 3, SB_S3
    SBODY 0, 4, SB_S4
    SBODY 0, 5, SB_S5
    SBODY 0, 6, SB_S6
    SBODY 0, 7, SB_S7
    SBODY 0, 8, SB_S8
    SBODY 1, 2, SB_C2
    SBODY 1, 3, SB_C3
    SBODY 1, 4, SB_C4
    SBODY 1, 5, SB_C5
    SBODY 1, 6, SB_C6
    SBODY 1, 7, SB_C7
    SBODY 1, 8, SB_C8
    SBODY 2, 2, SB_X2
    SBODY 2, 3, SB_X3
    SBODY 2, 4, SB_X4
    SBODY 2, 5, SB_X5
    SBODY 2, 6, SB_X6
    SBODY 2, 7, SB_X7
    SBODY 2, 8, SB_X8

    IF ($ & $FF) > 256 - 48
        ALIGN 256           ; SB_TAB must not cross a page (indexed by its low byte)
    ENDIF
SB_TAB:                     ; [op * 8 + n - 1]
    DW 0, SB_S2, SB_S3, SB_S4, SB_S5, SB_S6, SB_S7, SB_S8
    DW 0, SB_C2, SB_C3, SB_C4, SB_C5, SB_C6, SB_C7, SB_C8
    DW 0, SB_X2, SB_X3, SB_X4, SB_X5, SB_X6, SB_X7, SB_X8

; G_TEXTP's pass-block table (text.asm), placed here where it fits in a page with no padding.
    MACRO TPENT h1, h2, rs
        DW h1, h2
        DB 0, rs, 2*rs, 3*rs, 4*rs, 5*rs, 6*rs, 7*rs, 8*rs
    ENDM
    IF ($ & $FF) > 256 - 117
        ALIGN 256           ; the offsets tables must not cross a page
    ENDIF
TP_OPS:                     ; [op][S, E, O]: first-half end, second-half end, r x row size for r = 0..8 (13 bytes)
    TPENT TP_SS1, TP_SS2, 7
    TPENT TP_SE1, TP_SE2, 16
    TPENT TP_SO1, TP_SO2, 18
    TPENT TP_CS1, TP_CS2, 8
    TPENT TP_CE1, TP_CE2, 18
    TPENT TP_CO1, TP_CO2, 20
    TPENT TP_XS1, TP_XS2, 7
    TPENT TP_XE1, TP_XE2, 16
    TPENT TP_XO1, TP_XO2, 18

; ---------------------------------------------------------------------------------------------------------------------
; Whole-byte blocks for n >= 9: 64 elements of alternating file 1 / file 2.  _S ends with a file 2 element, _S2 with a file 1
; element.  SET / CLR store A (the fill byte); FASTX inverts.
    MACRO ST_F1
        ld (hl),a
        inc l
    ENDM
    MACRO ST_F2
        ld (de),a
        inc e
    ENDM
    MACRO XO_F1
        ld a,(hl)
        cpl
        ld (hl),a
        inc l
    ENDM
    MACRO XO_F2
        ld a,(de)
        cpl
        ld (de),a
        inc e
    ENDM
    MACRO FTAIL rlab
        ld l,c
        ld e,c
        inc h
        inc d
        djnz rlab
        jp G_SEGW
rlab:
        jp (iy)
    ENDM

    REPT 32
        ST_F1
        ST_F2
    ENDR
FAST_S_END:
    FTAIL FAST_S_R
    REPT 32
        XO_F1
        XO_F2
    ENDR
FASTX_S_END:
    FTAIL FASTX_S_R

; ---------------------------------------------------------------------------------------------------------------------
; vwalk: one byte column.  HL = its byte in row y0, C = mask (complemented for CLR), D = y0 AND 7, E = rows (>= 1),
; IY = V_x_END of the op.  Each V_x is 8 unrolled rows (one character row) entered at an offset, then the crossing to the next
; character row and DJNZ for the whole character rows.  Clobbers AF, BC, DE, HL, IX.
vwalk:
    ld a,8
    sub d                   ; rows to the end of the first character row
    cp e
    jr c,.multi
    ld a,e                  ; all rows inside one character row
    ld b,1
    jr .run
.multi:
    ld d,a                  ; D = k1
    ld a,e
    sub d
    ld e,a                  ; E = rows after the first character row
    rrca
    rrca
    rrca
    and $1F
    inc a
    ld b,a                  ; the first one + whole character rows
    ld a,d
    call .run
    ld a,e
    and 7
    ret z
    ld b,1                  ; the last, partial, character row
.run:                       ; A = rows to run from the entry (1..8), B = character rows: enter at V_x_END - 4 A
    push de
    add a,a
    add a,a
    neg
    ld e,a
    ld d,$FF
    push iy
    pop ix
    add ix,de
    pop de
    jp (ix)

    MACRO VSEQ opi, name, endname
name:
        REPT 8
            ld a,(hl)
            opi c
            ld (hl),a
            inc h
        ENDR
endname:
        ld a,l
        add a,32
        ld l,a
        jr c,1F
        ld a,h
        sub 8
        ld h,a
1:
        djnz name
        ret
    ENDM
    VSEQ or, V_SET, V_SET_END
    VSEQ and, V_CLR, V_CLR_END
    VSEQ xor, V_XOR, V_XOR_END

; ---------------------------------------------------------------------------------------------------------------------
; G_CLS: both display files to 0 with PUSH, interrupts as they were (never DI).  Each file is pushed from its top down to 32 bytes
; above its base; an interrupt during the fill pushes into bytes just below SP, which the fill writes next, so they heal.  Those
; 32 bytes take any interrupt's pushes (ISR depth <= 32 bytes, section 12.2) and are cleared with ordinary stores after SP is
; restored.  Clobbers AF, BC, DE, HL.
G_CLS:
    ld (G_SAVESP),sp
    ld hl,0
    ld sp,$5800
    ld b,191                ; 191 x 16 pushes = 6,112 bytes: $57FF down to $4020
.p1:
    REPT 16
        push hl
    ENDR
    djnz .p1
    ld sp,$7800
    ld b,191
.p2:
    REPT 16
        push hl
    ENDR
    djnz .p2
    ld sp,(G_SAVESP)
    xor a
    ld hl,$4000
    ld de,$6000
    ld b,4
.lo:
    REPT 8
        ld (hl),a
        ld (de),a
        inc l
        inc e
    ENDR
    djnz .lo
    ret

    INCLUDE "gfx6/text.asm"

GFX6_CODE_END:
