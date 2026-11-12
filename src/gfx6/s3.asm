; s3.asm -- slice S3 of the mode 6 graphics core (docs/GRAPHICS_SPIKE.md section 15; as built: 13.3): G_SAVERECT /
; G_RESTRECT (byte rectangle save-under), G_SCROLLV, G_PRESHIFT / G_BLIT (masked bitmaps from pre-shifted copies), G_LINE.
; Included by gfx6.asm (inside GFX6_CODE .. GFX6_CODE_END).
;
; Row copies (save, restore, scroll) run in code written for each call at GCODE ($E700, 256 bytes, section 15.1): one row of
; the call's width is "head, LDI x n1, EXX, head, LDI x n2, EXX, JP PE,row".  The main set copies one display file, the alternate
; set the other, so a row costs no computed jump.  A row's byte columns split into n1 = nc >> 1 bytes of one file and
; n2 = nc - n1 (>= 1) of the other: with an even first column the main set takes file 2 and the alternate set file 1, with an
; odd one the other way round.  Both start at the same offset Ls, except file 1 at Ls + 1 when the first column is odd.
; The rows of a character row form a segment.  BC' counts the alternate set's bytes in the segment, so the LDI that copies its
; last byte clears P/V and the row loop falls out to the segment handler (in ROM).  Heads step the display row first (INC H /
; INC D), so a segment starts with H one below its first row.

R_DATA      EQU $E01A               ; word: buffer data (header + 4)
R_C0        EQU $E01C               ; byte: first byte column
R_NC        EQU $E01D               ; byte: byte columns
R_Y0        EQU $E01E               ; byte: first row
R_NR        EQU $E01F               ; byte: rows
R_N2X8      EQU $E020               ; word: BC' for a full segment (8 x n2)
R_LAST      EQU $E022               ; word: BC' for the last segment
R_MODE      EQU $E024               ; byte: 0 save, 1 restore
R_WRAP      EQU $E025               ; byte: bit 0 main set, bit 1 alternate set: its row ends at offset 31 (see rw_in)
R_H2        EQU $E026               ; word: address of the alternate set's head (its INC)
GA_P2       EQU GA+8                ; fifth argument (section 15.1)
GCODE       EQU $E700               ; generated row code (section 15.1)

OPC_LDI1    EQU $ED
OPC_LDI2    EQU $A0
OPC_EXX     EQU $D9
OPC_JPPE    EQU $EA
OPC_JP      EQU $C3

; ---------------------------------------------------------------------------------------------------------------------
; G_SAVERECT: GA = x, y, w, h, buffer -> the byte rectangle of (x, y, w, h) clamped to the screen saved at the buffer: a header
; (c0, nc, y0, nr) and nc x nr bytes.  Returns HL = buffer + 4 + nc x nr.  Clobbers AF, BC, DE, HL.
G_SAVERECT:
    ld hl,(GA_Y)
    ld de,(GA_H)
    ld bc,192
    call sc_axis            ; HL = ay, DE = by
    ld a,e
    sub l
    jr z,sv_empty
    ld h,a
    ld (R_Y0),hl            ; R_Y0 = y0, R_NR = nr
    ld hl,(GA_X)
    ld de,(GA_W)
    ld bc,512
    call sc_axis            ; HL = ax, DE = bx
    ld a,e
    sub l
    ld c,a
    ld a,d
    sbc a,h
    or c
    jr z,sv_empty
    dec de                  ; the last pixel
    ld a,h
    rra
    ld a,l
    rra
    rrca
    rrca
    and $3F
    ld c,a                  ; C = c0
    ld a,d
    rra
    ld a,e
    rra
    rrca
    rrca
    and $3F                 ; A = c1
    sub c
    inc a
    ld b,a                  ; B = nc
    ld (R_C0),bc
    ld hl,(GA_P2)
    ld (hl),c
    inc hl
    ld (hl),b
    inc hl
    ld de,(R_Y0)
    ld (hl),e
    inc hl
    ld (hl),d
    inc hl
    ld (R_DATA),hl
    xor a
    jp rc_go
sv_empty:                   ; no pixel on the screen: header 0, 0, 0, 0
    ld hl,(GA_P2)
    xor a
    ld (hl),a
    inc hl
    ld (hl),a
    inc hl
    ld (hl),a
    inc hl
    ld (hl),a
    inc hl
    ret

