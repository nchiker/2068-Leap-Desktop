; s3sv.asm -- G_SCROLLV and its helpers: cut out of s3.asm verbatim (docs/SIZE.md 4, docs/PAINT.md 11.1).  In desk5 (G_LIB6) it is assembled in DOCK 6
; (mapping R); every other target includes it where it was, so their bytes do not change.
; ---------------------------------------------------------------------------------------------------------------------
; G_SCROLLV: GA = x, y, w, h, n -> the scroll region (the whole byte columns of the rectangle AND the clip, its rows) moves up by
; n rows (n > 0) or down by -n (n < 0); the rows it uncovers become paper.  Clobbers AF, BC, DE, HL.
;
; The copy uses the row code of G_SAVERECT with the display on both sides: up with LDI (rows top to bottom), down with LDD
; (bottom to top, each row right to left).  A segment is a run of rows in which neither the source nor the destination crosses
; a character row.  Each segment's heads are written by sc_seg: "step H ; step D ; LD L,src ; LD E,dst" (6 bytes), the steps
; INC (up), DEC (down), or NOP for a pointer whose row ends where L or E wraps (offset 31 of character row 7 going up, offset 0
; of character row 0 going down): its last LDI / LDD already carries into the high byte.  The paper rows are a G_FILL (CLR).
S_C0        EQU $E028               ; byte: first whole byte column
S_NC        EQU $E029               ; byte: byte columns
S_Y0        EQU $E02A               ; byte: first row of the region
S_NR        EQU $E02B               ; byte: rows of the region
S_M         EQU $E02C               ; word: abs(n)
S_YD        EQU $E02E               ; byte: destination row of the next segment
S_YS        EQU $E02F               ; byte: its source row
S_CD        EQU $E07E               ; byte: rows to the destination's next character row
S_CS        EQU $E07F               ; byte: rows to the source's
S_K         EQU $E030               ; byte: rows left to copy
S_DIR       EQU $E031               ; byte: 0 up, 1 down
S_OM        EQU $E032               ; byte: main set: offset of the first byte each row copies (left up, right down)
S_OA        EQU $E033               ; byte: alternate set: the same
S_FM        EQU $E034               ; byte: main set's file ($20 = file 2)
S_FA        EQU $E035               ; byte: alternate set's file
S_N1        EQU $E036               ; byte: n1
S_N2        EQU $E037               ; byte: n2
S_H2        EQU $E038               ; word: address of the alternate set's head
S_SAVE      EQU $E03A               ; 5 bytes: GA+0..3 (x, y) and GOP, kept across the paper G_FILL (with GA+4..7 at S_SAVE2)
S_SAVE2     EQU $E076               ; 4 bytes: GA+4..7 (w, h)
S_HA        EQU $E040               ; word: sc_ptrs: the head
S_FT        EQU $E042               ; byte: sc_ptrs: the file
S_PS        EQU $E043               ; word: sc_ptrs: source H, L
S_PD        EQU $E045               ; word: sc_ptrs: destination H, L
S_STH       EQU $E047               ; byte: sc_ptrs: the H step
S_HI        EQU $E048               ; word: sc_clip's upper limit
R_OP2       EQU $E04A               ; byte: second opcode of the copy (LDI / LDD)
S_AL        EQU $E04C               ; word: the alternate head's LD L immediate
S_AE        EQU $E04E               ; word: its LD E immediate
S_KN2       EQU $E060               ; 9 words: k x n2, k = 0..8 (one page)
S_AH        EQU $E07A               ; word: the alternate head's H step byte
S_AD        EQU $E07C               ; word: its D step byte
S_WRAP      EQU $E072               ; byte: non-zero when a row may wrap L / E (sc_seg for every segment)

G_SCROLLV:
    ld hl,(GA_P2)
    ld a,h
    or l
    ret z                   ; n = 0
    bit 7,h
    jr z,.np
    xor a
    sub l
    ld l,a
    sbc a,a
    sub h
    ld h,a                  ; HL = -n
    ld a,1
    jr .nd
.np:
    xor a
