; menu.asm -- the window manager, slice W3 (docs/WINDOWS.md 8 and 18): the menu bar, drop-downs with save-under, tracking by
; pointer and by keyboard, E_MENU.  Included by kernel1.asm.
;
; Menu table (section 8): count (1..8), then a word per menu -> record: id, title (length byte + codes), item count (1..15),
; then per item: id, flags (bit 0 disabled at start, bit 1 separator), text (length byte + codes).
; Each menu has an entry of 13 bytes (below), laid out by MB_SET.  The routines work on a copy of one entry at MC, the
; "selected" menu (mb_sel): the open menu while one is open.

E_MENU_T    EQU 7
MB_TABLE    EQU $F480           ; word: the table (0: no menus)
MB_N        EQU $F482           ; byte: menus
MB_OPEN     EQU $F483           ; byte: the open menu ($FF: none)
MB_HL       EQU $F484           ; byte: the highlighted item ($FF: none)
MB_MODE     EQU $F485           ; byte: 0 tracking by pointer, 1 by keyboard
MB_ENT      EQU $F486           ; 8 entries of 13 bytes ($F486-$F4ED)
ME_BX       EQU 0               ; word: the title box's x
ME_BE       EQU 2               ; word: where the box ends (the next box's x)
ME_REC      EQU 4               ; word: the menu's record
ME_DX       EQU 6               ; word: the drop-down's x
ME_DW       EQU 8               ; word: its width W
ME_N        EQU 10              ; byte: its items (its height H is 10 n + 2)
ME_EN       EQU 11              ; word: enable bits (bit n - 1 - k: item k)
ME_SIZE     EQU 13
MC          EQU $F4F0           ; the selected menu's entry, copied ($F4F0-$F4FC: after the W3 area that MB_SET keeps on a refusal)
MC_BX       EQU MC + ME_BX
MC_BE       EQU MC + ME_BE
MC_REC      EQU MC + ME_REC
MC_DX       EQU MC + ME_DX
MC_DW       EQU MC + ME_DW
MC_N        EQU MC + ME_N
MC_EN       EQU MC + ME_EN
MB_TMP      EQU W_SAVE_BASE     ; MB_SET builds the entries here first (W_SAVE is free while no menu is open)
W_SAVE_BASE EQU $E800
    ASSERT MB_ENT + 8 * ME_SIZE <= MC && MC + ME_SIZE <= $F500
    ASSERT MB_N == MB_TABLE + 2 && MB_OPEN == MB_N + 1 && MB_HL == MB_OPEN + 1 && (MB_N >> 8) == (MB_ENT >> 8)

; ---------------------------------------------------------------------------------------------------------------------------
; MB_SET (18.2): HL = a menu table or 0.  Carry (nothing changed) when the table breaks 18.2's limits.  Clobbers AF, BC, DE,
; HL; GA.  Preserves IX, IY.
MB_SET:
    ld a,h
    or l
    jp z,.set                           ; no menus: the table 0, the count 0
    ld a,(hl)
    dec a
    cp 8
    ccf
    ret c                               ; a count outside 1..8
    push hl                             ; the table
    ld b,(hl)
    inc hl
    ld de,8
    ld (MC_BX),de                       ; the first box's x
    ld de,MB_TMP
.menu:
    push bc                             ; B = menus left
    push de                             ; where its entry goes
    ld e,(hl)
    inc hl
    ld d,(hl)
    inc hl
    push hl                             ; -> the next record's word
    ld (MC_REC),de
    ex de,hl
    inc hl                              ; the title
    call mb_textw                       ; DE = its width, HL -> the item count
    ex de,hl
    ld bc,(MC_BX)
    add hl,bc
    ld bc,16
    add hl,bc
    ld (MC_BE),hl                       ; the box is the title + 16 wide
    ld bc,-513
    add hl,bc
    jp c,.fail                          ; it ends past 512
    ex de,hl
    ld a,(hl)
    ld (MC_N),a
    ld b,a                              ; B = n
    dec a
    cp 15
    jp nc,.fail                         ; no item, or over 15
    inc hl
    ld de,0
    ld (MC_DW),de                       ; the widest so far
    push de                             ; the enable bits
.item:
    inc hl                              ; over the id
    ld a,(hl)                           ; flags
    inc hl
    and 3
    sub 1                               ; carry: neither disabled nor a separator
    ex (sp),hl
    adc hl,hl
    ex (sp),hl
    push bc
    call mb_textw                       ; DE = the text's width
    pop bc
    push hl
    ld hl,(MC_DW)
    call w_max
    ld (MC_DW),hl
    pop hl
    djnz .item
    pop hl
    ld (MC_EN),hl
    ld hl,(MC_DW)                       ; W = the widest + 24
    ld de,24
    add hl,de
    ld (MC_DW),hl
    ld e,9                              ; the save-under: 4 + (((W + 9) >> 3) + 1) (H + 1) <= 2,048
    add hl,de
    call w_shr3
    inc hl
    ex de,hl                            ; DE = columns
    ld a,(MC_N)
    call mb_rowy
    add a,3
    ld b,a                              ; B = H + 1 = 10 n + 3
    ld hl,4
.mul:
    add hl,de
    djnz .mul
    ld de,-2049
    add hl,de
    jr c,.fail
    ld hl,510                           ; x = min(the box's x, 512 - (W + 2)), unsigned
    ld de,(MC_DW)
    sbc hl,de
    ld de,(MC_BX)
    call w_min
    ld (MC_DX),hl
    pop bc                              ; -> the next record's word
    pop de                              ; where the entry goes
    push bc
    ld hl,MC
    ld bc,ME_SIZE
    ldir
    ld hl,(MC_BE)
    ld (MC_BX),hl                       ; the next box starts where this one ends
    pop hl
    pop bc
    dec b
    jp nz,.menu
    ld hl,MB_TMP                        ; accepted: the entries, the table and the count
    ld de,MB_ENT
    ld bc,8 * ME_SIZE
    ldir
    pop hl
    ld a,(hl)
.set:
    ld (MB_TABLE),hl
    ld (MB_N),a
    ld hl,$FFFF
    ld (MB_OPEN),hl                     ; no menu open, no highlight
    ld de,8
    call w_band
    call W_INVAL                        ; the bar is damaged
    or a
    ret
.fail:
    pop hl
    pop hl
    pop hl
    pop hl
    scf
    ret

; mb_textw: HL -> a string (length byte, codes) -> DE = its G_TEXTW width, HL -> after it.  Clobbers AF, BC; GA+4, GA+6.
; mb_skip: HL -> a string -> HL -> after it.  Clobbers AF.
mb_textw:
    push hl
    call w_gastr
    call G_TEXTW
    ex de,hl
    pop hl
mb_skip:
    ld a,(hl)
    inc a
    add a,l
    ld l,a
    ret nc
    inc h
    ret

; MB_ENABLE: A = menu index, C = item index, B = 1 enable / 0 disable.  A separator stays disabled.  Clobbers AF, HL.
MB_ENABLE:
    ld hl,MB_N
    cp (hl)
    ret nc
    push de
    push bc
    call mb_sel                         ; HL -> after its entry (its enable bits are the last word)
    pop bc
    push bc
    push hl
    ld a,c
    call mb_item                        ; HL -> item C (carry: out of range)
    pop de
    jr c,.out
    inc hl
    bit 1,(hl)
    jr nz,.out                          ; a separator
    ex de,hl
    dec hl
    ld d,(hl)
    dec hl
    ld e,(hl)                           ; DE = the enable bits, HL -> them
    ld a,c
    call mb_enrot                       ; the item's bit in the carry; A = the turns
    pop bc
    push bc
    ld c,a
    ld a,b
    rra                                 ; carry = the new bit
    ld b,c
.back:
    rl e
    rl d
    djnz .back
    ld (hl),e
    inc hl
    ld (hl),d
.out:
    pop bc
    pop de
    ret

; mb_sel: A = a menu index -> its entry copied to MC; HL -> after the entry.  Clobbers AF, BC, DE.
mb_sel:
    ld l,a
    add a,a
    add a,a
    ld h,a                              ; 4 i
    add a,a
    add a,h
    add a,l                             ; 13 i
    add a,MB_ENT & $FF
    ld l,a
    ld h,MB_ENT >> 8
    ld de,MC
    ld bc,ME_SIZE
    ldir
    ret

; mb_item: A = k -> HL -> item k of the selected menu (its id), carry clear; carry when k >= its item count.  Clobbers AF, B.
mb_item:
    ld hl,MC_N
    cp (hl)
    ccf
    ret c
    ld b,a
    ld hl,(MC_REC)
    inc hl                              ; the title
    call mb_skip                        ; -> the item count
    inc hl
    inc b
    jr .next
.skip:
    inc hl
    inc hl
    call mb_skip
.next:
    djnz .skip
    or a
    ret

; mb_enabled: A = k -> carry when item k of the selected menu is enabled.  Clobbers AF, B, DE.
; mb_enrot: A = k, DE = enable bits -> DE turned right n - k times through the carry (item k's bit is in the carry); A = n - k.
mb_enabled:
    ld de,(MC_EN)
mb_enrot:
    ld b,a
    ld a,(MC_N)
    sub b
    ld b,a
.turn:
    rr d
    rr e
    djnz .turn
    ret

; ===========================================================================================================================
; mbar_draw (18.3): the ink bar and the titles in paper.
mbar_draw:
    IFDEF LOOK_MAC
    xor a                               ; LOOK 3.1: the line (0, 7, 512, 1) in ink,
    ld de,7 * 256 + 1
    call w_bandfill
    ld a,1
    ld de,7
    call w_bandfill                     ; paper (0, 0, 512, 7); GA+2 stays 0 for the titles
    ELSE
    xor a
    ld de,8
    call w_bandfill                     ; (0, 0, 512, 8); GA+2 stays 0 for the titles
    ENDIF
    ld a,(MB_N)
    or a
    ret z
    ld b,a
    IFDEF LOOK_MAC
    xor a                               ; the titles in ink
    ELSE
    ld a,2
    ENDIF
    call G_SETOP
.t:
    push bc
    ld a,(MB_N)
    sub b
    call mb_sel
    ld hl,(MC_BX)
    ld de,8
    add hl,de
    ld (GA),hl
    ld hl,(MC_REC)
    inc hl
    call w_gastr                        ; the title
    call G_TEXTP
    pop bc
    djnz .t
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; mb_switch: A = a menu index: the open menu closes and that one opens.
; mb_open: A = a menu index: it opens (18.3) and is the selected menu.  MB_OPEN = A.  Clobber AF, BC, DE, HL; GA.
mb_switch:
    push af
    call mb_close
    pop af
mb_open:
    ld (MB_OPEN),a
    call mb_sel                         ; (MB_HL is none whenever no menu is open)
    call mb_gasave                      ; GA = (x, 8, W + 2, H + 1)
    call P_SHIELD
    ld hl,W_SAVE_BASE
    ld (GA+8),hl
    call G_SAVERECT
    call mb_gadd                        ; paper, frame
    call w_boxga
    IFDEF LOOK_MAC
    call mb_gadd                        ; LOOK 3.1: no top line (the bar's line is the top edge): paper (x + 1, 8, W - 2, 1)
    ld hl,(GA)
    inc hl
    ld (GA),hl
    ld hl,(GA+4)
    dec hl
    dec hl
    ld (GA+4),hl
    ld hl,1
    ld (GA+6),hl
    call w_clearga
    xor a
    call G_SETOP                        ; the shadow below is ink
    ENDIF
    call mb_gadd                        ; the shadow: (x + W, 10, 2, H - 1) and (x + 2, 8 + H, W, 1)
    dec hl
    ld (GA+6),hl
    ld hl,(GA)
    ld de,(GA+4)
    add hl,de
    ld (GA),hl
    ld hl,10
    ld (GA+2),hl
    ld l,2
    ld (GA+4),hl
    call G_FILL
    ld hl,(GA+6)
    ld de,9
    add hl,de
    ex de,hl                            ; H - 1 + 9
    ld hl,(MC_DX)
    inc hl
    inc hl
    ld bc,(MC_DW)
    call G_HLINE
    xor a
    call mb_item                        ; HL -> item 0
    ld a,(MC_N)
    ld b,a                              ; B = items left
    ld c,0                              ; C = k
.item:
    inc hl
    bit 1,(hl)                          ; its flags
    inc hl                              ; -> its text
    push hl
    push bc
    jr z,.text
    ld a,c                              ; a separator: G_HLINE (x + 1, 13 + 10 k, W - 2)
    call mb_rowy
    add a,13
    ld e,a
    ld d,h
    ld hl,(MC_DX)
    inc hl
    ld bc,(MC_DW)
    dec bc
    dec bc
    call G_HLINE
    jr .next
.text:
    call w_gastr                        ; the text at (x + 8, 10 + 10 k)
    ld hl,(MC_DX)
    ld de,8
    add hl,de
    ld (GA),hl
    ld a,c
    call mb_rowy
    ld e,10
    add hl,de
    ld (GA+2),hl
    call G_TEXTP                        ; (it keeps GA)
    pop bc
    push bc
    ld a,c
    call mb_enabled
    jr c,.next
    call G_TEXTW                        ; disabled: every second glyph row cleared
    ld (GA+4),hl
    ld hl,1
    ld (GA+6),hl
    ld a,l
    call G_SETOP
    ld hl,GA+2
    dec (hl)
    ld b,4
.dim:
    ld hl,GA+2
    inc (hl)
    inc (hl)
    push bc
    call G_FILL
    pop bc
    djnz .dim
    xor a
    call G_SETOP
.next:
    pop bc
    pop hl
    call mb_skip                        ; -> the next item
    inc c
    djnz .item
    call P_UNSHIELD
; mb_titlex: the selected menu's title box XORed, shielded.  Clobbers AF, BC, DE, HL; GA.
mb_titlex:
    IFDEF LOOK_MAC
    ld de,7                             ; LOOK 3.1: rows 0-6, the line stays
    ELSE
    ld de,8
    ENDIF
    call w_band                         ; (0, 0, 512, 8), then its x and width
    ld hl,(MC_BX)
    ld (GA),hl
    ex de,hl
    ld hl,(MC_BE)
    or a
    sbc hl,de
    ld (GA+4),hl
mb_xorga:                               ; GA: XOR fill, shielded
    ld a,2
    call G_SETOP
    jp w_side

; mb_rowy: A = k -> HL = A = 10 k.  Clobbers F.
mb_rowy:
    ld l,a
    add a,a
    add a,a
    add a,l
    add a,a
    ld l,a
    ld h,0
    ret

; mb_gasave: GA = the selected menu's save-under rectangle (x, 8, W + 2, H + 1).  mb_gadd: GA = its drop-down (x, 8, W, H),
; HL = H.  Clobber AF.
mb_gasave:
    call mb_gadd
    inc hl
    ld (GA+6),hl
    ld hl,(GA+4)
    inc hl
    inc hl
    ld (GA+4),hl
    ret
mb_gadd:
    ld hl,(MC_DX)
    ld (GA),hl
    ld hl,8
    ld (GA+2),hl
    ld hl,(MC_DW)
    ld (GA+4),hl
    ld a,(MC_N)
    call mb_rowy
    inc l
    inc l                               ; H = 10 n + 2
    ld (GA+6),hl
    ret

; mb_sethl: A = an item or $FF: the highlight moves there (nothing when it is there already).  Clobbers AF, BC, DE, HL; GA.
; mb_hlx: A = k or $FF: the highlight of item k XORed, shielded: (x + 1, 9 + 10 k, W - 2, 10); nothing for $FF.
mb_sethl:
    ld hl,MB_HL
    cp (hl)
    ret z
    ld c,(hl)
    ld (hl),a
    push af
    ld a,c
    call mb_hlx                         ; off the old item
    pop af
mb_hlx:
    cp $FF
    ret z
    call mb_rowy
    add a,9
    ld l,a
    ld (GA+2),hl
    ld hl,(MC_DX)
    inc hl
    ld (GA),hl
    ld hl,(MC_DW)
    dec hl
    dec hl
    ld (GA+4),hl
    ld hl,10
    ld (GA+6),hl
    jr mb_xorga

; mb_close: the open menu closes (18.3).  Clobbers AF, BC, DE, HL; GA.
mb_close:
    ld a,$FF
    ld (MB_OPEN),a
    call mb_sethl
    call mb_gasave
    call P_SHIELD
    ld hl,W_SAVE_BASE
    call G_RESTRECT
    call P_UNSHIELD
    call mb_titlex
    jp w_openz                          ; the save-under wrote over W_OPENAT (16.5)

; ---------------------------------------------------------------------------------------------------------------------------
; mb_titleat: the pointer event in K_EV -> BC = its x, DE = its y, A = the menu whose title box holds the point, or $FF.
; Clobbers F, HL.
mb_titleat:
    call w_point
    ld a,e
    cp 8
    jr nc,.none
    push de
    ld a,(MB_N)
    ld d,a                              ; D = menus
    ld e,$FF                            ; E = the menu tried
    ld hl,MB_ENT + ME_BX
.l:
    inc e
    ld a,e
    cp d
    jr nc,.nopop                        ; no more menus
    ld a,c
    sub (hl)
    inc hl
    ld a,b
    sbc a,(hl)
    inc hl
    jr c,.nopop                         ; left of this box: of all the rest too
    ld a,c
    sub (hl)
    inc hl
    ld a,b
    sbc a,(hl)
    jr c,.hit                           ; left of its end
    ld a,l
    add a,ME_SIZE - 3
    ld l,a
    jr .l
.hit:
    ld a,e
    pop de
    ret
.nopop:
    pop de
.none:
    ld a,$FF
    ret

; mb_itemat: BC = x, E = y -> carry when (x, y) is in the open menu's hit area (18.4: x + 1 <= px < x + W - 1, 9 <= py < 9 + 10 n),
; and then A = the item there when it is enabled, else $FF; carry clear and A = $FF outside it.  Clobbers F, B, DE, HL.
mb_itemat:
    ld a,e                              ; py
    ld h,b
    ld l,c
    ld de,(MC_DX)
    scf
    sbc hl,de                           ; px - (x + 1)
    jr c,.none                          ; left of it
    ld de,(MC_DW)
    dec de
    dec de
    sbc hl,de                           ; carry when px - (x + 1) < W - 2
    jr nc,.none
    sub 9
    jr c,.none                          ; above the first item
    ld d,$FF
.div:
    inc d
    sub 10
    jr nc,.div                          ; D = the row
    ld a,d
    ld hl,MC_N
    cp (hl)
    jr nc,.none                         ; below the last item
    push af
    call mb_enabled
    pop de
    ld a,d
    ret c                               ; an enabled item
    scf
    DB $3E                              ; LD A,n: skips the OR A
.none:
    or a
    ld a,$FF
    ret

; mb_first: A = the selected menu's first enabled item, or $FF.
; mb_nexten: A = the start (or $FF), C = +1 or -1 -> A = the selected menu's next enabled item that way, wrapping, or $FF.
; Clobber F, B, DE, HL.
mb_first:
    ld a,$FF
    ld c,1
mb_nexten:
    ld l,a
    ld a,(MC_N)
    ld h,a                              ; H = n
    ld b,a                              ; at most n tries
.l:
    ld a,l
    call mb_wrap
    ld l,a
    push hl
    push bc
    call mb_enabled
    pop bc
    pop hl
    ld a,l
    ret c
    djnz .l
    ld a,$FF
    ret

; mb_wrap: A = an index (or $FF), C = +1 or -1, H = the count -> A = A + C, wrapped into 0 .. H - 1.  Clobbers F.
mb_wrap:
    add a,c
    jp p,.lo
    ld a,h
    dec a                               ; below 0: the last
.lo:
    cp h
    ret c
    xor a                               ; past the last: 0
    ret

; ===========================================================================================================================
; Tracking (18.4).

; mbar_event: MenuBar's M_EVENT.  An E_DOWN on a title opens that menu and tracks by pointer; not consumed (no capture).
mbar_event:
    ld a,(K_EV)
    cp E_DOWN
    jr nz,.no
    call mb_titleat
    cp $FF
    jr z,.no
    call mb_open
    xor a
    call mb_track
.no:
    or a
    ret

; MB_KEY: the MENU key (desk_event).  The first menu with an enabled item opens, tracking by keyboard.  Preserves IX, IY.
MB_KEY:
    ld b,0
.find:
    ld a,b
    ld hl,MB_N
    cp (hl)
    ret nc                              ; none has an enabled item
    push bc
    call mb_sel
    call mb_first
    pop bc
    inc b
    cp $FF
    jr z,.find
    push af
    ld a,b
    dec a
    call mb_open
    pop af
    call mb_sethl
    ld a,1
; mb_track: A = 0 by pointer, 1 by keyboard: the tracking loop (mb_loop), until the menu closes.  The open menu is the selected
; one throughout.
mb_track:
    ld (MB_MODE),a
mb_loop:
    call w_wait                         ; A = the next event's type
    ld hl,MB_MODE
    cp E_KEY
    jr z,.key
    bit 0,(hl)
    jr nz,.bykey
    cp E_UP
    jr z,.choose
    cp E_MOVE
    jr z,.point                         ; (Z: a move)
    jr mb_loop
.bykey:                                 ; by keyboard: only E_DOWN, and tracking goes on by pointer
    cp E_DOWN
    jr nz,mb_loop
    ld (hl),0
    or a                                ; (NZ: the press)
.point:
    push af
    call mb_titleat
    ld hl,MB_OPEN
    cp (hl)
    jr z,.own
    cp $FF
    jr nz,.other
    call mb_itemat                      ; carry: in the hit area, A = the item or $FF
    jr nc,.outside
    pop hl
    jr .sethl
.other:                                 ; another menu's title: it opens instead
    pop hl
    call mb_switch
    jr mb_loop
.own:                                   ; its own title: no item (a move), nothing (the press)
    pop af
    jr nz,mb_loop
    jr .none
.outside:                               ; anywhere else: no item (a move), close (the press)
    pop af
    jr nz,.close
.none:
    ld a,$FF
.sethl:
    call mb_sethl
    jr mb_loop
.key:
    ld a,(K_EV+1)
    cp KC_ESC
    jr z,.close
    cp KC_BREAK
    jr z,.close
    bit 0,(hl)
    jr z,mb_loop                        ; by pointer: other keys dropped
    cp KC_MENU
    jr z,.close
    cp KC_ENTER
    jr z,.choose
    sub K_LEFT
    cp K_UP - K_LEFT + 1
    jr nc,mb_loop
    ld b,a                              ; 0 left, 1 right, 2 down, 3 up
    inc a
    and 2
    dec a
    ld c,a                              ; right, down: +1; left, up: -1
    bit 1,b
    jr z,.leftright
    ld a,(MB_HL)
    call mb_nexten                      ; the next enabled item ($FF when there is none: then none is highlighted now)
    jr .sethl
.leftright:
    ld hl,(MB_N)                        ; L = menus, H = the open one
    ld a,h
    ld h,l
    call mb_wrap
    call mb_switch
    call mb_first
    jr .sethl
.choose:                                ; close; E_MENU (menu id, item id) when an item was highlighted
    ld a,(MB_HL)
    push af
    call mb_close
    pop af
    cp $FF
    ret z
    call mb_item                        ; HL -> the item's id
    IFDEF SOUND
    ld a,2                              ; the select sound (docs/SOUND.md; K_BEEP keeps HL)
    call K_BEEP
    ENDIF
    ld e,(hl)
    ld hl,(MC_REC)
    ld c,(hl)
    ld d,0
    ld a,E_MENU_T
    jp K_POST
.close:
    jp mb_close
