; menu.asm -- the window manager, slice W3 (docs/WINDOWS.md 8 and 18): the menu bar, drop-downs with save-under, tracking by
; pointer and by keyboard, E_MENU.  Included by kernel.asm after wm2.asm.
;
; Menu table (section 8): count (1..8), then a word per menu -> record: id, title (length byte + codes), item count (1..15),
; then per item: id, flags (bit 0 disabled at start, bit 1 separator), text (length byte + codes).
; Internally IY points at the open menu's entry (13 bytes, below); the entry points save IY.

E_MENU_T    EQU 7
MB_TABLE    EQU $F480           ; word: the table (0: no menus)
MB_N        EQU $F482           ; byte: menus
MB_OPEN     EQU $F483           ; byte: the open menu ($FF: none)
MB_HL       EQU $F484           ; byte: the highlighted item ($FF: none)
MB_MODE     EQU $F485           ; byte: 0 tracking by pointer, 1 by keyboard
MB_ENT      EQU $F486           ; 8 entries of 13 bytes ($F486-$F4ED)
ME_REC      EQU 0               ; word: the menu's record
ME_BX       EQU 2               ; word: its title box x
ME_BW       EQU 4               ; word: the box's width
ME_DX       EQU 6               ; word: the drop-down's x
ME_DW       EQU 8               ; word: its width W
ME_DH       EQU 10              ; byte: its height H
ME_EN       EQU 11              ; word: enable bits (bit k: item k)
ME_SIZE     EQU 13
MB_TMP      EQU W_SAVE_BASE     ; MB_SET builds the entries here first (W_SAVE is free while no menu is open)
W_SAVE_BASE EQU $E800
    ASSERT MB_ENT + 8 * ME_SIZE <= $F4F0

; ---------------------------------------------------------------------------------------------------------------------------
; MB_SET (18.2): HL = a menu table or 0.  Carry (nothing changed) when the table breaks 18.2's limits.  Clobbers AF, BC, DE,
; HL; GA.  Preserves IX, IY.
MB_SET:
    push iy
    ld a,h
    or l
    jr nz,.table
    ld (MB_TABLE),hl
    xor a
    ld (MB_N),a
    jp .damage
.table:
    ld a,(hl)
    or a
    jp z,.fail
    cp 9
    jp nc,.fail
    ld (MB_TMP + 8 * ME_SIZE),a         ; the count, kept with the entries
    ld (MB_TMP + 8 * ME_SIZE + 1),hl    ; the table
    ld b,a
    inc hl
    ld iy,MB_TMP
    ld de,8
    ld (MB_TMP + 8 * ME_SIZE + 3),de    ; the next box's x
.menu:
    push bc
    ld e,(hl)
    inc hl
    ld d,(hl)
    inc hl
    push hl                             ; -> the next record's word
    ld (iy+ME_REC),e
    ld (iy+ME_REC+1),d
    ex de,hl
    inc hl                              ; the title
    call mb_textw                       ; HL -> after the string, DE = its width
    push hl
    ld hl,(MB_TMP + 8 * ME_SIZE + 3)
    ld (iy+ME_BX),l
    ld (iy+ME_BX+1),h
    ex de,hl
    ld de,16
    add hl,de                           ; the box's width
    ld (iy+ME_BW),l
    ld (iy+ME_BW+1),h
    ex de,hl
    ld hl,(MB_TMP + 8 * ME_SIZE + 3)
    add hl,de
    ld (MB_TMP + 8 * ME_SIZE + 3),hl
    ld de,513
    or a
    sbc hl,de
    pop hl                              ; -> the item count
    jp nc,.fail2                        ; the boxes end past 512
    ld a,(hl)
    or a
    jp z,.fail2
    cp 16
    jp nc,.fail2
    ld b,a                              ; B = n
    ld c,a
    inc hl
    ld de,0
    ld (iy+ME_DW),e
    ld (iy+ME_DW+1),d                   ; the widest so far
    ld (iy+ME_EN),e
    ld (iy+ME_EN+1),d
    ld de,1                             ; the bit for item k