; G_RESTRECT: HL = a buffer G_SAVERECT wrote -> its bytes back on the screen.  Clobbers AF, BC, DE, HL.
G_RESTRECT:
    ld e,(hl)
    inc hl
    ld d,(hl)
    inc hl
    ld a,d
    or a
    ret z                   ; nc = 0
    ld (R_C0),de
    ld e,(hl)
    inc hl
    ld d,(hl)
    inc hl
    ld (R_Y0),de
    ld (R_DATA),hl
    ld a,1

; rc_go: A = 0 save (screen -> buffer), 1 restore (buffer -> screen), for R_C0, R_NC, R_Y0, R_NR, R_DATA.  The save returns
; HL = the end of the data.
rc_go:
    ld (R_MODE),a
    push ix
    push iy
    ex af,af'
    push af
    ex af,af'
    exx
    push bc
    push de
    push hl
    exx
    ; --- generate the row: heads "INC H ; LD L,A" (save) or "INC D ; LD E,A" (restore), plus INC L / INC E in the main set's
    ; head when the first column is odd (its file 1 starts at Ls + 1)
    ld de,$246F             ; D = INC H, E = LD L,A
    or a
    jr z,.ops
    ld de,$145F             ; D = INC D, E = LD E,A
.ops:
    ld hl,GCODE
    ld (hl),d
    inc l
    ld (hl),e
    inc l
    ld a,(R_C0)
    rra
    jr nc,.even
    ld a,d
    add a,8                 ; INC L / INC E
    ld (hl),a
    inc l
.even:
    ld a,(R_NC)
    srl a                   ; n1
    call rc_wrldi
    ld (hl),OPC_EXX
    inc l
    ld (R_H2),hl
    ld (hl),d
    inc l
    ld (hl),e
    inc l
    ld a,(R_NC)
    inc a
    srl a                   ; n2
    call rc_wrldi
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
    call rc_wrapf           ; R_WRAP
    pop hl
    ld bc,rcs_seg0
    ld a,(R_MODE)
    or a
    jr z,.hm
    ld bc,rcr_seg0
.hm:
    ld a,(R_WRAP)
    or a
    jr nz,.hset             ; rcs_seg0 / rcr_seg0: JP to the wrap-capable handler
    inc bc
    inc bc
    inc bc                  ; rcs_seg / rcr_seg
.hset:
    ld (hl),c
    inc l
    ld (hl),b
    ; --- counters: R_N2X8 = 8 n2; DE = n2
    ld a,(R_NC)
    inc a
    srl a
    ld e,a
    ld d,0
    ld l,a
    ld h,d
    add hl,hl
    add hl,hl
    add hl,hl
    ld (R_N2X8),hl
    ; first segment s1 = min(8 - (y0 AND 7), nr); the rest r = nr - s1: IYl = r >> 3 full segments, + 1 if r AND 7 (then the
    ; last one is short).  R_LAST = BC' for the last segment
    ld hl,(R_Y0)            ; L = y0, H = nr
    ld a,l
    or $F8
    neg                     ; 8 - (y0 AND 7)
    ld b,a
    ld a,h
    sub b
    jr nc,.r
    ld b,h                  ; s1 = nr
    xor a
.r:                         ; B = s1, A = r
    ld c,a
    rra
    rra
    rra
    and $1F
    ld iyl,a
    ld a,c
    and 7
    jr z,.nolast
    inc iyl
    push bc
    ld b,a
    call rc_mul             ; HL = (r AND 7) x n2
    pop bc
    jr .last
.nolast:
    ld hl,(R_N2X8)
.last:
    ld (R_LAST),hl
    call rc_mul             ; HL = s1 x n2
    push hl                 ; first segment's BC'
    ; region 2 = data + n1 x nr
    ld a,(R_NR)
    ld e,a                  ; DE = nr
    ld a,(R_NC)
    srl a                   ; n1 (0..32)
    ld hl,(R_DATA)
.m1:
    srl a
    jr nc,.m2
    add hl,de
.m2:
    jr z,.r2
    ex de,hl
    add hl,hl
    ex de,hl
    jr .m1
