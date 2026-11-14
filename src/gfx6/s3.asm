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

    IFNDEF G_LIB6
    INCLUDE "gfx6/s3sv.asm"
    ENDIF
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

    IFNDEF G_LIB6
    INCLUDE "gfx6/s3bl.asm"
    ENDIF
    IFNDEF G_LIB6
    INCLUDE "gfx6/s3ln.asm"
    ENDIF
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