.item:
    inc hl                              ; skip the id
    ld a,(hl)                           ; flags
    inc hl
    and 3
    jr nz,.off
    ld a,(iy+ME_EN)
    or e
    ld (iy+ME_EN),a
    ld a,(iy+ME_EN+1)
    or d
    ld (iy+ME_EN+1),a
.off:
    sla e
    rl d
    push de
    push bc
    call mb_textw                       ; DE = its width
    pop bc
    push hl
    ld l,(iy+ME_DW)
    ld h,(iy+ME_DW+1)
    or a
    sbc hl,de
    jr nc,.narrow
    ld (iy+ME_DW),e
    ld (iy+ME_DW+1),d
.narrow:
    pop hl
    pop de
    djnz .item
    ld l,(iy+ME_DW)                     ; W = widest + 24
    ld h,(iy+ME_DW+1)
    ld de,24
    add hl,de
    ld (iy+ME_DW),l
    ld (iy+ME_DW+1),h
    ld a,c                              ; H = 10 n + 2
    add a,a
    ld b,a
    add a,a
    add a,a
    add a,b
    add a,2
    ld (iy+ME_DH),a
    ld e,a                              ; the save-under: 4 + (((W + 9) >> 3) + 1) (H + 1) <= 2,048
    ld d,0
    inc de                              ; DE = H + 1
    ld bc,9
    add hl,bc
    srl h
    rr l
    srl h
    rr l
    srl h
    rr l
    inc hl                              ; HL = columns (at most 64 + 2 here)
    ld a,h
    or a
    jp nz,.fail1
    ld b,l
    ld hl,4
.mul:
    add hl,de
    djnz .mul
    ld de,2049
    or a
    sbc hl,de
    jp nc,.fail1
    ld l,(iy+ME_DW)                     ; x = min(box x, 512 - (W + 2))
    ld h,(iy+ME_DW+1)
    inc hl
    inc hl
    ex de,hl
    ld hl,512
    or a
    sbc hl,de                           ; 512 - (W + 2)
    ld e,(iy+ME_BX)
    ld d,(iy+ME_BX+1)
    push hl
    or a
    sbc hl,de
    pop hl
    jr c,.left                          ; 512 - (W + 2) < box x
    ex de,hl
.left:
    ld (iy+ME_DX),l
    ld (iy+ME_DX+1),h
    ld de,ME_SIZE
    add iy,de
    pop hl                              ; -> the next record's word
    pop bc
    dec b
    jp nz,.menu
    ld hl,MB_TMP                        ; accepted: the entries, the count and the table
    ld de,MB_ENT
    ld bc,8 * ME_SIZE
    ldir
    ld a,(MB_TMP + 8 * ME_SIZE)
    ld (MB_N),a
    ld hl,(MB_TMP + 8 * ME_SIZE + 1)
    ld (MB_TABLE),hl
.damage:
    ld a,$FF
    ld (MB_OPEN),a
    ld (MB_HL),a
    ld hl,0
    ld (GA),hl
    ld (GA+2),hl
    ld hl,512
    ld (GA+4),hl
    ld hl,8
    ld (GA+6),hl
    call W_INVAL
    pop iy
    or a
    ret
.fail1:
    pop hl
    pop bc
    jr .fail
.fail2:
    pop hl
    pop bc
.fail:
    pop iy
    scf
    ret

; mb_textw: HL -> a string (length byte, codes) -> DE = its G_TEXTW width, HL -> after it.  Clobbers AF, BC; GA+4, GA+6.
mb_textw:
    ld a,(hl)
    inc hl
    ld (GA+4),hl
    ld c,a
    ld b,0
    ld (GA+6),bc
    push hl
    add hl,bc
    ex (sp),hl
    call G_TEXTW
    ex de,hl
    pop hl
    ret

