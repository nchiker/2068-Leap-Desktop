; text.asm -- gfx6 slice S2 (docs/GRAPHICS_SPIKE.md section 14): G_TEXT8 (8x8 text in cells), G_TEXTP (proportional text at
; any (x, y)), G_TEXTW (proportional width).  Included by gfx6.asm; same rules: IX, IY and the alternate set preserved, no DI / EI,
; at most 32 bytes of stack, GA unchanged.
;
; Fonts share 8 planes (FONTP, chunk 4): plane k byte c = PROP6 row k of code c, byte 128 + c = the 8x8 row k (GLYPH8 + c).  A glyph
; row is one INC D (or DEC D) away from the next.

GA_P        EQU GA+4                ; string address
GA_N        EQU GA+6                ; string length (0..255)


; =====================================================================================================================
; G_TEXT8: GA = col, row, string, n -> each character whose whole cell is inside the clip, opaque (SET, CLR) or XOR.
; Clobbers AF, BC, DE, HL.
;
; The cells alternate files (even column file 1, odd column file 2, the same offset), so the body walks a pair of cells as a
; serpentine: the even cell top to bottom (INC D, INC H), SET 5,H, the odd cell bottom to top (DEC D, DEC H), RES 5,H, INC L.
; No pointer is ever reset.  IXl counts the cells.
G_TEXT8:
    ld hl,(GA_Y)
    ld a,h
    or a
    ret nz                  ; row < 0 or >= 256
    ld a,l
    cp 24
    ret nc
    add a,a
    add a,a
    add a,a
    ld c,a                  ; C = the cell's top pixel row
    ld a,(GCY0)
    ld b,a
    ld a,c
    cp b
    ret c                   ; top < y0
    add a,8
    ld b,a
    ld a,(GCY1)
    cp b
    ret c                   ; y1 < top + 8
    ; columns: the first cell inside the clip c0 = (x0 + 7) >> 3, the end c1 = x1 >> 3
    ld hl,(GCX0)
    ld de,7
    add hl,de
    add hl,hl
    add hl,hl
    add hl,hl
    add hl,hl
    add hl,hl
    ld e,h                  ; DE = c0 (0..64)
    ld hl,(GA_X)
    or a
    sbc hl,de               ; col - c0
    ld bc,0                 ; BC = characters skipped
    jp p,.c0ok
    xor a                   ; col < c0: skip c0 - col, start at c0
    sub l
    ld c,a
    sbc a,a
    sub h
    ld b,a
    ld hl,0
.c0ok:
    add hl,de               ; HL = the first column drawn
    push hl
    ld hl,(GCX1)
    ld a,l
    srl h
    rra
    srl h
    rra
    srl h
    rra
    ld l,a
    ld h,0                  ; HL = c1
    pop de                  ; DE = first column
    or a
    sbc hl,de               ; c1 - first
    ret m
    ret z
    ld a,l                  ; A = cells available (1..64)
    ld hl,(GA_N)
    ld h,0
    or a
    sbc hl,bc               ; n - skipped
    ret m
    ret z
    inc h
    dec h
    jr nz,.cnt              ; (cannot happen: n <= 255)
    cp l
    jr c,.cnt
    ld a,l
.cnt:                       ; A = cells to draw (1..64), E = first column, BC = skipped
    push ix
    ld ixl,a
    ld a,(GOP)
    add a,a
    ld d,a
    ld a,e
    and 1
    or d
    add a,a
    add a,T8_TAB&$FF        ; (T8_TAB is 16-byte aligned: no carry)
    ld l,a
    ld h,T8_TAB>>8
    ld a,(hl)
    inc l
    ld h,(hl)
    ld l,a
    push hl                 ; the body's entry, taken by RET below
    ld hl,(GA_P)
    add hl,bc
    ld b,h
    ld c,l                  ; BC = the first character drawn
    ld a,(GA_Y)
    add a,a
    add a,a
    add a,a
    ld l,a
    ld h,ROWTAB>>9
    add hl,hl
    ld a,(hl)
    inc l
    ld h,(hl)
    ld l,a                  ; HL = the cell row's top row, file 1
    ld a,e
    srl a
    jr c,.odd
    or l
    ld l,a
    ld d,FONTP>>8           ; even: plane 0, top row
    ret