.nd:
    ld (S_DIR),a
    ld (S_M),hl
    ; --- rows: [ay, by) = [y, y + h) AND [cy0, cy1)
    ld hl,(GCY1)
    ld (S_HI),hl
    ld hl,(GA_Y)
    ld de,(GA_H)
    ld bc,(GCY0)
    call sc_clip            ; HL = a, DE = b (in the clip) or carry: empty
    ret c
    ld a,e
    sub l
    ld h,a
    ld (S_Y0),hl            ; S_Y0 = ay, S_NR = rows
    ; --- byte columns: whole ones in [ax, bx) = [x, x + w) AND [cx0, cx1): c from (ax + 7) >> 3 to bx >> 3 (exclusive)
    ld hl,(GCX1)
    ld (S_HI),hl
    ld hl,(GA_X)
    ld de,(GA_W)
    ld bc,(GCX0)
    call sc_clip
    ret c
    ld bc,7
    add hl,bc
    bit 1,h
    ret nz                  ; (ax + 7) >> 3 = 64: no whole column
    ld a,h
    rra
    ld a,l
    rra
    rrca
    rrca
    and $3F
    ld c,a                  ; C = first whole column
    ld a,d
    rra
    ld a,e
    rra
    rrca
    rrca
    and $3F                 ; A = bx >> 3 (bx = 512 gives 64 AND $3F = 0: below)
    bit 1,d
    jr z,.c1
    ld a,64
.c1:
    sub c
    ret c
    ret z                   ; no whole byte column
    ld b,a
    ld (S_C0),bc            ; S_C0 = c0, S_NC = nc
    ; --- K = rows to copy = nr - m (none when m >= nr)
    ld a,(S_NR)
    ld hl,(S_M)
    ld e,a
    ld d,0
    or a
    sbc hl,de
    jp nc,sc_paper          ; m >= nr: all paper
    xor a
    sub l
    ld (S_K),a              ; K = nr - m (1..191)
    push ix
    push iy
    exx
    push bc
    push de
    push hl
    exx
    ; --- sets: n1 = nc >> 1 in the main set (file 2 if c0 even, else file 1), n2 = nc - n1 in the alternate set
    ld a,(S_NC)
    ld b,a
    srl a
    ld (S_N1),a
    ld c,a
    ld a,b
    sub c
    ld (S_N2),a
    ld a,(S_C0)
    ld b,a
    srl a
    ld e,a                  ; E = c0 >> 1 (alternate set's first offset)
    ld a,b
    and 1
    ld d,$20
    jr z,.fe
    ld d,0
.fe:
    ld a,d
    ld (S_FM),a
    xor $20
    ld (S_FA),a
    ld a,b
    and 1
    add a,e
    ld d,a                  ; D = main set's first offset
    ld a,(S_DIR)
    or a
    jr z,.ou
    ld a,(S_N1)             ; down: the last offsets
    add a,d
    dec a
    ld d,a
    ld a,(S_N2)
    add a,e
    dec a
    ld e,a
.ou:
    ld a,(S_N1)             ; n1 = 0 (one column): the main set copies nothing, but sc_gs* / sc_gd* read its immediates to find
    or a                    ; the character row, so its offset must be in the row: the alternate set's (else 32 at column 63
    jr nz,.om               ; going up, or -1 at column 0 going down)
    ld d,e
.om:
    ld a,d
    ld (S_OM),a
    ld a,e
    ld (S_OA),a
    ; --- the row code: head (6) LDx x n1, EXX, head (6), LDx x n2, EXX, JP PE,GCODE, JP sc_seg
    ld hl,GCODE+6
    ld a,(S_N1)
    call sc_wrchain
    ld (hl),OPC_EXX
    inc l
    ld (S_H2),hl            ; its step bytes and immediates are written by sc_seg
    inc l
    inc l
    ld (hl),$2E             ; LD L,n
    inc l
    inc l
    ld (hl),$1E             ; LD E,n
    inc l
    inc l
    ld a,(S_N2)
    call sc_wrchain
    ld (hl),OPC_EXX
    inc l
    ld (hl),OPC_JPPE
    inc l
    ld (hl),GCODE&$FF
    inc l
    ld (hl),GCODE>>8
    inc l
    ld (hl),OPC_JP
    inc l
    push hl
    call sc_setup2          ; S_KN2, S_AL / S_AE, S_WRAP; DE = the segment handler
    pop hl
    ld (hl),e
    inc l
    ld (hl),d
    ld a,$2E
    ld (GCODE+2),a
    ld a,$1E
    ld (GCODE+4),a
    ; --- first segment: up from the top (destination ay, source ay + m), down from the bottom (destination by - 1, source
    ; by - 1 - m)
    ld hl,(S_Y0)            ; L = ay, H = nr
    ld a,(S_M)
    ld b,a                  ; B = m (< nr <= 192)
    ld a,(S_DIR)
    or a
    ld a,l
    jr nz,.fd
    ld (S_YD),a
    add a,b
    ld (S_YS),a
    jr .cnt