; MB_ENABLE: A = menu index, C = item index, B = 1 enable / 0 disable.  A separator stays disabled.  Clobbers AF, HL.
MB_ENABLE:
    ld hl,MB_N
    cp (hl)
    ret nc
    push iy
    push de
    push bc
    call mb_ent                         ; IY = the entry
    pop bc
    push bc
    ld a,c
    call mb_item                        ; HL -> item C (carry: out of range)
    jr c,.out
    inc hl
    bit 1,(hl)                          ; a separator
    jr nz,.out
    ld a,c
    call mb_bit                         ; DE = bit C
    pop bc
    push bc
    ld a,b
    or a
    jr z,.clear
    ld a,(iy+ME_EN)
    or e
    ld (iy+ME_EN),a
    ld a,(iy+ME_EN+1)
    or d
    ld (iy+ME_EN+1),a
    jr .out
.clear:
    ld a,e
    cpl
    and (iy+ME_EN)
    ld (iy+ME_EN),a
    ld a,d
    cpl
    and (iy+ME_EN+1)
    ld (iy+ME_EN+1),a
.out:
    pop bc
    pop de
    pop iy
    ret

; mb_ent: A = a menu index -> IY = its entry.  Clobbers AF, DE.
mb_ent:
    ld e,a
    add a,a
    add a,a
    ld d,a                              ; 4 i
    add a,a                             ; 8 i
    add a,d
    add a,e                             ; 13 i
    add a,MB_ENT & $FF
    push hl
    ld l,a
    ld h,MB_ENT >> 8
    push hl
    pop iy
    pop hl
    ret

; mb_item: IY = an entry, A = k -> HL -> item k (its id); carry when k >= the item count.  Clobbers AF, B.
mb_item:
    ld b,a
    ld l,(iy+ME_REC)
    ld h,(iy+ME_REC+1)
    inc hl                              ; the title
    ld a,(hl)
    inc a
    add a,l
    ld l,a
    jr nc,.nc
    inc h
.nc:
    ld a,b
    cp (hl)                             ; k < n?
    ccf
    ret c
    inc hl
    inc b
.skip:
    dec b
    jr z,.done
    inc hl
    inc hl
    ld a,(hl)
    inc a
    add a,l
    ld l,a
    jr nc,.skip
    inc h
    jr .skip
.done:
    or a                                ; carry clear: found
    ret

; mb_bit: A = k (0..15) -> DE = 1 << k.  Clobbers AF.
mb_bit:
    ld de,1
    or a
    ret z
.l:
    sla e
    rl d
    dec a
    jr nz,.l
    ret

; mb_enabled: IY = an entry, A = k -> NZ when item k is enabled.  Clobbers AF, DE.
mb_enabled:
    call mb_bit
    ld a,(iy+ME_EN)
    and e
    ret nz
    ld a,(iy+ME_EN+1)
    and d
    ret

; mb_count: IY = an entry -> A = its item count ((H - 2) / 10).  Clobbers F.
mb_count:
    push bc
    ld a,(iy+ME_DH)
    sub 2
    ld b,0
.d:
    inc b
    sub 10
    jr nz,.d
    ld a,b
    pop bc
    ret

; ===========================================================================================================================
; mbar_draw (18.3): the ink bar and the titles in paper.
mbar_draw:
    xor a
    call G_SETOP
    ld hl,0
    ld (GA),hl
    ld (GA+2),hl
    ld hl,512
    ld (GA+4),hl
    ld hl,8
    ld (GA+6),hl
    call G_FILL
    ld a,(MB_N)
    or a
    ret z
    push iy
    ld b,a
    ld a,2
    call G_SETOP
    ld iy,MB_ENT
.t:
    push bc
    ld l,(iy+ME_BX)
    ld h,(iy+ME_BX+1)
    ld de,8
    add hl,de
    ld (GA),hl
    ld hl,0
    ld (GA+2),hl
    call mb_title                       ; GA+4, GA+6 = the title
    call G_TEXTP
    ld de,ME_SIZE
    add iy,de
    pop bc
    djnz .t
    pop iy
    ret

; mb_title: IY = an entry -> GA+4 = its title's codes, GA+6 = their count.  Clobbers AF, HL.
mb_title:
    ld l,(iy+ME_REC)
    ld h,(iy+ME_REC+1)
    inc hl
    ld a,(hl)
    inc hl
    ld (GA+4),hl
    ld l,a
    ld h,0
    ld (GA+6),hl
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; mb_open: A = a menu index: it opens (18.3).  MB_OPEN = A, MB_HL = none.  Clobbers AF, BC, DE, HL; GA; IY = its entry.
mb_open:
    ld (MB_OPEN),a
    call mb_ent
    ld a,$FF
    ld (MB_HL),a
    call mb_gasave                      ; GA = (x, 8, W + 2, H + 1)
    call P_SHIELD
    ld hl,W_SAVE_BASE
    ld (GA+8),hl
    call G_SAVERECT
    ld a,1                              ; paper, frame
    call G_SETOP
    call mb_gadd
    call G_FILL
    xor a
    call G_SETOP
    call mb_gadd
    call G_FRAME
    call mb_gadd                        ; the shadow: (x + W, 10, 2, H - 1) and (x + 2, 8 + H, W, 1)
    ld hl,(GA)
    ld de,(GA+4)
    add hl,de
    ld (GA),hl
    ld hl,10
    ld (GA+2),hl
    ld hl,(GA+6)
    dec hl
    ld (GA+6),hl
    ld hl,2
    ld (GA+4),hl
    call G_FILL
    call mb_gadd
    ld hl,(GA)
    inc hl
    inc hl
    ld (GA),hl
    ld hl,(GA+6)
    ld de,8
    add hl,de
    ld (GA+2),hl
    ld hl,1
    ld (GA+6),hl
    call G_FILL
    call mb_count                       ; the items
    ld b,a
    ld c,0                              ; k
.item:
    push bc
    ld a,c
    call mb_item                        ; HL -> item k
    inc hl
    ld a,(hl)                           ; flags
    inc hl
    bit 1,a
    jr z,.text
    ld a,c                              ; a separator: G_HLINE (x + 1, 13 + 10 k, W - 2)
    call mb_rowy
    ld de,13
    add hl,de
    ex de,hl
    ld l,(iy+ME_DX)
    ld h,(iy+ME_DX+1)
    inc hl
    ld c,(iy+ME_DW)
    ld b,(iy+ME_DW+1)
    dec bc
    dec bc
    xor a
    call G_SETOP
    call G_HLINE
    jr .next
.text:
    ld a,(hl)                           ; the text at (x + 8, 10 + 10 k)
    inc hl
    ld (GA+4),hl
    ld l,a
    ld h,0
    ld (GA+6),hl
    ld l,(iy+ME_DX)
    ld h,(iy+ME_DX+1)
    ld de,8
    add hl,de
    ld (GA),hl
    ld a,c
    call mb_rowy
    ld de,10
    add hl,de
    ld (GA+2),hl
    xor a
    call G_SETOP
    call G_TEXTP
    pop bc
    push bc
    ld a,c
    call mb_enabled
    jr nz,.next
    call G_TEXTW                        ; disabled: every second glyph row cleared
    ld (GA+4),hl
    ld hl,1
    ld (GA+6),hl
    ld a,1
    call G_SETOP
    ld b,4
.dim:
    ld hl,(GA+2)
    inc hl
    ld (GA+2),hl
    push bc
    call G_FILL
    pop bc
    ld hl,(GA+2)
    inc hl
    ld (GA+2),hl
    djnz .dim
.next:
    pop bc
    inc c
    dec b
    jp nz,.item
    call P_UNSHIELD
    jp mb_titlex                        ; the title box inverted

; mb_rowy: A = k -> HL = 10 k.  Clobbers AF.
mb_rowy:
    ld l,a
    add a,a
    add a,a
    add a,l
    add a,a
    ld l,a
    ld h,0
    ret

; mb_gasave: GA = the open menu's save-under rectangle (x, 8, W + 2, H + 1).  mb_gadd: GA = its drop-down (x, 8, W, H).
mb_gasave:
    call mb_gadd
    ld hl,(GA+4)
    inc hl
    inc hl
    ld (GA+4),hl
    ld hl,(GA+6)
    inc hl
    ld (GA+6),hl
    ret
mb_gadd:
    ld l,(iy+ME_DX)
    ld h,(iy+ME_DX+1)
    ld (GA),hl
    ld hl,8
    ld (GA+2),hl
    ld l,(iy+ME_DW)
    ld h,(iy+ME_DW+1)
    ld (GA+4),hl
    ld l,(iy+ME_DH)
    ld h,0
    ld (GA+6),hl
    ret

; mb_titlex: the open menu's title box XORed, shielded.  Clobbers AF, BC, DE, HL; GA.
mb_titlex:
    ld l,(iy+ME_BX)
    ld h,(iy+ME_BX+1)
    ld (GA),hl
    ld hl,0
    ld (GA+2),hl
    ld l,(iy+ME_BW)
    ld h,(iy+ME_BW+1)
    ld (GA+4),hl
    ld hl,8
    ld (GA+6),hl
    jr mb_xorga

; mb_hlx: A = k: the highlight of item k XORed, shielded: (x + 1, 9 + 10 k, W - 2, 10).  Clobbers AF, BC, DE, HL; GA.
mb_hlx:
    call mb_rowy
    ld de,9
    add hl,de
    ld (GA+2),hl
    ld l,(iy+ME_DX)
    ld h,(iy+ME_DX+1)
    inc hl
    ld (GA),hl
    ld l,(iy+ME_DW)
    ld h,(iy+ME_DW+1)
    dec hl
    dec hl
    ld (GA+4),hl
    ld hl,10
    ld (GA+6),hl
mb_xorga:                               ; GA: XOR fill, shielded
    ld a,2
    call G_SETOP
    call P_SHIELD
    call G_FILL
    jp P_UNSHIELD

; mb_sethl: A = an item or $FF: the highlight moves there (nothing when it is there already).  Clobbers AF, BC, DE, HL; GA.
mb_sethl:
    ld hl,MB_HL
    cp (hl)
    ret z
    push af
    ld a,(hl)
    cp $FF
    call nz,mb_hlx
    pop af
    ld (MB_HL),a
    cp $FF
    ret z
    jp mb_hlx

; mb_close: the open menu closes (18.3).  Clobbers AF, BC, DE, HL; GA.
mb_close:
    ld a,$FF
    call mb_sethl
    call mb_gasave
    call P_SHIELD
    ld hl,W_SAVE_BASE
    call G_RESTRECT
    call P_UNSHIELD
    call mb_titlex
    ld a,$FF
    ld (MB_OPEN),a
    jp w_openz                          ; the save-under wrote over W_OPENAT (16.5)

; ---------------------------------------------------------------------------------------------------------------------------
; mb_titleat: BC = x, E = y -> A = the menu whose title box holds (x, y), or $FF.  Clobbers AF, D, HL.
mb_titleat:
    ld a,e
    cp 8
    jr nc,.none
    ld a,(MB_N)
    or a
    jr z,.none
    push iy
    push bc
    ld d,a
    ld iy,MB_ENT
    ld h,0
.l:
    push hl
    ld l,(iy+ME_BX)
    ld h,(iy+ME_BX+1)
    ld a,c
    sub l
    ld l,a
    ld a,b
    sbc a,h
    ld h,a                              ; x - box x
    jr c,.miss
    ld a,l
    sub (iy+ME_BW)
    ld a,h
    sbc a,(iy+ME_BW+1)
    jr c,.hit
