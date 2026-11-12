; pointer.asm -- slice S4 of docs/GRAPHICS_SPIKE.md: the pointer, drawn by the frame interrupt, and the shield (interface:
; section 16, binding).  Included by gfx6.asm (inside GFX6_CODE .. GFX6_CODE_END).
;
; How it works:
; - P_MOVE / P_SHIELD / P_UNSHIELD only change the state and set PT_DIRTY; P_ISR (from the frame ISR) brings the drawn pointer up
;   to date.  The one exception: P_SHIELD erases a drawn pointer that meets the shield at once, because its caller draws there next.
; - Every main-program routine holds PT_LOCK while it changes the state; P_ISR does nothing while the lock is held (PT_DIRTY stays
;   set, so the next frame catches up).  The main program never runs inside the ISR, so this is all the exclusion needed: no DI.
; - The pointer covers 3 byte columns (16 pixels at any x AND 7) x 16 rows, cut at the right and bottom screen edges.  Kinds by the
;   first byte column c0: 0 = even c0 <= 60, 1 = odd c0 <= 61 (3 columns, unrolled 8-row blocks), 2 = c0 62 (2 columns), 3 = c0 63
;   (1 column) (loops).
; - Drawing (interrupts off, in the ISR) reads the pre-shifted copy with POP: SP points at the copy's rows (mask, image pairs).  It
;   saves each screen byte to PT_SAVE (always 3 bytes a row) before changing it.  Erasing writes PT_SAVE back, without SP tricks,
;   so P_SHIELD can erase with interrupts on.

; ---------------------------------------------------------------------------------------------------------------------
; The pointer area ($E100-$E6FF, section 16.1).  All 0 at boot.
PT_LOCK     EQU $E100               ; byte: non-zero while a main-program routine changes the state (P_ISR skips)
PT_ON       EQU $E101               ; byte: non-zero after P_INIT
PT_DIRTY    EQU $E102               ; byte: non-zero when something changed since the last P_ISR
PT_SHON     EQU $E103               ; byte: non-zero when a (non-empty) shield is set
PT_X        EQU $E104               ; word: position x (0..511)
PT_Y        EQU $E106               ; byte: position y (0..191)
PT_SC0      EQU $E108               ; byte: shield's first byte column
PT_SC1      EQU $E109               ; byte: shield's last byte column
PT_SY0      EQU $E10A               ; byte: shield's first row
PT_SY1      EQU $E10B               ; byte: shield's last row
PT_DRAWN    EQU $E10C               ; byte: non-zero when the pointer is drawn (at PT_DX, PT_DY)
PT_DX       EQU $E10E               ; word: drawn x
PT_DY       EQU $E110               ; byte: drawn y
PT_PASS     EQU $E111               ; byte: passes left (unrolled kinds) or rows (loop kinds)
PT_SP       EQU $E112               ; word: SP while drawing
PT_DATA     EQU $E114               ; word: the shifted copy being drawn
PT_SAVE     EQU $E120               ; 48 bytes: the screen bytes under the pointer, 3 a row ($E120-$E14F: INC C never wraps)
PT_SET      EQU $E200               ; 768 bytes: the shifted set of P_ARROW (G_PRESHIFT, 15.2): copy p at PT_SET + 96 p
PT_AREA_END EQU $E6FF

P_CODE:

; ---------------------------------------------------------------------------------------------------------------------
; P_INIT: HL = x, DE = y.  Builds the shifted set, position (x, y) clamped, no shield, pointer on (drawn by the next P_ISR).
; GA undefined afterwards.  Clobbers AF, BC, DE, HL.  Stack: 4 + G_PRESHIFT's.
P_INIT:
    push hl
    push de
    ld a,1
    ld (PT_LOCK),a
    xor a
    ld (PT_ON),a
    ld (PT_DRAWN),a
    ld (PT_SHON),a
    ld hl,16
    ld (GA_W),hl
    ld (GA_H),hl
    ld hl,P_ARROW
    ld (GA+8),hl
    ld hl,PT_SET
    ld (GA+10),hl
    call G_PRESHIFT
    ld a,1
    ld (PT_ON),a                    ; still locked: P_MOVE sets PT_DIRTY and then releases the lock
    pop de
    pop hl
    ; fall into P_MOVE

