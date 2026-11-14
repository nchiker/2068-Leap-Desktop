; s3ln.asm -- G_LINE and its helpers (l_abs .. l_sub32; mul16 and div3216 stay in s3.asm, the toolkit uses them): cut out of s3.asm verbatim
; (docs/SIZE.md 4).  See s3sv.asm.
; ---------------------------------------------------------------------------------------------------------------------
; G_LINE: GA = x0, y0, x1, y1 -> the pixels P(i), i = 0..dmaj, of the line (section 15.2) inside the clip get the draw op.
; Clobbers AF, BC, DE, HL.
;
; The major axis is x when abs(dx) >= abs(dy), else y; the start S is the end with the smaller major coordinate.  The minor
; offset of P(i) is f(i) = floor((i dmin + h) / dmaj), h = floor(dmaj / 2) (the closed form of 15.2), with error
; e(i) = (i dmin + h) mod dmaj.  The drawn pixels are one run i0..i1: the major clip and, when the minor clip cuts, the first i
; with f(i) >= a (ceil((a dmaj - h) / dmin)) and the last with f(i) <= b.  The run starts from e(i0), f(i0) (a 32 / 16 division
; when i0 > 0) and steps with e' = e - dmaj in HL' (DE' = dmin, BC' = -dmaj): ADD HL,DE carries when the minor axis steps.
L_DX        EQU $E050               ; word
L_DY        EQU $E052               ; word
L_SMJ       EQU $E054               ; word: S's major coordinate
L_SMN       EQU $E056               ; word: S's minor coordinate
L_DMAJ      EQU $E058               ; word
L_DMIN      EQU $E05A               ; word
L_SG        EQU $E05C               ; byte: 0 minor up the axis (+1), 1 down (-1)
L_AX        EQU $E05D               ; byte: 0 x major, 1 y major
L_H         EQU $E05E               ; word: floor(dmaj / 2)
L_I0        EQU $E060               ; word
L_I1        EQU $E062               ; word
L_A         EQU $E064               ; word: minor clip, offsets a..b
L_B         EQU $E066               ; word
L_CM0       EQU $E068               ; word: major clip low
L_CM1       EQU $E06A               ; word: major clip high
L_Cm0       EQU $E06C               ; word: minor clip low
L_Cm1       EQU $E06E               ; word: minor clip high
L_F         EQU $E070               ; word: f(i0)
L_E         EQU $E072               ; word: e(i0)

G_LINE:
    ld hl,(GA+4)
    ld de,(GA+0)
    or a
    sbc hl,de
    ld (L_DX),hl
    call l_abs
    push hl                 ; adx
    ld hl,(GA+6)
    ld de,(GA+2)
    or a
    sbc hl,de
    ld (L_DY),hl
    call l_abs              ; HL = ady
    pop bc                  ; BC = adx
    ld a,c
    sub l
    ld a,b
    sbc a,h
    jr c,.ymaj              ; adx < ady
    ; --- x major: S = the end with the smaller x
    ld (L_DMAJ),bc
    xor a
    ld (L_AX),a
    ld hl,(GCX0)
    ld (L_CM0),hl
    ld hl,(GCX1)
    ld (L_CM1),hl
    ld hl,(GCY0)
    ld (L_Cm0),hl
    ld hl,(GCY1)
    ld (L_Cm1),hl
    ld hl,(L_DX)
    bit 7,h
    ld hl,(GA+0)
    ld de,(GA+2)
    ld bc,(L_DY)
    jr z,.xs
    ld hl,(GA+4)
    ld de,(GA+6)
    call l_neg_bc
.xs:
    ld (L_SMJ),hl
    ld (L_SMN),de
    jr .sgn
.ymaj:
    ld (L_DMAJ),hl
    ld a,1
    ld (L_AX),a
    ld hl,(GCY0)
    ld (L_CM0),hl
    ld hl,(GCY1)
    ld (L_CM1),hl
    ld hl,(GCX0)
    ld (L_Cm0),hl
    ld hl,(GCX1)
    ld (L_Cm1),hl
    ld hl,(L_DY)
    bit 7,h
    ld hl,(GA+2)
    ld de,(GA+0)
    ld bc,(L_DX)
    jr z,.ys
    ld hl,(GA+6)
    ld de,(GA+4)
    call l_neg_bc
.ys:
    ld (L_SMJ),hl
    ld (L_SMN),de
.sgn:                       ; BC = E's minor - S's minor
    xor a
    bit 7,b
    jr z,.sp
    call l_neg_bc
    ld a,1
.sp:
    ld (L_SG),a
    ld (L_DMIN),bc
    ld hl,(L_DMAJ)
    srl h
    rr l
    ld (L_H),hl
    ; --- major clip: i0 = max(0, cM0 - Smj), i1 = min(dmaj, cM1 - 1 - Smj)
    ld de,(L_SMJ)
    ld hl,(L_CM0)
    or a
    sbc hl,de
    bit 7,h
    jr z,.i0
    ld hl,0