.fd:
    add a,h
    dec a
    ld (S_YD),a
    sub b
    ld (S_YS),a
.cnt:                       ; rows to each pointer's next character row: up 8 - (y AND 7), down (y AND 7) + 1
    ld a,(S_DIR)
    or a
    ld a,(S_YD)
    call sc_tocr
    ld (S_CD),a
    ld a,(S_DIR)
    or a
    ld a,(S_YS)
    call sc_tocr
    ld (S_CS),a
    ; fall into sc_seg

; sc_seg (main set): the first segment.  Sets the heads (sc_ptrs, from the rows S_YD / S_YS), H / D and H' / D', BC'.
sc_seg:
    ld a,(S_YD)
    ld d,a
    ld a,(S_YS)
    ld e,a
    push de
    call sc_next
    pop de                  ; D / E = the segment's first destination / source row
    jp z,sc_copied
    ld hl,GCODE             ; main set
    ld a,(S_N1)
    ld b,a
    ld a,(S_OM)
    ld c,a
    ld a,(S_FM)
    call sc_ptrs
    push bc                 ; B = H, C = D
    ld hl,(S_H2)            ; alternate set
    ld a,(S_N2)
    ld b,a
    ld a,(S_OA)
    ld c,a
    ld a,(S_FA)
    call sc_ptrs
    ld a,b
    exx
    ld h,a
    exx
    ld a,c
    exx
    ld d,a
    exx
    pop bc
    ld h,b
    ld d,c
    jp GCODE

; sc_tocr: A = a row, Z = up -> A = rows to its character row's end in that direction.
sc_tocr:
    jr nz,.dn
    or $F8
    neg
    ret
.dn:
    and 7
    inc a
    ret

; sc_next (main set): the next segment from S_K, S_CD, S_CS.  Z when no rows are left; else NZ, BC' = its rows x n2 (S_KN2),
; and S_K, S_YD, S_YS move on past it.  Uses A, BC, E, L only: H, D, H', D' (the display pointers) are kept.
sc_next:
    ld a,(S_K)
    or a
    ret z
    ld c,a                  ; C = rows left
    ld a,(S_CD)
    ld b,a
    ld a,(S_CS)
    cp b
    jr nc,.l1
    ld b,a
.l1:
    ld a,c
    cp b
    jr nc,.l2
    ld b,a                  ; B = segment rows = min(rows left, to either crossing)
.l2:
    ld a,c
    sub b
    ld (S_K),a
    ld a,(S_CD)
    sub b
    ld (S_CD),a
    ld a,(S_CS)
    sub b
    ld (S_CS),a
    ld a,b
    add a,a
    add a,S_KN2&$FF
    ld c,a
    ld b,S_KN2>>8
    ld a,(bc)
    exx
    ld c,a
    exx
    inc c
    ld a,(bc)
    exx
    ld b,a
    exx
    xor a
    inc a                   ; NZ
    ret

; sc_fseg (main set): the segment handler when no row can wrap (S_WRAP = 0).  A pointer whose character row ended moves its two
; immediates (L for the source, E for the destination) by 32 and its high bytes (both sets) to the next character row: up
; H - 8 in the same third, unchanged in the next (line 7 of a third is one below line 0 of the next); down the reverse.
sc_fseg:
    ld a,(S_DIR)
    or a
    jr nz,.dn
    ld a,(S_CD)
    or a
    call z,sc_xdu
    ld a,(S_CS)
    or a
    call z,sc_xsu
    jr .nx
.dn:
    ld a,(S_CD)
    or a
    call z,sc_xdd
    ld a,(S_CS)
    or a
    call z,sc_xsd