; ---------------------------------------------------------------------------------------------------------------------
; P_MOVE: HL = x, DE = y (signed words) -> position (clamp(x, 0, 511), clamp(y, 0, 191)).  Clobbers AF, DE, HL.
P_MOVE:
    bit 7,h
    jr z,.xpos
    ld hl,0
    jr .xok
.xpos:
    ld a,h
    cp 2
    jr c,.xok
    ld hl,511
.xok:
    bit 7,d
    jr z,.ypos
    ld e,0
    jr .yok
.ypos:
    ld a,d
    or a
    jr nz,.ybig
    ld a,e
    cp 192
    jr c,.yok
.ybig:
    ld e,191
.yok:
    ld a,1
    ld (PT_LOCK),a
    ld (PT_X),hl
    ld (PT_DIRTY),a
    ld a,e
    ld (PT_Y),a
    xor a
    ld (PT_LOCK),a
    ret

; ---------------------------------------------------------------------------------------------------------------------
; P_ISRMOVE (docs/OBJECTS_EVENTS.md 14.5): HL = x (0..511), E = y (0..191), already clamped.  Only from the ISR, after P_ISR.
; Carry set and nothing changed while a main-program routine holds PT_LOCK (the caller tries again next frame); else the position
; is set and PT_DIRTY, carry clear.  Clobbers AF.
P_ISRMOVE:
    ld a,(PT_LOCK)
    or a
    scf
    ret nz
    ld (PT_X),hl
    ld a,e
    ld (PT_Y),a
    ld a,1
    ld (PT_DIRTY),a
    or a
    ret

; ---------------------------------------------------------------------------------------------------------------------
; P_UNSHIELD: removes the shield; the next P_ISR redraws a hidden pointer.  Clobbers AF.
P_UNSHIELD:
    ld a,1
    ld (PT_LOCK),a
    ld (PT_DIRTY),a
    xor a
    ld (PT_SHON),a
    ld (PT_LOCK),a
    ret

; ---------------------------------------------------------------------------------------------------------------------
; P_SHIELD: GA x, y, w, h -> the shield; a drawn pointer that meets it is erased now.  GA unchanged.  Clobbers AF, BC, DE, HL.
P_SHIELD:
    ld a,1
    ld (PT_LOCK),a
    ld (PT_DIRTY),a
    ld hl,(GA_X)
    ld de,(GA_W)
    ld bc,512
    call pt_range
    jr c,.none
    call pt_c0
    ld (PT_SC0),a
    ex de,hl
    call pt_c0
    ld (PT_SC1),a
    ld hl,(GA_Y)
    ld de,(GA_H)
    ld bc,192
    call pt_range
    jr c,.none
    ld a,l
    ld (PT_SY0),a
    ld a,e
    ld (PT_SY1),a
    ld a,1
    ld (PT_SHON),a
    ld a,(PT_DRAWN)
    or a
    jr z,.done
    ld hl,(PT_DX)
    call pt_c0
    ld b,a
    ld a,(PT_DY)
    ld c,a
    call pt_meets
    call nc,pt_erase
    jr .done
.none:
    xor a
    ld (PT_SHON),a                  ; an empty shield meets nothing: the same as no shield
.done:
    xor a
    ld (PT_LOCK),a
    ret

; pt_range: HL = start, DE = length (signed words, -16384..16383), BC = limit (512 or 192).  Clamps [start, start + length) to
; [0, limit).  CY when empty; else NC, HL = first, DE = last (inclusive).  Clobbers AF.
pt_range:
    push hl
    add hl,de                       ; end (fits: both in -16384..16383)
    ex de,hl                        ; DE = end
    pop hl                          ; HL = start
    bit 7,h
    jr z,1F
    ld hl,0                         ; first = max(start, 0)
1:  bit 7,d
    scf
    ret nz                          ; end < 0: empty
    ld a,e
    sub c
    ld a,d
    sbc a,b
    jr c,2F                         ; end < limit
    ld d,b
    ld e,c                          ; end = limit
2:  ex de,hl                        ; HL = end, DE = first
    or a
    sbc hl,de                       ; end - first
    jr z,3F
    jr c,3F                         ; end <= first: empty
    add hl,de
    dec hl                          ; last = end - 1
    ex de,hl                        ; HL = first, DE = last
    or a
    ret