.miss:
    pop hl
    push de
    ld de,ME_SIZE
    add iy,de
    pop de
    inc h
    dec d
    jr nz,.l
    pop bc
    pop iy
.none:
    ld a,$FF
    ret
.hit:
    pop hl
    ld a,h
    pop bc
    pop iy
    ret

; mb_itemat: BC = x, E = y, IY = the open menu -> A = the enabled item whose hit area holds (x, y), or $FF.  Clobbers AF, D, HL.
mb_itemat:
    ld l,(iy+ME_DX)
    ld h,(iy+ME_DX+1)
    inc hl
    ld a,c                              ; x >= x + 1
    sub l
    ld a,b
    sbc a,h
    jr c,.none
    ld l,(iy+ME_DX)
    ld h,(iy+ME_DX+1)
    push de
    ld e,(iy+ME_DW)
    ld d,(iy+ME_DW+1)
    add hl,de
    dec hl                              ; x + W - 1
    pop de
    ld a,c
    sub l
    ld a,b
    sbc a,h
    jr nc,.none
    ld a,e
    sub 9
    jr c,.none
    ld d,0
.div:
    cp 10
    jr c,.row
    sub 10
    inc d
    jr .div
.row:
    call mb_count
    ld l,a
    ld a,d
    cp l
    jr nc,.none
    push de
    call mb_enabled
    pop de
    jr z,.none
    ld a,d
    ret
.none:
    ld a,$FF
    ret

; mb_nexten: A = the start (or $FF), C = +1 or -1 -> A = the next enabled item that way, wrapping, or $FF.  Clobbers F, B, DE,
; HL.
mb_nexten:
    ld l,a
    call mb_count
    ld h,a                              ; n
    ld b,a                              ; at most n tries
    ld a,l
    cp $FF
    jr nz,.l
    ld a,c
    rlca
    ld a,$FF                            ; down: from -1
    jr nc,.l
    ld a,h                              ; up: from n
.l:
    add a,c
    jp p,.lo
    ld a,h
    dec a                               ; below 0: n - 1
.lo:
    cp h
    jr c,.in
    xor a                               ; n: 0
.in:
    ld l,a
    push hl
    call mb_enabled
    pop hl
    ld a,l
    ret nz
    djnz .l
    ld a,$FF
    ret

; mb_first: A = a menu index -> A = its first enabled item or $FF (IY = its entry).  Clobbers F, B, DE, HL.
mb_first:
    call mb_ent
    ld a,$FF
    ld c,1
    jr mb_nexten

; ===========================================================================================================================
; Tracking (18.4).

; mbar_event: MenuBar's M_EVENT.  An E_DOWN on a title opens that menu and tracks by pointer; not consumed (no capture).
mbar_event:
    ld a,(K_EV)
    cp E_DOWN
    jr nz,.no
    call w_point
    call mb_titleat
    cp $FF
    jr z,.no
    push iy
    call mb_open
    xor a
    ld (MB_MODE),a
    call mb_loop
    pop iy
.no:
    or a
    ret

; MB_KEY: the MENU key (desk_event).  The first menu with an enabled item opens, tracking by keyboard.  Preserves IX, IY.
MB_KEY:
    push iy
    ld a,(MB_N)
    ld c,a
    ld b,0
.find:
    ld a,b
    cp c
    jr nc,.out                          ; none has an enabled item
    push bc
    call mb_first
    pop bc
    cp $FF
    jr nz,.found
    inc b
    jr .find
.found:
    push af
    ld a,b
    call mb_open
    pop af
    call mb_sethl
    ld a,1
    ld (MB_MODE),a
    call mb_loop
.out:
    pop iy
    ret

; mb_loop: the tracking loop, until the menu closes.  IY = the open menu's entry throughout.
mb_loop:
    call K_GETEV
    jr nc,.ev
    halt
    jr mb_loop