.i0:
    ld (L_I0),hl
    ld hl,(L_CM1)
    dec hl
    or a
    sbc hl,de
    ld de,(L_DMAJ)
    call l_min
    ld (L_I1),hl
    ; --- minor clip: f(i) in a..b.  Up: a = cm0 - Smn, b = cm1 - 1 - Smn; down: a = Smn - cm1 + 1, b = Smn - cm0
    ld de,(L_SMN)
    ld a,(L_SG)
    or a
    jr nz,.mdn
    ld hl,(L_Cm0)
    or a
    sbc hl,de
    ld (L_A),hl
    ld hl,(L_Cm1)
    dec hl
    or a
    sbc hl,de
    ld (L_B),hl
    jr .mab
.mdn:
    ex de,hl                ; HL = Smn
    push hl
    ld de,(L_Cm1)
    or a
    sbc hl,de
    inc hl
    ld (L_A),hl
    pop hl
    ld de,(L_Cm0)
    or a
    sbc hl,de
    ld (L_B),hl
.mab:
    ld hl,(L_B)
    bit 7,h
    jp nz,l_ret             ; b < 0: f(i) >= 0 never in range
    ld hl,(L_A)
    bit 7,h
    jr nz,.nolo
    ld a,h
    or l
    jr z,.nolo              ; a <= 0: no cut at the start
    ld de,(L_DMIN)
    ld a,e
    sub l
    ld a,d
    sbc a,h
    jp m,l_ret              ; a > dmin (0 < a, so no overflow): never reached
    ; ilo = ceil((a dmaj - h) / dmin) = (a dmaj - h + dmin - 1) div dmin
    ld de,(L_DMAJ)
    call mul16              ; DE:HL = a dmaj
    ld bc,(L_H)
    call l_sub32            ; - h
    ld bc,(L_DMIN)
    dec bc
    call l_add32            ; + dmin - 1
    ld bc,(L_DMIN)
    call div3216            ; HL = ilo
    ld de,(L_I0)
    call l_max
    ld (L_I0),hl
.nolo:
    ld de,(L_DMIN)
    ld a,d
    or e
    jr z,.clipped           ; dmin = 0: f = 0 and a <= 0 <= b
    ld hl,(L_B)
    ld a,l
    sub e
    ld a,h
    sbc a,d
    jp p,.clipped           ; b >= dmin: no cut at the far end
    ; ihi = ceil(((b + 1) dmaj - h) / dmin) - 1 = ((b + 1) dmaj - h - 1) div dmin
    inc hl
    ld de,(L_DMAJ)
    call mul16
    ld bc,(L_H)
    inc bc
    call l_sub32
    ld bc,(L_DMIN)
    call div3216
    ld de,(L_I1)
    call l_min
    ld (L_I1),hl
.clipped:
    ; --- empty when i1 < i0 (i0 >= 0; a negative i1 is empty)
    ld hl,(L_I1)
    bit 7,h
    jp nz,l_ret
    ld de,(L_I0)
    or a
    sbc hl,de
    jp m,l_ret
    inc hl
    push hl                 ; the pixel count (1..32768)
    ; --- f(i0), e(i0)
    ld a,d
    or e
    jr nz,.istart
    ld hl,(L_H)
    ld (L_E),hl
    ld (L_F),de             ; 0
    jr .ok0
.istart:
    ex de,hl                ; HL = i0
    ld de,(L_DMIN)
    call mul16
    ld bc,(L_H)
    call l_add32            ; DE:HL = i0 dmin + h
    ld bc,(L_DMAJ)
    call div3216            ; HL = f, DE = e
    ld (L_F),hl
    ld (L_E),de
.ok0:
    ; --- the first pixel: major Smj + i0, minor Smn +- f
    ld hl,(L_SMJ)
    ld de,(L_I0)
    add hl,de
    push hl                 ; major
    ld hl,(L_SMN)
    ld de,(L_F)
    ld a,(L_SG)
    or a
    jr nz,.fdn
    add hl,de
    jr .fok
.fdn:
    or a
    sbc hl,de
.fok:                       ; HL = minor
    pop de                  ; DE = major
    ld a,(L_AX)
    or a
    jr nz,.yx
    ex de,hl                ; x major: HL = x, DE = y
.yx:                        ; (y major: HL = minor = x, DE = major = y)
    call G_ADDR             ; HL = byte, A = mask (E = y)
    ld c,a
    pop de                  ; DE = count
    exx
    push bc
    push de
    push hl
    ld hl,(L_E)
    ld bc,(L_DMAJ)
    or a
    sbc hl,bc               ; HL' = e - dmaj
    ld de,(L_DMIN)
    call l_neg_bc           ; BC' = -dmaj
    exx
    ; B = count AND $FF, E = (count + 255) >> 8
    ld b,e
    ld a,e
    or a
    ld a,d
    jr z,.cnt
    inc a
.cnt:
    ld e,a
    ld a,(GOP)
    cp OP_CLR
    jr nz,.nclr
    ld a,c
    cpl
    ld c,a
    ld a,OP_CLR
.nclr:                      ; loop = LN_TAB[(ax * 2 + sg) * 3 + op]
    ld d,a
    push hl
    ld hl,L_SG
    ld a,(L_AX)
    add a,a
    add a,(hl)
    ld l,a
    add a,a
    add a,l
    add a,d
    add a,a
    ld hl,LN_TAB
    add a,l
    ld l,a
    jr nc,.t
    inc h