3:  scf
    ret

; pt_c0: HL = x (0..511) -> A = x >> 3.  Clobbers F.
pt_c0:
    ld a,l
    and $F8
    or h                            ; bit 0 = x8, bits 3-7 = x3..x7
    rrca
    rrca
    rrca
    ret

; pt_meets: B = c0, C = y of a pointer -> NC when its byte rectangle meets the shield's (PT_SC0.., set), CY when not.
; Clobbers AF, HL.  (min(c0 + 2, 63) >= SC0 is c0 + 2 >= SC0 because SC0 <= 63; the same for the rows with 191.)
pt_meets:
    ld a,(PT_SC1)
    cp b
    ret c                           ; SC1 < c0
    ld a,b
    add a,2
    ld hl,PT_SC0
    cp (hl)
    ret c                           ; c0 + 2 < SC0
    ld a,(PT_SY1)
    cp c
    ret c                           ; SY1 < y
    ld a,c
    add a,15
    ld hl,PT_SY0
    cp (hl)
    ret                             ; CY: y + 15 < SY0

; ---------------------------------------------------------------------------------------------------------------------
; P_ISR: called by the frame ISR (interrupts off, display mapped).  Brings the drawn pointer up to date (16.4).
; Clobbers AF, BC, DE, HL.  Stack: at most 10 bytes below its return address (the move path; the contract allows 16).
P_ISR:
    ld a,(PT_LOCK)
    or a
    ret nz                          ; a main-program routine is changing the state: next frame
    ld hl,PT_DIRTY
    or (hl)
    ret z                           ; nothing changed (the skip)
    ld (hl),0
    ld a,(PT_ON)
    or a
    jr z,.hide
    ld a,(PT_SHON)
    or a
    jr z,.show
    ld hl,(PT_X)
    call pt_c0
    ld b,a
    ld a,(PT_Y)
    ld c,a
    call pt_meets
    jr nc,.hide                     ; the position meets the shield: hidden
.show:
    ld a,(PT_DRAWN)
    or a
    jr z,pt_draw
    ld hl,(PT_X)
    ld de,(PT_DX)
    or a
    sbc hl,de
    jr nz,.move
    ld a,(PT_Y)
    ld hl,PT_DY
    cp (hl)
    ret z                           ; drawn where it is
.move:
    call pt_erase
    jr pt_draw
.hide:
    ld a,(PT_DRAWN)
    or a
    ret z
    ; fall into pt_erase

; ---------------------------------------------------------------------------------------------------------------------
; pt_erase: writes PT_SAVE back over the drawn pointer (PT_DX, PT_DY); PT_DRAWN = 0.  Interrupts on or off (no SP tricks).
; Clobbers AF, BC, DE, HL.
pt_erase:
    xor a
    ld (PT_DRAWN),a
    push ix
    ld hl,(PT_DX)
    ld a,(PT_DY)
    ld c,a
    call pt_geom
    push hl
    ld de,PT_ETABS
    call pt_entry
    pop hl
    ld bc,PT_SAVE
    jp (ix)
pt_eend:
    pop ix
    ret

; pt_draw: saves the screen under the pointer at the position (PT_X, PT_Y) and draws it there; PT_DX / PT_DY / PT_DRAWN.
; Interrupts off: it reads the shifted copy with POP.  Clobbers AF, BC, DE, HL.
pt_draw:
    ld a,1
    ld (PT_DRAWN),a
    push ix
    ld hl,(PT_X)
    ld (PT_DX),hl
    ld a,l
    and 7
    ld e,a
    add a,a
    add a,e                         ; 3 p
    push hl
    ld l,a
    ld h,0
    add hl,hl
    add hl,hl
    add hl,hl
    add hl,hl
    add hl,hl                       ; 96 p: copy p's offset (2 h ws = 96)
    ld de,PT_SET
    add hl,de
    ld (PT_DATA),hl
    pop hl
    ld a,(PT_Y)
    ld (PT_DY),a
    ld c,a
    call pt_geom
    push hl
    ld de,PT_DTABS
    call pt_entry
    pop hl
    ld bc,PT_SAVE
    ld (PT_SP),sp
    ld sp,(PT_DATA)
    jp (ix)