.nx:
    call sc_next
    jp z,sc_copied
    jp GCODE

    MACRO SC_X IMM, ALT, OPA, REG, OPB
        ld a,(IMM)
        OPA 32
        ld (IMM),a
        ld bc,(ALT)
        ld a,(bc)
        OPA 32
        ld (bc),a
        ret c
        ld a,REG
        OPB 8
        ld REG,a
        exx
        ld a,REG
        OPB 8
        ld REG,a
        exx
        ret
    ENDM
sc_xdu:
    ld a,8
    ld (S_CD),a
        SC_X GCODE+5, S_AE, <add a,>, d, <sub>
sc_xsu:
    ld a,8
    ld (S_CS),a
        SC_X GCODE+3, S_AL, <add a,>, h, <sub>
sc_xdd:
    ld a,8
    ld (S_CD),a
        SC_X GCODE+5, S_AE, <sub>, d, <add a,>
sc_xsd:
    ld a,8
    ld (S_CS),a
        SC_X GCODE+3, S_AL, <sub>, h, <add a,>

; sc_gseg (main set): the segment handler when a row may wrap (S_WRAP).  As sc_fseg, and each set's crossed pointer also checks
; the wrap: a set wraps in the new character row (up: immediate + n = 256; down: immediate + 1 = n) -> its step byte is NOP and
; its high byte starts on the row (not one step back); leaving such a row undoes it first.
sc_gseg:
    ld a,(S_DIR)
    or a
    jr nz,.dn
    ld a,(S_CD)
    or a
    call z,sc_gdu
    ld a,(S_CS)
    or a
    call z,sc_gsu
    jr .nx
.dn:
    ld a,(S_CD)
    or a
    call z,sc_gdd
    ld a,(S_CS)
    or a
    call z,sc_gsd
.nx:
    call sc_next
    jp z,sc_copied
    jp GCODE

; XG: one set's pointer moves to the next character row.  LDIMM / LDSTEP load BC with its immediate / step byte address; NV =
; the set's n; REG = its high byte (h source, d destination); UP = 1 up, 0 down; OPC = its INC / DEC opcode.  Uses A, BC, E.
    MACRO XG LDIMM, LDSTEP, NV, REG, UP, OPC
        LDSTEP
        ld a,(bc)
        or a
        jr nz,.n1
        IF UP
            dec REG
        ELSE
            inc REG
        ENDIF
.n1:
        LDIMM
        ld a,(bc)
        IF UP
            add a,32
        ELSE
            sub 32
        ENDIF
        ld (bc),a
        ld e,a
        jr c,.n2
        ld a,REG
        IF UP
            sub 8
        ELSE
            add a,8
        ENDIF
        ld REG,a
.n2:
        ld a,(NV)
        or a
        jr z,.nw
        IF UP
            add a,e
            jr nz,.nw
            jr nc,.nw
            inc REG
        ELSE
            dec a
            cp e
            jr nz,.nw
            dec REG
        ENDIF
        xor a
        jr .st
.nw:
        ld a,OPC
.st:
        LDSTEP
        ld (bc),a
    ENDM

sc_gdu:
    ld a,8
    ld (S_CD),a
    ld a,(GCODE+5)
    cp $C0
    jp c,sc_xdu              ; from character row 0..5: neither row 7 nor leaving it
            XG <ld bc,GCODE+5>, <ld bc,GCODE+1>, S_N1, d, 1, $14
sc_gdu_a:   exx
            XG <ld bc,(S_AE)>, <ld bc,(S_AD)>, S_N2, d, 1, $14
            exx
            ret
sc_gsu:
    ld a,8
    ld (S_CS),a
    ld a,(GCODE+3)
    cp $C0
    jp c,sc_xsu              ; from character row 0..5: neither row 7 nor leaving it
            XG <ld bc,GCODE+3>, <ld bc,GCODE+0>, S_N1, h, 1, $24
sc_gsu_a:   exx
            XG <ld bc,(S_AL)>, <ld bc,(S_AH)>, S_N2, h, 1, $24
            exx
            ret