.t:
    ld a,(hl)
    inc hl
    ld h,(hl)
    ld l,a
    ex (sp),hl              ; (SP) = the loop, HL = byte
    ret

; ln_exit: end of a loop: restore the alternate set and IX.
ln_exit:
    exx
    pop hl
    pop de
    pop bc
    exx
l_ret:
    ret

LN_TAB:                     ; [ax][sg][op]: x major (y down, y up), y major (x right, x left); SET, CLR, XOR
    DW lx_d_s, lx_d_c, lx_d_x, lx_u_s, lx_u_c, lx_u_x
    DW ly_r_s, ly_r_c, ly_r_x, ly_l_s, ly_l_c, ly_l_x

; x major: draw, error, minor step in y (down / up), x one right.  OPI = the op on (HL) with C (CLR: C = NOT mask);
; XC = the condition for "the mask left the byte" after RRC C (c for SET / XOR, nc for CLR).
    MACRO LXLOOP OPI, XC, YUP
.lp:
    ld a,(hl)
    OPI
    ld (hl),a
    exx
    add hl,de
    exx
    jr nc,.mj
    exx
    add hl,bc
    exx
    IF YUP
        ld a,h
        dec h
        and 7
        jr nz,.mj
        ld a,l
        sub 32
        ld l,a
        jr c,.mj
        ld a,h
        add a,8
        ld h,a
    ELSE
        inc h
        ld a,h
        and 7
        jr nz,.mj
        ld a,l
        add a,32
        ld l,a
        jr c,.mj
        ld a,h
        sub 8
        ld h,a
    ENDIF
.mj:
    rrc c
    jr XC,.xb
.ct:
    djnz .lp
    dec e
    jr nz,.lp
    jp ln_exit
.xb:
    ld a,h
    xor $20
    ld h,a
    and $20
    jr nz,.ct               ; file 1 -> 2: the same offset
    inc l                   ; file 2 -> 1: the next offset
    jr .ct
    ENDM

; y major: draw, error, minor step in x (right / left), y one down.  NC = the condition for "the mask stayed in the byte"
; after the rotate (nc for SET / XOR, c for CLR).
    MACRO LYLOOP OPI, NC, XLEFT
.lp:
    ld a,(hl)
    OPI
    ld (hl),a
    exx
    add hl,de
    exx
    jr nc,.mj
    exx
    add hl,bc
    exx
    IF XLEFT
        rlc c
        jr NC,.mj
        ld a,h
        xor $20
        ld h,a
        and $20
        jr z,.mj            ; file 2 -> 1: the same offset
        dec l               ; file 1 -> 2: the offset before
    ELSE
        rrc c
        jr NC,.mj
        ld a,h
        xor $20
        ld h,a
        and $20
        jr nz,.mj
        inc l
    ENDIF
.mj:
    inc h
    ld a,h
    and 7
    jr nz,.ct
    ld a,l
    add a,32
    ld l,a
    jr c,.ct
    ld a,h
    sub 8
    ld h,a
.ct:
    djnz .lp
    dec e
    jr nz,.lp
    jp ln_exit
    ENDM

lx_d_s: LXLOOP <or c>, c, 0
lx_d_c: LXLOOP <and c>, nc, 0
lx_d_x: LXLOOP <xor c>, c, 0
lx_u_s: LXLOOP <or c>, c, 1
lx_u_c: LXLOOP <and c>, nc, 1
lx_u_x: LXLOOP <xor c>, c, 1
ly_r_s: LYLOOP <or c>, nc, 0
ly_r_c: LYLOOP <and c>, c, 0
ly_r_x: LYLOOP <xor c>, nc, 0
ly_l_s: LYLOOP <or c>, nc, 1
ly_l_c: LYLOOP <and c>, c, 1
ly_l_x: LYLOOP <xor c>, nc, 1

; --- G_LINE helpers.  l_abs: HL = abs(HL).  l_neg_bc: BC = -BC.  l_min / l_max: HL = signed min / max(HL, DE).
l_abs:
    bit 7,h
    ret z
    xor a
    sub l
    ld l,a
    sbc a,a
    sub h
    ld h,a
    ret
l_neg_bc:
    xor a
    sub c
    ld c,a
    sbc a,a
    sub b
    ld b,a
    ret
l_min:                      ; (HL < DE signed: S XOR V of HL - DE)
    push hl
    or a
    sbc hl,de
    pop hl
    jp pe,.ov
    ret m
    ex de,hl
    ret
.ov:
    ret p
    ex de,hl
    ret
l_max:
    push hl
    or a
    sbc hl,de
    pop hl
    jp pe,.ov
    ret p
    ex de,hl
    ret
.ov:
    ret m
    ex de,hl
    ret
; l_add32 / l_sub32: DE:HL +- BC (unsigned 32-bit).
l_add32:
    add hl,bc
    ret nc
    inc de
    ret
l_sub32:
    or a
    sbc hl,bc
    ret nc
    dec de
    ret