pt_dend:
    ld sp,(PT_SP)
    pop ix
    ret

; pt_geom: HL = x (0..511), C = y (0..191) -> HL = the screen byte of (x >> 3, y), A = kind (0..3), B = rows (1..16).
; Clobbers F, E.
pt_geom:
    call pt_c0
    ld e,a                          ; c0
    ld l,c
    ld h,ROWTAB>>9
    add hl,hl
    ld a,(hl)
    inc l
    ld h,(hl)
    ld l,a                          ; ROWTAB[y]
    ld a,e
    srl a                           ; c0 >> 1, CY = c0 AND 1
    jr nc,1F
    set 5,h                         ; odd byte columns are in the second file
1:  or l
    ld l,a
    ld a,192
    sub c
    cp 16
    jr c,2F
    ld a,16
2:  ld b,a
    ld a,e
    cp 62
    jr nc,3F
    and 1
    ret
3:  sub 60
    ret

; pt_entry: A = kind, B = rows, DE = a 4-word table (the E3 entries, the O3 entries, the E2 loop, the O1 loop) -> IX = where to
; jump, PT_PASS = passes (kinds 0, 1: rows - 8 then 8, or rows) or rows (kinds 2, 3).  Clobbers AF, BC, DE, HL.
pt_entry:
    ld c,a
    add a,a
    ld l,a
    ld h,0
    add hl,de
    ld e,(hl)
    inc hl
    ld d,(hl)
    ld a,c
    cp 2
    ld a,b
    jr c,1F
    ld (PT_PASS),a
    push de
    pop ix
    ret
1:  ld c,1
    cp 9
    jr c,2F
    sub 8
    inc c
2:  dec a
    add a,a
    ld l,a
    ld h,0
    add hl,de
    ld a,(hl)
    inc hl
    ld h,(hl)
    ld l,a
    push hl
    pop ix
    ld a,c
    ld (PT_PASS),a
    ret

; ---------------------------------------------------------------------------------------------------------------------
; Row code.  HL = the row's first screen byte, BC = PT_SAVE position.  Drawing: SP = the copy's next pair (POP DE: E = mask,
; D = image).  The next row: INC H, and at a character-row crossing L + 32 (and H - 8 unless L carried into the next third).

    MACRO PT_NEXTROW
    inc h
    ld a,h
    and 7
    jr nz,$+12
    ld a,l
    add a,32
    ld l,a
    jr c,$+6
    ld a,h
    sub 8
    ld h,a
    ENDM

    MACRO PT_DBYTE                  ; draw one byte: save it, then (old AND mask) OR image
    pop de
    ld a,(hl)
    ld (bc),a
    inc c
    and e
    or d
    ld (hl),a
    ENDM

    MACRO PT_EBYTE                  ; erase one byte
    ld a,(bc)
    ld (hl),a
    inc c
    ENDM

    MACRO PT_PASSEND start, done
    ld a,(PT_PASS)
    dec a
    ld (PT_PASS),a
    jp nz,start
    jp done
    ENDM

; Kind 0: even c0 (first file, offset o): (f1, o), (f2, o), (f1, o + 1).
pt_de3:
    DUP 8
    PT_DBYTE
    set 5,h
    PT_DBYTE
    res 5,h
    inc l
    PT_DBYTE
    dec l
    PT_NEXTROW
    EDUP
pt_de3_end:
    PT_PASSEND pt_de3, pt_dend

; Kind 1: odd c0 (second file, offset o): (f2, o), (f1, o + 1), (f2, o + 1).
pt_do3:
    DUP 8
    PT_DBYTE
    res 5,h
    inc l
    PT_DBYTE
    set 5,h
    PT_DBYTE
    dec l
    PT_NEXTROW
    EDUP
pt_do3_end:
    PT_PASSEND pt_do3, pt_dend

pt_ee3:
    DUP 8
    PT_EBYTE
    set 5,h
    PT_EBYTE
    res 5,h
    inc l
    PT_EBYTE
    dec l
    PT_NEXTROW
    EDUP
pt_ee3_end:
    PT_PASSEND pt_ee3, pt_eend