.r2:
    push hl                 ; region 2
    ; --- display rows.  B = H - 1 of the first row in file 1 = $3F + ((y0 AND $C0) >> 3) + (y0 AND 7)
    ld a,(R_Y0)
    ld c,a
    and $C0
    rrca
    rrca
    rrca
    add a,$3F
    ld e,a                  ; E = line 0's H - 1, file 1
    ld a,c
    and 7
    add a,e
    ld b,a
    ld d,e
    ld a,(R_C0)
    rra
    jr c,.hodd
    ld a,b                  ; even: main set file 2, alternate set file 1
    add a,$20
    ld c,b
    ld b,a
    ld a,d
    add a,$20
    ld ixl,a
    ld ixh,d
    jr .hok
.hodd:                      ; odd: main set file 1, alternate set file 2
    ld a,b
    add a,$20
    ld c,a
    ld ixl,d
    ld a,d
    add a,$20
    ld ixh,a
.hok:                       ; B / C = main / alternate H - 1; IXl / IXh = the same for line 0 (rcr_seg)
    ld a,(R_MODE)
    or a
    ld a,c
    jr nz,.rset
    exx                     ; save: HL / HL' display, DE / DE' buffer
    pop de                  ; DE' = region 2
    pop bc                  ; BC' = first segment
    ld h,a
    exx
    ld h,b
    ld de,(R_DATA)
    jr .go
.rset:
    exx                     ; restore: DE / DE' display, HL / HL' buffer
    pop hl
    pop bc
    ld d,a
    exx
    ld d,b
    ld hl,(R_DATA)
.go:                        ; A = Ls = ((y0 AND $38) << 2) + (c0 >> 1)
    ld a,(R_Y0)
    and $38
    add a,a
    add a,a
    ld b,a
    ld a,(R_C0)
    srl a
    add a,b
    cp $E0
    jp c,GCODE
    ld c,a
    ld a,(R_WRAP)
    or a
    ld a,c
    call nz,rw_in           ; the first segment is character row 7
    jp GCODE

; Segment handlers: the row code falls out here (main set, A = Ls) after the last row of a segment, which is line 7 of its
; character row unless the copy is done.  rcs_seg (save, display in HL / HL'): the next segment's H - 1 is H - 8 in the same
; third, H in the next.  rcr_seg (restore, display in DE / DE'): IXl / IXh, + 8 for a new third.
rcs_seg0:
    jp rcs_segw             ; (rcs_seg0 + 3 = rcs_seg)
rcs_seg:
    add a,32
    jr c,.th
    ex af,af'
    ld a,h
    sub 8
    ld h,a
    exx
    ld a,h
    sub 8
    ld h,a
.cnt:
    dec iyl
    jp m,rc_done
    jr z,.fin
    ld bc,(R_N2X8)
.go:
    exx
    ex af,af'
    jp GCODE
.fin:
    ld bc,(R_LAST)
    jr .go
.th:
    ex af,af'
    exx
    jr .cnt

rcr_seg0:
    jp rcr_segw
rcr_seg:
    add a,32
    jr c,.th
.t:
    ld d,ixl
    exx
    ld d,ixh
    dec iyl
    jp m,rc_done
    jr z,.fin
    ld bc,(R_N2X8)
.go:
    exx
    jp GCODE
.fin:
    ld bc,(R_LAST)
    jr .go
.th:
    ld c,a                  ; (main BC only counts)
    ld a,ixl
    add a,8
    ld ixl,a
    ld a,ixh
    add a,8
    ld ixh,a
    ld a,c
    jr .t

; Wrap-capable handlers, used when a set's row ends at offset 31 (R_WRAP): in character row 7 of a third that offset is L = $FF
; and the set's last LDI carries into its display high byte.  rw_in makes that byte the step for the segment (the head's INC
; becomes NOP, the high byte starts one higher); rw_out undoes it at the next third.
rcs_segw:
    add a,32
    jr c,.th
    ex af,af'
    ld a,h
    sub 8
    ld h,a
    exx
    ld a,h
    sub 8
    ld h,a
    exx
    ex af,af'
    cp $E0
    call nc,rw_in
    jr .cnt
.th:
    call rw_out
.cnt:
    ex af,af'
    exx
    jp rcs_seg.cnt

rcr_segw:
    add a,32
    jr c,.th
    ld d,ixl
    exx
    ld d,ixh
    exx
    cp $E0
    call nc,rw_in
    jr .cnt
.th:
    ld c,a
    ld a,ixl
    add a,8
    ld ixl,a
    ld d,a
    ld a,ixh
    add a,8
    ld ixh,a
    exx
    ld d,a
    exx
    ld a,c
    call rw_out
.cnt:
    exx
    dec iyl
    jp m,rc_done
    jp z,rcr_seg.fin
    ld bc,(R_N2X8)
    jp rcr_seg.go

; rw_in (main set; keeps A, BC, DE, HL and the alternate set except the stepped byte): for each set in R_WRAP, its head's INC
; becomes NOP and its display high byte (H save, D restore) goes up by one.
rw_in:
    push af
    push bc
    ld a,(R_WRAP)
    ld c,a
    rra
    jr nc,.alt
    xor a
    ld (GCODE),a
    call rw_step1
.alt:
    bit 1,c
    jr z,.done
    push hl
    ld hl,(R_H2)
    ld (hl),0
    pop hl
    exx
    call rw_step1
    exx
.done:
    pop bc
    pop af
    ret
rw_step1:                   ; H or D + 1 by R_MODE.  Clobbers A
    ld a,(R_MODE)
    or a
    jr nz,.r
    inc h
    ret
.r:
    inc d
    ret

; rw_out (main set): the heads get their INC back; for a save each wrapped set's H goes back down by one (a restore reloads D
; from IX).
rw_out:
    push af
    push bc
    ld a,(R_WRAP)
    ld c,a
    ld a,(R_MODE)
    or a
    ld b,$24                ; INC H
    jr z,.op
    ld b,$14                ; INC D
.op:
    bit 0,c
    jr z,.alt
    ld a,b
    ld (GCODE),a
    ld a,(R_MODE)
    or a
    jr nz,.alt
    dec h
.alt:
    bit 1,c
    jr z,.done
    push hl
    ld hl,(R_H2)
    ld (hl),b
    pop hl
    ld a,(R_MODE)
    or a
    jr nz,.done
    exx
    dec h
    exx
.done:
    pop bc
    pop af
    ret

; rc_wrapf: R_WRAP = bit 0 if the main set's row ends at offset 31 ((c0 >> 1) + odd + n1 - 1 = 31, n1 > 0), bit 1 if the
; alternate set's does ((c0 >> 1) + n2 - 1 = 31).  Clobbers AF, BC, HL.
rc_wrapf:
    ld hl,(R_C0)            ; L = c0, H = nc
    ld a,l
    add a,h
    cp 63
    jr nc,.may              ; c0 + nc >= 63: the rectangle reaches byte column 62 or 63
    xor a
    ld (R_WRAP),a
    ret
.may:
    ld a,h
    srl a
    ld b,a                  ; B = n1
    ld a,h
    sub b
    ld c,a                  ; C = n2
    ld a,l
    srl a
    ld h,a                  ; H = c0 >> 1
    ld l,0
    add a,c
    cp 32
    jr nz,.m
    set 1,l
.m:
    ld a,b
    or a
    jr z,.d
    ld a,(R_C0)
    and 1
    add a,h
    add a,b
    cp 32
    jr nz,.d
    set 0,l
.d:
    ld a,l
    ld (R_WRAP),a
    ret

; rc_done (alternate set): DE' is the end of the data for a save.  Returns it in HL; restores the saved registers.
rc_done:
    push de
    exx
    pop hl
    exx
    pop hl
    pop de
    pop bc
    exx
    ex af,af'
    pop af
    ex af,af'
    pop iy
    pop ix
    ret

; rc_mul: HL = B x DE (B = 0..8).  Clobbers AF, B.
rc_mul:
    ld hl,0
    inc b
    jr .e
.l:
    add hl,de
.e:
    djnz .l
    ret

; rc_wrldi: A = n (0..32) -> n LDI opcodes written at HL (inside GCODE's page), HL after them.  Keeps DE.  Clobbers AF, BC.
rc_wrldi:
    push af
    ld a,OPC_LDI2
    ld (R_OP2),a
    pop af
; rc_wrlx: the same with the second opcode R_OP2 (LDI $A0, LDD $A8).
rc_wrlx:
    add a,a
    add a,a
    ld c,a
    ld a,WRL_END&$FF
    sub c
    ld c,a
    ld a,WRL_END>>8
    sbc a,0
    ld b,a
    push bc
    ld a,(R_OP2)
    ld b,a
    ld c,OPC_LDI1
    ret                     ; into the chain at WRL_END - 4n; its RET returns to the caller
    REPT 32
        ld (hl),c
        inc l
        ld (hl),b
        inc l
    ENDR
WRL_END:
    ret

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

; ---------------------------------------------------------------------------------------------------------------------
; G_PRESHIFT: GA+4 w, GA+6 h, GA+8 source bitmap, GA+10 destination -> the shifted set (section 15.2) at the destination.
; Returns HL = the end.  Clobbers AF, BC, DE, HL.  Built once per bitmap: not bounded, written for clarity.
P_WB        EQU $E040               ; byte: wb
P_P         EQU $E041               ; byte: p
P_K         EQU $E042               ; byte: rows left in this copy
P_Q         EQU $E043               ; byte: pairs left in this row
P_SRC       EQU $E044               ; word: source row
P_PM        EQU $E046               ; byte: previous mask byte
P_PI        EQU $E047               ; byte: previous image byte

G_PRESHIFT:
    ld de,(GA+10)
    ex de,hl
    ld de,(GA_W)
    bit 7,d
    ret nz
    ld a,d
    or e
    ret z
    ld de,(GA_H)
    bit 7,d
    ret nz
    ld a,d
    or e
    ret z
    ex de,hl                ; DE = destination
    ld a,(GA_W)
    add a,7
    rra
    rra
    rra
    and $1F
    ld (P_WB),a
    xor a
.cp:
    ld (P_P),a
    ld hl,(GA+8)
    ld (P_SRC),hl
    ld a,(GA_H)
    ld (P_K),a
.row:
    ld a,$FF
    ld (P_PM),a
    xor a
    ld (P_PI),a
    ld a,(P_WB)
    inc a
    ld (P_Q),a              ; ws pairs
    ld bc,(P_SRC)
.pair:
    ld a,(P_Q)
    cp 1
    ld a,$FF                ; past the bitmap: M = $FF, I = 0
    ld l,0
    jr z,.fill
    ld a,(bc)
    inc bc
    ld l,a
    ld a,(bc)
    inc bc
    ld h,l
    ld l,a                  ; H = M, L = I
    ld a,h
.fill:                      ; A = M, L = I
    push hl
    ld h,a                  ; H = M
    ld a,(P_P)
    add a,a
    add a,SHR>>8
    push af                 ; the SHR page
    ld l,h                  ; index M
    ld h,a
    ld a,(hl)               ; SHR[M]
    push af
    ld a,(P_PM)
    ld l,a
    inc h
    pop af
    or (hl)                 ; | SHL[previous M]
    ld (de),a
    inc de
    dec h
    pop af                  ; (SHR page)
    pop hl                  ; L = I
    push hl
    ld h,a
    ld a,(hl)               ; SHR[I]
    push af
    ld a,(P_PI)
    ld l,a
    inc h
    pop af
    or (hl)                 ; | SHL[previous I]
    ld (de),a
    inc de
    pop hl                  ; L = I
    ld a,l
    ld (P_PI),a
    ; previous M: the mask byte just read (or $FF past the end)
    ld a,(P_Q)
    cp 1
    ld a,$FF
    jr z,.pm
    dec bc
    dec bc
    ld a,(bc)
    inc bc
    inc bc
.pm:
    ld (P_PM),a
    ld hl,P_Q
    dec (hl)
    jr nz,.pair
    ld hl,(P_SRC)
    ld a,(P_WB)
    add a,a
    ld c,a
    ld b,0
    add hl,bc
    ld (P_SRC),hl
    ld hl,P_K
    dec (hl)
    jp nz,.row
    ld a,(P_P)
    inc a
    cp 8
    jp c,.cp
    ex de,hl
    ret

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
; mul16: DE:HL = HL x DE (unsigned).  Clobbers AF, BC.
mul16:
    ld b,h
    ld c,l
    ld hl,0
    ld a,16
.l:
    add hl,hl
    rl e
    rl d
    jr nc,.n
    add hl,bc
    jr nc,.n
    inc de
.n:
    dec a
    jr nz,.l
    ret
; div3216: DE:HL / BC (DE < BC, BC <= 32767) -> HL = quotient, DE = remainder.  Clobbers AF.
div3216:
    ld a,16
.l:
    add hl,hl
    rl e
    rl d
    ex de,hl
    or a
    sbc hl,bc
    jr nc,.one
    add hl,bc
    ex de,hl
    jr .n
.one:
    ex de,hl
    inc l
.n:
    dec a
    jr nz,.l
    ret