.ev:
    cp E_KEY
    jp z,.key
    ld b,a
    ld a,(MB_MODE)
    or a
    ld a,b
    jr nz,.kdown                        ; by keyboard: only E_DOWN
    cp E_MOVE
    jr z,.move
    cp E_UP
    jr nz,mb_loop
    jp .choose
.move:
    call w_point
    call mb_titleat
    cp $FF
    jr z,.item
    ld hl,MB_OPEN
    cp (hl)
    jr z,.nohl                          ; its own title: no item
    push af
    call mb_close
    pop af
    call mb_open
    jr mb_loop
.item:
    call mb_itemat
.sethl:
    call mb_sethl
    jr mb_loop
.nohl:
    ld a,$FF
    jr .sethl
.kdown:
    cp E_DOWN
    jr nz,mb_loop
    xor a
    ld (MB_MODE),a                      ; by pointer from here
    call w_point
    call mb_titleat
    cp $FF
    jr z,.kin
    ld hl,MB_OPEN
    cp (hl)
    jp z,mb_loop                        ; the open menu's own title: nothing changes
    push af
    call mb_close
    pop af
    call mb_open
    jr mb_loop
.kin:
    push bc
    push de
    call mb_inside
    pop de
    pop bc
    jp nc,.close                        ; outside the open menu: close
    call mb_itemat
    jr .sethl
.key:
    ld a,(K_EV+1)
    cp KC_ESC
    jr z,.close
    cp KC_BREAK
    jr z,.close
    ld b,a
    ld a,(MB_MODE)
    or a
    jp z,mb_loop                        ; by pointer: other keys dropped
    ld a,b
    cp KC_MENU
    jr z,.close
    cp KC_ENTER
    jr z,.choose
    cp 8
    jr z,.left
    cp 9
    jr z,.right
    ld c,1
    cp 10
    jr z,.updown
    ld c,-1
    cp 11
    jp nz,mb_loop
.updown:
    ld a,(MB_HL)
    call mb_nexten
    cp $FF
    jp z,mb_loop
    jr .sethl
.left:
    ld c,-1
    jr .lr
.right:
    ld c,1
.lr:
    ld a,(MB_N)
    ld b,a
    ld a,(MB_OPEN)
    add a,c
    jp p,.lr0
    ld a,b
    dec a
.lr0:
    cp b
    jr c,.lr1
    xor a
.lr1:
    push af
    call mb_close
    pop af
    push af
    call mb_open
    pop af
    call mb_first
    jp .sethl
.choose:                                ; close; E_MENU (menu id, item id) when an item was highlighted
    ld a,(MB_HL)
    push af
    call mb_close
    pop af
    cp $FF
    ret z
    call mb_item                        ; HL -> the item's id
    ld e,(hl)
    ld l,(iy+ME_REC)
    ld h,(iy+ME_REC+1)
    ld c,(hl)
    ld d,0
    ld a,E_MENU_T
    jp K_POST
.close:
    jp mb_close

; mb_inside: BC = x, E = y -> carry when (x, y) is in the open menu's hit area: x + 1 <= px < x + W - 1, 9 <= py < H + 7
; (18.4; amended in W3: the first build took the whole drop-down, frame included).  Clobbers AF, DE, HL.
mb_inside:
    ld a,e
    sub 9
    ccf
    ret nc                              ; above row 9
    ld a,(iy+ME_DH)
    add a,7
    ld d,a
    ld a,e
    cp d
    ret nc                              ; at or below row H + 7
    ld l,(iy+ME_DX)
    ld h,(iy+ME_DX+1)
    inc hl
    ld a,c
    sub l
    ld l,a
    ld a,b
    sbc a,h
    ld h,a                              ; px - (x + 1)
    ccf
    ret nc                              ; left of it
    ld e,(iy+ME_DW)
    ld d,(iy+ME_DW+1)
    dec de
    dec de                              ; W - 2
    ld a,l
    sub e
    ld a,h
    sbc a,d                             ; carry when px - (x + 1) < W - 2
    ret