pt_eo3:
    DUP 8
    PT_EBYTE
    res 5,h
    inc l
    PT_EBYTE
    set 5,h
    PT_EBYTE
    dec l
    PT_NEXTROW
    EDUP
pt_eo3_end:
    PT_PASSEND pt_eo3, pt_eend

R_D3        EQU (pt_de3_end - pt_de3) / 8
R_E3        EQU (pt_ee3_end - pt_ee3) / 8
    ASSERT pt_do3_end - pt_do3 == 8 * R_D3 && pt_eo3_end - pt_eo3 == 8 * R_E3

; Kind 2: c0 = 62: (f1, 31), (f2, 31); the copy's third pair is skipped.  Kind 3: c0 = 63: (f2, 31).  Rows in IXl.
pt_de2:
    ld a,(PT_PASS)
    ld ixl,a
1:  PT_DBYTE
    set 5,h
    PT_DBYTE
    res 5,h
    pop de
    inc c
    PT_NEXTROW
    dec ixl
    jp nz,1B
    jp pt_dend

pt_do1:
    ld a,(PT_PASS)
    ld ixl,a
1:  PT_DBYTE
    pop de
    pop de
    inc c
    inc c
    PT_NEXTROW
    dec ixl
    jp nz,1B
    jp pt_dend

pt_ee2:
    ld a,(PT_PASS)
    ld ixl,a
1:  PT_EBYTE
    set 5,h
    PT_EBYTE
    res 5,h
    inc c
    PT_NEXTROW
    dec ixl
    jp nz,1B
    jp pt_eend

pt_eo1:
    ld a,(PT_PASS)
    ld ixl,a
1:  PT_EBYTE
    inc c
    inc c
    PT_NEXTROW
    dec ixl
    jp nz,1B
    jp pt_eend

; Entry tables: entry k (k = 0..7) runs the block's last k + 1 rows.
PT_DTABS:   DW pt_dtab_e3, pt_dtab_o3, pt_de2, pt_do1
PT_ETABS:   DW pt_etab_e3, pt_etab_o3, pt_ee2, pt_eo1
PTK = 1
pt_dtab_e3:
    DUP 8
    DW pt_de3_end - PTK * R_D3
PTK = PTK + 1
    EDUP
PTK = 1
pt_dtab_o3:
    DUP 8
    DW pt_do3_end - PTK * R_D3
PTK = PTK + 1
    EDUP
PTK = 1
pt_etab_e3:
    DUP 8
    DW pt_ee3_end - PTK * R_E3
PTK = PTK + 1
    EDUP
PTK = 1
pt_etab_o3:
    DUP 8
    DW pt_eo3_end - PTK * R_E3
PTK = PTK + 1
    EDUP

; ---------------------------------------------------------------------------------------------------------------------
; P_ARROW: the pointer, 16 x 16 in G_BLIT's pair format (15.2): per row (mask, image) x 2.  '#' ink, 'o' paper, '.' transparent.
; Drawn for mode 6's tall pixels, with the hot spot (0, 0) in ink (docs/OBJECTS_EVENTS.md 14.6): column 0 is ink for rows 0-10 and
; row 0 for columns 0-1, so the pointer shows at the right and bottom edges.  The paper outline is on the right and lower sides.
P_ARROW:
    DB $1F,$C0,$FF,$00     ; ##o.............
    DB $0F,$E0,$FF,$00     ; ###o............
    DB $07,$F0,$FF,$00     ; ####o...........
    DB $01,$F8,$FF,$00     ; #####oo.........
    DB $00,$FE,$FF,$00     ; #######o........
    DB $00,$FF,$3F,$00     ; ########oo......
    DB $00,$FF,$1F,$C0     ; ##########o.....
    DB $00,$FF,$0F,$E0     ; ###########o....
    DB $00,$F8,$0F,$00     ; #####ooooooo....
    DB $01,$DC,$FF,$00     ; ##o###o.........
    DB $01,$9C,$FF,$00     ; #oo###o.........
    DB $40,$0E,$FF,$00     ; o.oo###o........
    DB $E0,$0E,$FF,$00     ; ...o###o........
    DB $F0,$07,$7F,$00     ; ....o###o.......
    DB $F0,$00,$7F,$00     ; ....ooooo.......
    DB $FF,$00,$FF,$00     ; ................

P_CODE_END:
