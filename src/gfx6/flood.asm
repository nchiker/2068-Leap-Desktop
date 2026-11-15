; flood.asm -- G_FLOOD, DOCK 6 (mapping R; docs/PAINT.md 21): the bucket's flood fill.  Display only (it reads the display and writes it).  Assembled by desk5.asm in chunk 6
; after rrect.asm (it calls the pool's G_ADDR and G_FILL and G_PATFILL).
;
; G_FLOOD: GA = x, y (the seed; screen pixels), GA+8 = a pointer to 8 pattern bytes (as G_PATFILL).  The seed outside GCLIP: nothing happens (carry clear).  The target colour is the seed's
; pixel; the region is the 4-connected set of target pixels inside the clip.  Pass 1 fills it with a SOLID MARKER (the opposite colour: GOP is set to SET when the target is paper, CLR when it
; is ink: GOP is clobbered) and records each span in cold RAM $7800.. (5 bytes: y, x0 word, x1 word; at most 204); pass 2 paints every recorded span with the pattern (REPLACE).  Returns
; CARRY CLEAR when complete (the box of the region in FL_BX0, FL_BX1 words and FL_BY0, FL_BY1 bytes), CARRY SET when it overflowed (more than 204 spans, or more than 256 seeds on the stack
; $7C00-$7FFF: 512 seeds, $7800-$7FFF, in the one-pass fill): the picture is then partly changed and the caller restores it.  Clobbers AF, BC, DE, HL, GA, GOP.  State in hot RAM $E0D0-$E0E7. When the pattern holds no pixel of the target colour (a solid ink pattern over paper, or white over ink) the fill is one pass: nothing is recorded (FL_FAST).

FL_Y        EQU $E0D0               ; byte: the row the run routines scan
FL_TG       EQU $E0D1               ; byte: the target colour as a uniform byte ($00 paper, $FF ink)
FL_LIM      EQU $E0D2               ; word: the scan limit
FL_XL       EQU $E0D4               ; word: the span being filled
FL_XR       EQU $E0D6
FL_SP       EQU $E0D8               ; word: the span list's end
FL_SK       EQU $E0DA               ; word: the seed stack's top (grows down from $8000)
FL_YS       EQU $E0DC               ; byte: the span's row
FL_BX0      EQU $E0DE               ; word: the region's box
FL_BX1      EQU $E0E0
FL_BY0      EQU $E0E2               ; byte
FL_BY1      EQU $E0E3
FL_FAST      EQU $E0E4               ; byte: 1 when the pattern has no pixel of the target colour: one pass, no span list
FL_SLIM      EQU $E0E5               ; word: the seed stack's lowest address ($7C00; $7800 in one pass, the span list being unused)
FL_LIST     EQU $7800               ; the span list: $7800 .. $7BFF
FL_LEND     EQU $7C00
FL_STK      EQU $8000               ; the seed stack: $7C00 .. $7FFF (4 bytes a seed: x word, y, 0)

G_FLOOD:
    ld hl,(GA)                      ; the seed inside the clip?
    ld de,(GCX0)
    or a
    sbc hl,de
    jp c,.none
    ld hl,(GA)
    ld de,(GCX1)
    or a
    sbc hl,de
    jp nc,.none
    ld hl,(GA+2)
    ld de,(GCY0)
    or a
    sbc hl,de
    jp c,.none
    ld hl,(GA+2)
    ld de,(GCY1)
    or a
    sbc hl,de
    jp nc,.none
    ld hl,(GA)                      ; the target colour: the seed's pixel as $00 / $FF
    ld a,(GA+2)
    ld e,a
    call G_ADDR
    and (hl)
    neg
    sbc a,a
    ld (FL_TG),a
    and 1                           ; the marker: SET (0) over paper, CLR (1) over ink
    ld (GOP),a
    ld hl,(GA+8)                    ; a pattern that is all the marker colour (every byte the complement of the target): the marker IS the fill
    ld a,(FL_TG)
    cpl
    ld b,8
.pf:
    cp (hl)
    jr nz,.slow
    inc hl
    djnz .pf
    ld a,1
    jr .fs
.slow:
    xor a
.fs:
    ld (FL_FAST),a
    ld hl,FL_STK - 1024             ; the seed stack: 256 seeds ($7C00 up), or 512 ($7800 up) when no span list is kept
    or a
    jr z,.sl
    ld hl,FL_STK - 2048
.sl:
    ld (FL_SLIM),hl
    ld hl,FL_LIST
    ld (FL_SP),hl
    ld hl,FL_STK
    ld (FL_SK),hl
    ld hl,$7FFF
    ld (FL_BX0),hl
    ld hl,0
    ld (FL_BX1),hl
    ld a,$FF
    ld (FL_BY0),a
    xor a
    ld (FL_BY1),a
    ld hl,(GA)
    ld a,(GA+2)
    call fl_push
.loop:
    call fl_pop                     ; the next seed: HL = x, A = y
    jp c,.pass2
    ld (FL_Y),a
    ld (FL_YS),a
    push hl
    ld e,a
    call fl_tst
    pop hl
    jr nz,.loop                     ; no longer the target: filled already, or a boundary
    ld de,(GCX0)                    ; the run's left end
    ld (FL_LIM),de
    push hl
    call fl_lt
    ld (FL_XL),hl
    pop hl
    ld de,(GCX1)                    ; its right end
    ld (FL_LIM),de
    call fl_rt
    ld (FL_XR),hl
    ld hl,(FL_XL)                   ; the span in the marker
    ld (GA),hl
    ld a,(FL_YS)
    ld l,a
    ld h,0
    ld (GA+2),hl
    ld hl,(FL_XR)
    ld de,(FL_XL)
    or a
    sbc hl,de
    inc hl
    ld (GA+4),hl
    ld hl,1
    ld (GA+6),hl
    call G_FILL
    ld a,(FL_FAST)
    or a
    jr nz,.bx                       ; one pass: nothing to record
    ld hl,(FL_SP)                   ; recorded: room for 5 bytes?
    ld de,FL_LEND - 5 + 1
    or a
    sbc hl,de
    jr nc,.over
    add hl,de
    ld a,(FL_YS)
    ld (hl),a
    inc hl
    ld de,(FL_XL)
    ld (hl),e
    inc hl
    ld (hl),d
    inc hl
    ld de,(FL_XR)
    ld (hl),e
    inc hl
    ld (hl),d
    inc hl
    ld (FL_SP),hl
.bx:
    ld hl,(FL_XL)                   ; the box grows
    ld de,(FL_BX0)
    or a
    sbc hl,de
    jr nc,.b1
    ld hl,(FL_XL)
    ld (FL_BX0),hl
.b1:
    ld hl,(FL_BX1)
    ld de,(FL_XR)
    or a
    sbc hl,de
    jr nc,.b2
    ld (FL_BX1),de
.b2:
    ld a,(FL_YS)
    ld hl,FL_BY0
    cp (hl)
    jr nc,.b3
    ld (hl),a
.b3:
    ld hl,FL_BY1
    cp (hl)
    jr c,.b4
    ld (hl),a
.b4:
    ld a,(FL_YS)                    ; the row above, when it is inside the clip
    ld hl,GCY0
    cp (hl)
    jr z,.nu
    jr c,.nu
    dec a
    call fl_nb
    jr c,.over
.nu:
    ld a,(FL_YS)                    ; the row below
    inc a
    ld hl,GCY1
    cp (hl)
    jp nc,.loop
    call fl_nb
    jp nc,.loop
.over:
    scf
    ret
.none:
    or a
    ret
.pass2:                             ; every recorded span in the pattern (REPLACE)
    ld hl,FL_LIST
.p2:
    ld de,(FL_SP)
    push hl
    or a
    sbc hl,de
    pop hl
    jr nc,.done
    ld a,(hl)
    inc hl
    ld e,(hl)
    inc hl
    ld d,(hl)
    inc hl
    ld (GA),de
    push hl
    ld l,a
    ld h,0
    ld (GA+2),hl
    pop hl
    ld e,(hl)
    inc hl
    ld d,(hl)
    inc hl
    push hl
    ld hl,(GA)
    ex de,hl
    or a
    sbc hl,de
    inc hl
    ld (GA+4),hl
    ld hl,1
    ld (GA+6),hl
    ld a,3
    ld (GOP),a
    call G_PATFILL
    pop hl
    jr .p2
.done:
    or a
    ret

; fl_tst: HL = x, E = y -> Z when the pixel is the target colour.  Clobbers AF, DE, HL.
fl_tst:
    call G_ADDR
    and (hl)
    neg
    sbc a,a
    ld hl,FL_TG
    cp (hl)
    ret

; fl_push: HL = x, A = y: a seed on the stack; carry set when it is full.  fl_pop: HL = x, A = y; carry set when it is empty.  Clobber BC, DE.
fl_push:
    ex de,hl
    ld hl,(FL_SK)
    ld bc,-4
    add hl,bc
    ld bc,(FL_SLIM)
    or a
    sbc hl,bc
    jr c,.full
    add hl,bc
    ld (FL_SK),hl
    ld (hl),e
    inc hl
    ld (hl),d
    inc hl
    ld (hl),a
    or a
    ret
.full:
    scf
    ret
fl_pop:
    ld hl,(FL_SK)
    ld de,FL_STK
    or a
    sbc hl,de
    jr nz,.p
    scf
    ret
.p:
    add hl,de
    ld e,(hl)
    inc hl
    ld d,(hl)
    inc hl
    ld a,(hl)
    inc hl
    inc hl
    ld (FL_SK),hl
    ex de,hl
    or a
    ret

; fl_rt: HL = x (a target pixel on row FL_Y), FL_LIM = the limit (exclusive): HL = the last target x of the run to the right.  fl_lt: FL_LIM = the lowest x allowed: HL = the first x of the run to
; the left.  A whole byte of the target colour is passed 8 pixels at a time.  Clobber AF, DE.
fl_rt:
.n:
    inc hl                          ; the candidate
    ld de,(FL_LIM)
    push hl
    or a
    sbc hl,de
    pop hl
    jr nc,.e
    ld a,l
    and 7
    jr nz,.p
    push hl                         ; a byte start: the whole byte below the limit and of the target colour?
    ld de,7
    add hl,de
    ld de,(FL_LIM)
    or a
    sbc hl,de
    pop hl
    jr nc,.p
    push hl
    ld a,(FL_Y)
    ld e,a
    call G_ADDR
    ld a,(FL_TG)
    cp (hl)
    pop hl
    jr nz,.p
    ld de,7
    add hl,de                       ; its last pixel
    jr .n
.p:
    push hl
    ld a,(FL_Y)
    ld e,a
    call fl_tst
    pop hl
    jr z,.n
.e:
    dec hl
    ret
fl_lt:
.n:
    ld de,(FL_LIM)
    push hl
    or a
    sbc hl,de
    pop hl
    ret z                           ; at the limit
    dec hl                          ; the candidate
    ld a,l
    and 7
    cp 7
    jr nz,.p
    push hl                         ; a byte end: the whole byte at or above the limit and of the target colour?
    ld de,-7
    add hl,de
    ld de,(FL_LIM)
    or a
    sbc hl,de
    pop hl
    jr c,.p
    push hl
    ld a,(FL_Y)
    ld e,a
    call G_ADDR
    ld a,(FL_TG)
    cp (hl)
    pop hl
    jr nz,.p
    ld de,-7
    add hl,de                       ; its first pixel
    jr .n
.p:
    push hl
    ld a,(FL_Y)
    ld e,a
    call fl_tst
    pop hl
    jr z,.n
    inc hl
    ret

; fl_sk: HL = x, FL_Y the row, FL_LIM the limit (exclusive): HL = the first target x, or the limit when there is none.  A whole byte of the other colour is passed 8 pixels at a time.
fl_sk:
.n:
    ld de,(FL_LIM)
    push hl
    or a
    sbc hl,de
    pop hl
    ret nc
    ld a,l
    and 7
    jr nz,.p
    push hl
    ld de,7
    add hl,de
    ld de,(FL_LIM)
    or a
    sbc hl,de
    pop hl
    jr nc,.p
    push hl
    ld a,(FL_Y)
    ld e,a
    call G_ADDR
    ld a,(FL_TG)
    cpl
    cp (hl)
    pop hl
    jr nz,.p
    ld de,8
    add hl,de
    jr .n
.p:
    push hl
    ld a,(FL_Y)
    ld e,a
    call fl_tst
    pop hl
    ret z
    inc hl
    jr .n

; fl_nb: A = a row next to the span (FL_XL .. FL_XR): a seed for the first pixel of each run of target pixels in it.  Carry set when the stack is full.
fl_nb:
    ld (FL_Y),a
    ld hl,(FL_XL)
.s:
    ld de,(FL_XR)
    inc de
    ld (FL_LIM),de
    call fl_sk
    ld de,(FL_XR)
    inc de
    push hl
    or a
    sbc hl,de
    pop hl
    ret nc                          ; none left (carry clear)
    push hl
    ld a,(FL_Y)
    call fl_push
    pop hl
    ret c
    ld de,(GCX1)                    ; the run's end: on from the pixel after it
    ld (FL_LIM),de
    call fl_rt
    inc hl
    jr .s