sc_gdd:
    ld a,8
    ld (S_CD),a
    ld a,(GCODE+5)
    cp $40
    jp nc,sc_xdd             ; from character row 2..7: neither row 0 nor leaving it
            XG <ld bc,GCODE+5>, <ld bc,GCODE+1>, S_N1, d, 0, $15
sc_gdd_a:   exx
            XG <ld bc,(S_AE)>, <ld bc,(S_AD)>, S_N2, d, 0, $15
            exx
            ret
sc_gsd:
    ld a,8
    ld (S_CS),a
    ld a,(GCODE+3)
    cp $40
    jp nc,sc_xsd             ; from character row 2..7: neither row 0 nor leaving it
            XG <ld bc,GCODE+3>, <ld bc,GCODE+0>, S_N1, h, 0, $25
sc_gsd_a:   exx
            XG <ld bc,(S_AL)>, <ld bc,(S_AH)>, S_N2, h, 0, $25
            exx
            ret

; sc_setup2: S_KN2[k] = k x n2; S_AL / S_AE = the alternate head's immediates; S_WRAP = a row may end where L / E wraps (up:
; a set's last offset is 31; down: its first is 0).  Returns DE = sc_fseg, or sc_seg when S_WRAP.  Clobbers AF, BC, HL.
sc_setup2:
    ld hl,S_KN2
    ld de,0
    ld a,(S_N2)
    ld c,a
    ld b,9
.t:
    ld (hl),e
    inc l
    ld (hl),d
    inc l
    ld a,e
    add a,c
    ld e,a
    jr nc,.tn
    inc d
.tn:
    djnz .t
    ld hl,(S_H2)
    inc l
    inc l
    inc l
    ld (S_AL),hl
    inc l
    inc l
    ld (S_AE),hl
    ld hl,(S_H2)
    ld (S_AH),hl
    inc l
    ld (S_AD),hl
    ld b,0
    ld a,(S_DIR)
    or a
    jr nz,.wd
    ld a,(S_N1)             ; up: main OM + n1 - 1 = 31 (n1 > 0), alternate OA + n2 - 1 = 31
    or a
    jr z,.wa
    ld c,a
    ld a,(S_OM)
    add a,c
    cp 32
    jr nz,.wa
    inc b
.wa:
    ld a,(S_N2)
    ld c,a
    ld a,(S_OA)
    add a,c
    cp 32
    jr nz,.wx
    inc b
    jr .wx
.wd:                        ; down: OM + 1 = n1 (n1 > 0), OA + 1 = n2
    ld a,(S_N1)
    or a
    jr z,.wb
    ld c,a
    ld a,(S_OM)
    inc a
    cp c
    jr nz,.wb
    inc b
.wb:
    ld a,(S_N2)
    ld c,a
    ld a,(S_OA)
    inc a
    cp c
    jr nz,.wx
    inc b
.wx:
    ld a,b
    ld (S_WRAP),a
    ld de,sc_fseg
    or a
    ret z
    ld de,sc_gseg
    ret

; sc_copied (main set): restore the saved registers, then the paper rows.
sc_copied:
    exx
    pop hl
    pop de
    pop bc
    exx
    pop iy
    pop ix
; sc_paper: rows uncovered: up the last min(m, nr) rows of the region, down the first.  A G_FILL (CLR) of whole bytes inside the
; clip; GA and GOP are kept.
sc_paper:
    ld hl,(GA_X)
    ld (S_SAVE),hl
    ld hl,(GA_Y)
    ld (S_SAVE+2),hl
    ld hl,(GA_W)
    ld (S_SAVE2),hl
    ld hl,(GA_H)
    ld (S_SAVE2+2),hl
    ld a,(GOP)
    ld (S_SAVE+4),a
    ld hl,(S_Y0)            ; L = ay, H = nr
    ld de,(S_M)
    ld a,d
    or a
    jr nz,.big
    ld a,e
    cp h
    jr c,.mok
.big:
    ld e,h                  ; m' = nr
.mok:                       ; E = rows of paper
    ld a,(S_DIR)
    or a
    ld a,l
    jr nz,.top
    add a,h
    sub e                   ; up: ay + nr - m'