.odd:
    or l
    ld l,a
    ld a,h
    or $27
    ld h,a                  ; odd: file 2, bottom row
    ld d,(FONTP>>8)+7
    ret

    MACRO T8ROW op
        ld a,(de)
        IF op == 1
            cpl
        ENDIF
        IF op == 2
            xor (hl)
        ENDIF
        ld (hl),a
    ENDM
    MACRO T8BODY op, ev, od
ev:                         ; even cell (file 1), rows 0..7
        ld a,(bc)
        inc bc
        or $80
        ld e,a
        REPT 7
            T8ROW op
            inc d
            inc h
        ENDR
        T8ROW op
        set 5,h
        dec ixl
        jp z,t8_done
od:                         ; odd cell (file 2), rows 7..0
        ld a,(bc)
        inc bc
        or $80
        ld e,a
        REPT 7
            T8ROW op
            dec d
            dec h
        ENDR
        T8ROW op
        res 5,h
        inc l
        dec ixl
        jp nz,ev
        jp t8_done
    ENDM
    T8BODY 0, T8_SE, T8_SO
    T8BODY 1, T8_CE, T8_CO
    T8BODY 2, T8_XE, T8_XO
t8_done:
    pop ix
    ret

    IF ($ & $FF) > 256 - 12
        ALIGN 256           ; T8_TAB must not cross a page (indexed by its low byte)
    ENDIF
T8_TAB:                     ; [op * 2 + parity of the first column]
    DW T8_SE, T8_SO, T8_CE, T8_CO, T8_XE, T8_XO

; =====================================================================================================================
; G_TEXTW: GA+4 string, GA+6 n -> HL = the widest line's width (lines end at code 13).  Clobbers AF, BC, DE, HL.
G_TEXTW:
    ld de,0                 ; this line's width
    ld (G_TWM),de
    ld hl,(GA_P)
    ld a,(GA_N)
    or a
    jr z,.end
    ld b,a
.lp:
    ld a,(hl)
    inc hl
    cp 13
    jr z,.cr
    ld c,l
    ld l,a
    ld a,h
    ld h,PROP6_W>>8
    ld l,(hl)               ; advance
    ld h,a
    ld a,l
    ld l,c
    add a,e
    ld e,a
    jr nc,.nx
    inc d
.nx:
    djnz .lp
.end:
    call .max
    ld hl,(G_TWM)
    ret
.cr:
    call .max
    ld de,0
    djnz .lp
    jr .end
.max:                       ; G_TWM = max(G_TWM, DE)
    push hl
    ld hl,(G_TWM)
    or a
    sbc hl,de
    jr nc,.k
    ld (G_TWM),de
.k:
    pop hl
    ret

; =====================================================================================================================
; G_TEXTP: GA = x, y, string, n -> the PROP6 glyphs drawn in the op, clipped to the pixel; HL = pen x, DE = pen y at the end.
; Clobbers AF, BC, DE, HL.
;
; Lines.  Each line (the start, then after every code 13) is set up once by tp_setline: the font rows drawn (PROP6_R0..PROP6_R1-1,
; cut by the clip; rows outside them are blank in every glyph) and where they cross a character row.  It writes, for each pass
; block of the op, three trampolines in RAM (JP nn), so a pass enters its block at the right row with no per-glyph arithmetic:
;   TRD_t  LD D,plane; JP entry               all rows (a glyph with ink in the font's last row: a "descender")
;   TRN_t  LD D,plane-1; DEC H; JP entry+row  the same without the last row (the other 87% of the sample's glyphs), or = TRD_t
;          with a NOP when the last font row is not drawn on this line
;   TRX_t  JP entry2                          where the block continues after the character-row crossing
; Passes run upward, from the line's bottom drawn row: that is why the descender row is the one a glyph can skip.
;
; Pass blocks (t): S one byte column; E two byte columns, the left one in file 1 (the right one: file 2, same offset).  A glyph
; on two byte columns whose left one is in file 2 is drawn by two S passes (tpf_on / tpf_od): the left column, then the right
; one (file 1, offset + 1) on the SHL page.  A row: the glyph byte (D = plane, E = code) indexes the
; shift table (B = SHR page of p, C = index), the op into the screen (HL); E does both columns in one row (INC B is SHL p).
;
; Two loops.  The fast loop (tpf_*) runs while every glyph lies wholly inside the clip: pen x >= cx0 and the pen's byte column
; <= G_KF, so even an 8-pixel glyph ends at or before cx1.  Its state is in registers: main HL = string, B = codes left,
; C = byte-column steps left before G_KF, DE = the pen's screen byte in the bottom drawn row; alternate B' = SHR + 512 p (as a
; page: SHR page + 2p).  The passes run in the alternate set.  The general loop (tp_gen / tpg_*) holds the pen in G_PX; it
; handles code 13, lines with no visible row, glyphs cut by the clip (each byte masked, drawn downward: tp_mbyte, tp_mpass) and
; those wholly outside it, and enters the fast loop whenever the pen is in the fast region.
TRAMP       EQU $E040               ; 2 x 14 bytes: TRD (5), TRN (6), TRX (3) for S, E ($E05C-$E069 unused)
TRD_S       EQU TRAMP
TRN_S       EQU TRAMP+5
TRX_S       EQU TRAMP+11
TRD_E       EQU TRAMP+14
TRN_E       EQU TRAMP+19
TRX_E       EQU TRAMP+25
G_RT        EQU $E06A               ; word: ROWTAB of the line's first (top) drawn row (masked path)
G_H1        EQU $E06C               ; word: block's first-half end (tp_setline)
G_H2        EQU $E06E               ; word: block's second-half end
G_E2        EQU $E070               ; word: entry after the crossing
G_DA        EQU $E072               ; byte: plane of the top drawn row (masked path)
G_DZ        EQU $E073               ; byte: plane of the bottom drawn row
G_U         EQU $E074               ; byte: rows in the bottom character row (upward, before the crossing)
G_N2        EQU $E075               ; byte: rows after the crossing (upward)
G_SK        EQU $E076               ; byte: non-zero when the font's last row is drawn on this line (TRN skips it)
G_R1        EQU $E077               ; byte: rows from the first entry (tp_tramps)
    ASSERT TRAMP+28 <= G_RT && G_R1 < $E080

G_TEXTP:
    exx
    push bc
    push de
    push hl
    exx
    push ix
    ld ix,tpf_adv           ; where every pass block ends (JP (IX)); tpf_two / tpf_desc change it for one glyph
    ld hl,(GA_X)
    ld (G_PX),hl
    ld (G_X0),hl
    ld hl,(GA_Y)
    ld (G_PY),hl
    call tp_setline
    ld hl,(GA_P)
    ld a,(GA_N)
    ld b,a
    ; fall into the general loop

; ---------------------------------------------------------------------------------------------------------------------
; General loop: HL = string, B = codes left, pen in G_PX / G_PY.
tp_gen:
    ld a,b
    or a
    jp z,tp_end
    ld a,(G_N)
    or a
    jp z,tpg_one            ; no row of this line is visible
    push hl
    ld hl,(G_PX)
    ld de,(GCX0)
    or a
    sbc hl,de
    jp m,.no                ; x < cx0
    add hl,de
    ld a,h
    cp 2
    jr nc,.no               ; x >= 512
    rra
    ld a,l
    rra
    rrca
    rrca
    and $3F
    ld e,a                  ; E = byte column
    ld a,(G_KF)
    sub e
    jp m,.no                ; beyond the fast region
    ld c,a                  ; C = column steps left
    ld a,l
    and 7
    add a,a
    add a,SHR>>8
    exx
    ld b,a                  ; B' = SHR page + 2p
    exx
    ld a,e
    ld hl,(G_RB)
    srl a
    jr nc,.f1
    set 5,h
.f1:
    or l
    ld e,a
    ld d,h                  ; DE = the pen's screen byte, bottom drawn row
    pop hl
    jp tpf_loop
.no:
    pop hl
    ; fall into tpg_one

; One code by the general path.
tpg_one:
    ld a,(hl)
    inc hl
    dec b
    cp 13
    jp z,tp_cr
    push hl
    push bc
    ld (G_CH),a
    ld e,a
    ld d,PROP6_I>>8
    ld a,(de)
    or a
    jr z,.adv               ; no ink
    ld c,a                  ; C = ink width
    ld a,(G_N)
    or a
    call nz,tp_slowglyph
.adv:
    ld a,(G_CH)
    ld e,a
    ld d,PROP6_W>>8
    ld a,(de)
    ld hl,(G_PX)
    add a,l
    ld l,a
    jr nc,.a1
    inc h
.a1:
    ld (G_PX),hl
    pop bc
    pop hl
    jp tp_gen

; Code 13: back to the start x, down GLH, set the new line up.  HL = string, B = codes left.
tp_cr:
    push hl
    push bc
    ld hl,(G_X0)
    ld (G_PX),hl
    ld a,(GLH)
    ld e,a
    ld d,0
    ld hl,(G_PY)
    add hl,de
    ld (G_PY),hl
    call tp_setline
    pop bc
    pop hl
    jp tp_gen

tp_end:
    pop ix
    ld hl,(G_PX)
    ld de,(G_PY)
    exx
    pop hl
    pop de
    pop bc
    exx
    ret

; ---------------------------------------------------------------------------------------------------------------------
; Fast loop (registers above).  The pass set is the alternate one: HL' screen, D' plane (set by the trampoline), E' code,
; B' table page, C' index.
tpf_loop:
    ld a,(hl)
    inc hl
    push de
    exx
    pop hl                  ; the pen's screen byte
    ld e,a                  ; code
    ld d,PROP6_K>>8
    ld a,(de)               ; 2 x ink width (+ $80: descender), 0: no ink
    or a
    jp z,tpf_blank
    jp m,tpf_desc
    add a,b                 ; SHR page + 2 (p + ink width)
    cp (SHR>>8)+17
    jr nc,tpf_two           ; p + ink width > 8: two byte columns
    jp TRN_S                ; (every pass block ends with JP (IX), IX = tpf_adv)
tpf_o3:                     ; after the right column of an odd glyph: back to the SHR page, IX back to tpf_adv
    dec b
    ld ix,tpf_adv
tpf_adv:
    ld d,PROP6_A2>>8
    ld a,(de)
    add a,b
    ld b,a                  ; SHR page + 2 (p + advance)
    cp (SHR>>8)+16
    jr nc,tpf_step
    exx
    djnz tpf_loop
    jp tpf_sync
tpf_two:
    bit 5,h
    jp z,TRN_E
    ld ix,tpf_on            ; odd (left column in file 2): the left column by an S pass, then tpf_on
    jp TRN_S

tpf_desc:                   ; the same, with the font's last row
    and $7F
    add a,b
    cp (SHR>>8)+17
    jp c,TRD_S
    bit 5,h
    jp z,TRD_E
    ld ix,tpf_od
    jp TRD_S

tpf_step:                   ; A = B' = SHR page + 2 (p + advance) with p + advance >= 8: one byte column on
    sub 16
    ld b,a
    cp (SHR>>8)+16
    jr nc,tpf_step2         ; (rare) p + advance >= 16: another one after this
    exx
    ld a,d
    xor $20
    ld d,a
    and $20
    jr nz,.s
    inc e
.s:
    dec c
    jp m,tpf_out            ; past the fast region
    djnz tpf_loop
    jp tpf_sync
tpf_step2:
    exx
    ld a,d
    xor $20
    ld d,a
    and $20
    jr nz,.s
    inc e
.s:
    dec c
    jp m,tpf_out
    exx
    ld a,b
    jr tpf_step
tpf_out:
    dec b                   ; (this code is done)
    jp tpf_sync

tpf_blank:                  ; no ink: advance, or code 13
    ld a,e
    cp 13
    jp nz,tpf_adv
    exx
    dec b
    jp tp_cr

tpf_on:                     ; the right column (file 1, offset + 1) by an S pass on the SHL page
    ld ix,tpf_o3
    exx
    push de
    exx
    pop hl                  ; the pen's screen byte
    res 5,h
    inc l
    inc b
    jp TRN_S
tpf_od:                     ; as tpf_on, with the font's last row
    ld ix,tpf_o3
    exx
    push de
    exx
    pop hl
    res 5,h
    inc l
    inc b
    jp TRD_S

; Leave the fast loop: G_PX = 8 x the pen's byte column + (B' - SHR page) / 2.  Main active, HL = string, B = codes left.
tpf_sync:
    push hl
    exx
    ld a,b
    exx
    sub SHR>>8
    srl a
    ld c,a
    ld a,e
    and $1F
    add a,a
    bit 5,d
    jr z,.e
    inc a
.e:
    ld l,a
    ld h,0
    add hl,hl
    add hl,hl
    add hl,hl
    ld a,c
    add a,l
    ld l,a
    jr nc,.c
    inc h
.c:
    ld (G_PX),hl
    pop hl
    jp tp_gen

; ---------------------------------------------------------------------------------------------------------------------
; tp_setline: set the line at pen y = G_PY up.  G_N = rows drawn (0: none); masked path: G_DA, G_RT, G_S (rows before the
; crossing, downward); fast path: G_RB = ROWTAB of the bottom drawn row, G_KF, the trampolines.  Clobbers AF, BC, DE, HL.
tp_setline:
    xor a
    ld (G_N),a
    ld de,(G_PY)
    ld hl,(GCY0)
    or a
    sbc hl,de               ; cy0 - y
    jp m,.a_r0
    ld a,h
    or a
    ret nz
    ld a,l
    cp PROP6_R0
    jr nc,.a_ok
.a_r0:
    ld a,PROP6_R0
.a_ok:                      ; A = first font row drawn
    cp PROP6_R1
    ret nc
    ld c,a
    ld hl,(GCY1)
    or a
    sbc hl,de               ; cy1 - y
    ret m
    ld a,h
    or a
    jr nz,.z_r1
    ld a,l
    cp PROP6_R1
    jr c,.z_ok
.z_r1:
    ld a,PROP6_R1
.z_ok:                      ; A = z, the last font row drawn + 1
    ld b,a
    sub PROP6_R1
    ld (G_SK),a             ; 0 when z = PROP6_R1 (inverted below)
    ld a,b
    sub c
    ret c
    ret z
    ld b,a                  ; B = rows
    ld a,(G_SK)
    sub 1
    sbc a,a
    ld (G_SK),a             ; $FF when the font's last row is drawn
    ld a,c
    add a,FONTP>>8
    ld (G_DA),a
    add a,b
    dec a
    ld (G_DZ),a
    ld a,e                  ; the top drawn row's y (0..191)
    add a,c
    ld l,a
    and 7
    neg
    add a,8
    cp b
    jr c,.sd
    ld a,b
.sd:
    ld (G_S),a              ; masked path: rows before the crossing, downward
    ld a,l
    call .row
    ld (G_RT),hl
    ld a,e
    add a,c
    add a,b
    dec a                   ; the bottom drawn row's y
    ld l,a
    and 7
    inc a                   ; rows from it up to the top of its character row
    cp b
    jr c,.su
    ld a,b
.su:
    ld (G_U),a
    neg
    add a,b
    ld (G_N2),a
    ld a,l
    call .row
    ld (G_RB),hl
    ld a,b
    ld (G_N),a              ; (G_N is still read as 0 by nothing until this returns)
    ld a,(GOP)              ; TP_OPS + op * 26
    add a,a
    ld l,a                  ; t = op * 2
    add a,a
    add a,a
    ld h,a
    add a,a
    add a,h
    add a,l                 ; 13 t
    ld l,a
    ld h,0
    ld de,TP_OPS
    add hl,de
    call tp_tramps
    ld hl,(GCX1)            ; G_KF = (cx1 - 15) >> 3: a glyph at byte column <= G_KF ends at or before cx1
    ld de,-15
    add hl,de
    sra h
    rr l
    sra h
    rr l
    sra h
    rr l
    ld a,l
    ld (G_KF),a
    ret
.row:                       ; HL = ROWTAB[A].  Clobbers A.
    ld l,a
    ld h,ROWTAB>>9
    add hl,hl
    ld a,(hl)
    inc l
    ld h,(hl)
    ld l,a
    ret

    MACRO TRT trd, trn, trx
        ld e,(hl)
        inc hl
        ld d,(hl)
        inc hl              ; DE = first-half end
        ld c,(hl)
        inc hl
        ld b,(hl)
        inc hl              ; BC = second-half end; HL = the offsets (they do not cross a page)
        push hl
        ld a,(G_N2)
        add a,l
        ld l,a
        ld a,c
        sub (hl)
        ld (trx+1),a
        ld a,b
        sbc a,0
        ld (trx+2),a        ; TRX: JP second-half end - (rows after the crossing) x row size
        pop hl
        push hl
        ld a,(G_R1)
        add a,l
        ld l,a
        ld a,(G_N2)
        or a
        jr z,1F
        ld b,d
        ld c,e
1:
        ld a,c
        sub (hl)
        ld c,a
        ld a,b
        sbc a,0
        ld b,a
        ld (trd+3),bc       ; TRD: JP first entry
        ld a,(G_SK)
        or a
        jr z,2F
        pop hl
        push hl
        inc hl
        ld a,(hl)           ; row size
        add a,c
        ld c,a
        jr nc,2F
        inc b
2:
        ld (trn+4),bc       ; TRN: JP first entry (+ one row when it skips the last font row)
        pop hl
        ld bc,9
        add hl,bc           ; the next block's entry
    ENDM

; tp_tramps: HL = the op's TP_OPS entry (2 x [first-half end, second-half end, offsets r x row size for r = 0..8]) ->
; TRD / TRN / TRX for S and E.  Every byte is written each time (nothing depends on what RAM held before).
; Uses G_N, G_U, G_N2, G_DZ, G_SK.  Clobbers AF, BC, DE, HL.
tp_tramps:
    ld a,$C3                ; JP
    ld (TRD_S+2),a
    ld (TRD_E+2),a
    ld (TRN_S+3),a
    ld (TRN_E+3),a
    ld (TRX_S),a
    ld (TRX_E),a
    ld a,$16                ; LD D,n
    ld (TRD_S),a
    ld (TRD_E),a
    ld (TRN_S),a
    ld (TRN_E),a
    ld a,(G_DZ)
    ld (TRD_S+1),a
    ld (TRD_E+1),a
    ld c,0                  ; TRN: LD D,G_DZ; NOP, or (the last font row drawn) LD D,G_DZ-1; DEC H
    ld b,a
    ld a,(G_SK)
    or a
    jr z,.ns
    dec b
    ld c,$25
.ns:
    ld a,b
    ld (TRN_S+1),a
    ld (TRN_E+1),a
    ld a,c
    ld (TRN_S+2),a
    ld (TRN_E+2),a
    ld a,(G_N2)             ; the first entry: from the first-half end (crossing) or the second-half end (none)
    or a
    ld a,(G_U)
    jr nz,.r1
    ld a,(G_N)
.r1:
    ld (G_R1),a
    TRT TRD_S, TRN_S, TRX_S
    TRT TRD_E, TRN_E, TRX_E
    ret


; ---------------------------------------------------------------------------------------------------------------------
; Pass blocks, upward: TP_H1 rows, the crossing up to the previous character row, JP TRX_t, TP_H2 rows, JP (IX) (tpf_adv, or tpf_on / tpf_od / tpf_o3 for a two-pass glyph).  Entered (through
; a trampoline) at first-half end - rows x row size, or second-half end - rows x row size when there is no crossing.
; HL = screen (bottom drawn row), D = plane, E = code, B = SHR page of p.  Clobbers AF, C, D, H, L.
TP_H2       EQU PROP6_R1-PROP6_R0   ; most rows on a line
TP_H1       EQU TP_H2-1             ; most rows before a crossing (a crossing leaves at least one row after it)
    MACRO TPOP op
        IF op == 0
            or (hl)
        ENDIF
        IF op == 1
            cpl
            and (hl)
        ENDIF
        IF op == 2
            xor (hl)
        ENDIF
    ENDM
    MACRO TPROW t, op
        ld a,(de)
        ld c,a
        ld a,(bc)
        TPOP op
        ld (hl),a
        IF t == 1                   ; E: the right column is file 2, same offset
            set 5,h
            inc b
            ld a,(bc)
            TPOP op
            ld (hl),a
            res 5,h
            dec b
        ENDIF
        dec d
        dec h
    ENDM
    MACRO TPBLOCK t, op, h1end, h2end, trx
        REPT TP_H1
            TPROW t, op
        ENDR
h1end:
        ld a,l
        sub 32
        ld l,a
        jr c,1F                     ; into the previous third: H - 1 is already its row 7
        ld a,h
        add a,8
        ld h,a
1:
        jp trx
        REPT TP_H2
            TPROW t, op
        ENDR
h2end:
        jp (ix)
    ENDM
    TPBLOCK 0, 0, TP_SS1, TP_SS2, TRX_S
    TPBLOCK 1, 0, TP_SE1, TP_SE2, TRX_E
    TPBLOCK 0, 1, TP_CS1, TP_CS2, TRX_S
    TPBLOCK 1, 1, TP_CE1, TP_CE2, TRX_E
    TPBLOCK 0, 2, TP_XS1, TP_XS2, TRX_S
    TPBLOCK 1, 2, TP_XE1, TP_XE2, TRX_E
    ; row sizes in bytes: S 7 (CLR 8), E 16 (CLR 18)
    ASSERT TP_SS2 - TP_SS1 == 13 + TP_H2 * 7 && TP_SE2 - TP_SE1 == 13 + TP_H2 * 16
    ASSERT TP_CS2 - TP_CS1 == 13 + TP_H2 * 8 && TP_CE2 - TP_CE1 == 13 + TP_H2 * 18

; ---------------------------------------------------------------------------------------------------------------------
; Slow path.  tp_slowglyph: the glyph G_CH (ink width C >= 1) at pen x G_PX on the current line, each byte masked to the clip.
; Clobbers AF, BC, DE, HL.
tp_slowglyph:
    ld hl,(G_PX)
    ld a,l
    and 7
    ld (G_P),a
    add a,c
    cp 9
    sbc a,a
    ld (G_ONE),a            ; $FF: one byte column
    sra h
    rr l
    sra h
    rr l
    sra h
    rr l
    ld (G_COL),hl           ; x >> 3
    ld a,(G_P)
    add a,a
    add a,SHR>>8
    call tp_mbyte
    ld a,(G_ONE)
    or a
    ret nz
    ld hl,(G_COL)
    inc hl
    ld a,(G_P)
    add a,a
    add a,SHL>>8
    ; fall into tp_mbyte

; tp_mbyte: HL = byte column b (signed), A = table page -> that byte of the glyph, masked to the pixels of the byte inside the clip.
tp_mbyte:
    ld (G_TBL),a
    ld (G_COLB),hl
    add hl,hl
    add hl,hl
    add hl,hl
    ex de,hl                ; DE = 8 b
    ld hl,(GCX1)
    or a
    sbc hl,de               ; cx1 - 8 b
    ret m
    ret z
    ld a,h
    or a
    jr nz,.h8
    ld a,l
    cp 8
    jr c,.hok
.h8:
    ld a,8
.hok:
    ld c,a                  ; C = the end pixel in the byte (1..8)
    ld hl,(GCX0)
    or a
    sbc hl,de               ; cx0 - 8 b
    jp p,.lpos
    xor a
    jr .lok
.lpos:
    ld a,h
    or a
    ret nz
    ld a,l
.lok:                       ; A = the first pixel in the byte
    cp c
    ret nc                  ; no pixel of this byte inside the clip (so 0 <= b <= 63 below)
    ld e,a
    ld d,LMASKP>>8
    ld a,(de)
    ld b,a
    ld e,c
    dec e
    ld d,RMASKP>>8
    ld a,(de)
    and b
    ld (G_M),a
    ld a,(G_COLB)
    ld hl,(G_RT)
    srl a
    jr nc,.f1
    set 5,h
.f1:
    or l
    ld l,a
    ld a,(G_TBL)
    ld b,a
    ld a,(G_CH)
    ld e,a
    ; fall into tp_mpass

; tp_mpass: one masked byte column, downward.  HL = screen (top drawn row), B = table page, E = code; G_M, G_N, G_S, G_DA, GOP.
tp_mpass:
    ld a,(G_DA)
    ld d,a
    ld a,(G_N)
    ld (G_MN),a
    ld a,(G_S)
    ld (G_MS),a
.row:
    ld a,(de)
    ld c,a
    ld a,(bc)
    ld c,a
    ld a,(G_M)
    and c
    ld c,a
    ld a,(GOP)
    or a
    jr z,.set
    dec a
    jr z,.clr
    ld a,c
    xor (hl)
    jr .st
.set:
    ld a,c
    or (hl)
    jr .st
.clr:
    ld a,c
    cpl
    and (hl)
.st:
    ld (hl),a
    inc d
    inc h
    ld a,(G_MN)
    dec a
    ret z
    ld (G_MN),a
    ld a,(G_MS)
    dec a
    ld (G_MS),a
    jr nz,.row
    ld a,l                  ; the crossing
    add a,32
    ld l,a
    jr c,.row
    ld a,h
    sub 8
    ld h,a
    jr .row