.top:
    ld l,a
    ld h,0
    ld (GA_Y),hl
    ld l,e
    ld (GA_H),hl
    ld a,(S_C0)
    ld l,a
    add hl,hl
    add hl,hl
    add hl,hl
    ld (GA_X),hl
    ld a,(S_NC)
    ld l,a
    ld h,0
    add hl,hl
    add hl,hl
    add hl,hl
    ld (GA_W),hl
    ld a,OP_CLR
    ld (GOP),a
    call G_FILL
    ld hl,(S_SAVE)
    ld (GA_X),hl
    ld hl,(S_SAVE+2)
    ld (GA_Y),hl
    ld hl,(S_SAVE2)
    ld (GA_W),hl
    ld hl,(S_SAVE2+2)
    ld (GA_H),hl
    ld a,(S_SAVE+4)
    ld (GOP),a
    ret

; sc_ptrs: one set's head and its starting H and D for a segment.  In: HL = the head, A = the set's file ($00 / $20), B = its n,
; C = its first offset, D = destination row, E = source row.  Out: B = H, C = D.  Keeps DE.  Clobbers AF, HL.
sc_ptrs:
    ld (S_HA),hl
    ld (S_FT),a
    ld l,e
    call sc_rowc
    call sc_one
    ld (S_PS),hl
    or a
    jr z,.s0
    ld a,(S_DIR)
    add a,$24               ; INC H / DEC H
.s0:
    ld (S_STH),a
    ld l,d
    call sc_rowc
    call sc_one
    ld (S_PD),hl
    or a
    jr z,.d0
    ld a,(S_DIR)
    add a,$14               ; INC D / DEC D
.d0:
    ld hl,(S_HA)
    inc l
    ld (hl),a
    dec l
    ld a,(S_STH)
    ld (hl),a
    inc l
    inc l
    inc l
    ld a,(S_PS)
    ld (hl),a               ; LD L,source
    inc l
    inc l
    ld a,(S_PD)
    ld (hl),a               ; LD E,destination
    ld a,(S_PS+1)
    ld b,a
    ld a,(S_PD+1)
    ld c,a
    ret

; sc_rowc: L = row -> H = its high byte + the file (S_FT), L = its low byte + C.  Clobbers A.
sc_rowc:
    ld h,ROWTAB>>9
    add hl,hl
    ld a,(hl)
    add a,c
    inc l
    ld h,(hl)
    ld l,a
    ld a,(S_FT)
    add a,h
    ld h,a
    ret

; sc_one: H, L = a row's first byte, B = n.  Returns A = 0 when the row's last LDI / LDD wraps L (up: L + n = 256; down:
; L + 1 = n), else A = 1 and H one step back (up H - 1, down H + 1), so the head's INC / DEC lands on the row.
sc_one:
    ld a,b
    or a
    jr z,.norm
    ld a,(S_DIR)
    or a
    jr nz,.dn
    ld a,l
    add a,b
    jr nz,.norm
    jr nc,.norm
    xor a
    ret
.dn:
    ld a,l
    inc a
    cp b
    jr nz,.norm
    xor a
    ret
.norm:
    ld a,(S_DIR)
    or a
    jr nz,.nd
    dec h
    ld a,1
    ret
.nd:
    inc h
    ld a,1
    ret

; sc_clip: HL = s, DE = n (-16384..16383), BC = lo, (S_HI) = hi -> HL = max(s, lo), DE = min(s + n, hi); carry when DE <= HL.
sc_clip:
    push hl
    add hl,de
    ex de,hl                ; DE = s + n
    pop hl
    ld a,l
    sub c
    ld a,h
    sbc a,b
    jp p,.a
    ld h,b
    ld l,c
.a:
    push hl
    ld hl,(S_HI)
    ld a,e
    sub l
    ld a,d
    sbc a,h
    jp m,.b
    ex de,hl
.b:
    pop hl
    ld a,l
    sub e
    ld a,h
    sbc a,d
    jp m,.ok                ; HL < DE
    scf
    ret
.ok:
    or a
    ret

; sc_wrchain: A = n -> n LDI (up) or LDD (down) at HL.
sc_wrchain:
    push af
    ld a,(S_DIR)
    or a
    ld a,OPC_LDI2
    jr z,.o
    ld a,$A8                ; LDD
.o:
    ld (R_OP2),a
    pop af
    jp rc_wrlx

