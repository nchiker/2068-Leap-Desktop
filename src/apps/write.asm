; write.asm -- Write, program 3 (docs/WRITE.md; W1 interface: section 11).  Code in DOCK 2-3 (mapping A); its RAM image (the
; TextView class and thunks, strings, menu table, variables) is assembled for PROG_IMG ($C000).  The document is a gap buffer in
; the app arena; the line table holds a byte per display line, its length.  Drawing goes through W_DRAWVIEW with the text view's
; modes (section 5, 11.1); every gfx6 call is a KFAR.

WR_CAP      EQU 5120
WR_MAXL     EQU 1024
TV_X        EQU 24
TV_Y        EQU 30
TV_W        EQU 448
TV_H        EQU 144
TV_N        EQU 16
TV_TW       EQU 444             ; W = w - 4
TV_TX       EQU 27              ; the text's x
TV_CMAX     EQU 471             ; the caret's largest x
WR_WINID    EQU 255
WM_FULL     EQU 0               ; the text view's drawing modes (WR_MODE)
WM_CARET    EQU 1
WM_FROM     EQU 2               ; line WR_MJ from offset WR_MO at x WR_MX
WM_LINES    EQU 3               ; lines WR_MJ .. WR_MJ2 (shown indices)
WM_SCROLL   EQU 4               ; by WR_MD lines (signed: > 0 the text moves up)

; WR_START: program 3 (11.2).  Never returns.
WR_START:
    ld hl,WR_IMG
    ld de,PROG_IMG
    ld bc,WR_IMG_LEN
    ldir
    ld hl,WR_MENUS
    KFAR MB_SET
    ld bc,WR_CAP
    call K_ALLOC
    ld (WR_BUF),hl
    ld bc,WR_MAXL
    call K_ALLOC
    ld (WR_LT),hl
    call wr_empty
    ld hl,CL_CWindow
    call K_NEW
    ld (WR_WIN),ix
    ld hl,16
    ld b,16
    ld de,480
    ld c,168
    ld a,WR_WINID
    call wr_rect
    ld (ix+Window_title),LOW WR_TITLE
    ld (ix+Window_title+1),HIGH WR_TITLE
    ld hl,CL_TextView
    call K_NEW
    ld (WR_TV),ix
    ld hl,TV_X
    ld b,TV_Y
    ld de,TV_W
    ld c,TV_H
    ld a,1
    call wr_rect
    ld (ix+View_flags),1
    call wr_add
    ld hl,CL_VScroll
    call K_NEW
    ld (WR_BAR),ix
    ld hl,478
    ld b,28
    ld de,12
    ld c,148
    ld a,2
    call wr_rect
    ld hl,(WR_TV)
    ld (ix+VScroll_target),l
    ld (ix+VScroll_target+1),h
    ld (ix+VScroll_page),TV_N
    call wr_add
    ld ix,(WR_WIN)
    KFAR W_OPEN
    ld de,(WR_TV)
    KFAR K_SETFOCUS
    call wr_bar
    ld a,1
    KFAR K_MSET
wr_loop:
    call K_GETEV
    jr nc,.ev
    halt
    jr wr_loop
.ev:
    cp E_MENU
    jr z,.menu
    cp E_CMD
    jr z,.cmd
    KFAR TK_DISPATCH
    jr wr_loop
.menu:                          ; File (1): New (1)
    ld hl,(K_EV+1)
    dec l
    jr nz,wr_loop
    dec h
    jr nz,wr_loop
    ld a,2
    jr .ask
.cmd:
    ld a,(K_EV+1)
    cp WR_WINID
    ld a,1
    jr z,.ask                   ; quit
    ld a,(WR_PEND)
    or a
    jr z,wr_loop
    ld b,a
    ld a,(K_EV+1)
    dec a
    jr z,.discard
    dec a
    jr nz,wr_loop
    call wr_dclose              ; Cancel
    jr wr_loop
.discard:
    push bc
    call wr_dclose
    pop af
    jr .do
.ask:                           ; A = 1 quit, 2 New: the dialog first when changed (11.6)
    ld b,a
    ld a,(WR_CHG)
    or a
    ld a,b
    jr z,.do
    ld (WR_PEND),a
    call wr_dopen
    jr wr_loop
.do:
    dec a
    jr nz,.new
    KFAR K_QUIT
.new:
    call wr_empty
    call wr_bar
    xor a
    call wr_draw
    jr wr_loop

; wr_rect: IX = a new view: x = HL, y = B, w = DE, h = C, id = A.
wr_rect:
    ld (ix+View_x),l
    ld (ix+View_x+1),h
    ld (ix+View_y),b
    ld (ix+View_w),e
    ld (ix+View_w+1),d
    ld (ix+View_h),c
    ld (ix+View_id),a
    ret
; wr_add: IX = a view -> the window's last child.
wr_add:
    push ix
    pop de
    ld ix,(WR_WIN)
    KFAR K_ADDCHILD
    ret

; wr_dopen: the discard dialog (11.6), made once, opened.  wr_dclose: closed; nothing pending.
wr_dopen:
    ld ix,(WR_DLG)
    ld a,ixh
    or ixl
    jr nz,.open
    ld hl,CL_Dialog
    call K_NEW
    ld (WR_DLG),ix
    ld hl,128
    ld b,64
    ld de,256
    ld c,64
    xor a
    call wr_rect
    ld hl,CL_Label
    call K_NEW
    ld hl,144
    ld b,76
    ld de,200
    ld c,9
    xor a
    call wr_rect
    ld (ix+Label_text),LOW WR_SASK
    ld (ix+Label_text+1),HIGH WR_SASK
    call .add
    ld hl,224
    ld de,WR_SDISC
    ld a,1
    call .button
    ld (ix+View_flags),$11      ; focusable, the default
    push ix
    ld hl,304
    ld de,WR_SCANC
    ld a,2
    call .button
    push ix
    ld ix,(WR_DLG)
    pop hl
    ld (ix+Dialog_cancel),l
    ld (ix+Dialog_cancel+1),h
    pop hl
    ld (ix+Dialog_default),l
    ld (ix+Dialog_default+1),h
.open:
    KFAR W_OPEN
    ret
.button:                        ; HL = x, DE = the text, A = id -> a Button (y 100, 64 x 16, focusable), added
    push de
    push af
    push hl
    ld hl,CL_Button
    call K_NEW
    pop hl
    pop af
    ld b,100
    ld de,64
    ld c,16
    call wr_rect
    pop de
    ld (ix+Button_text),e
    ld (ix+Button_text+1),d
    ld (ix+View_flags),1
.add:
    push ix
    pop de
    push ix
    ld ix,(WR_DLG)
    KFAR K_ADDCHILD
    pop ix
    ret
wr_dclose:
    ld ix,(WR_DLG)
    KFAR W_CLOSE
    xor a
    ld (WR_PEND),a
    ret

; ===========================================================================================================================
; The document.

; wr_empty: an empty document (one empty line), top 0, not changed.  Nothing drawn.
wr_empty:
    ld hl,0
    ld (WR_GS),hl
    ld (WR_TOP),hl
    ld (WR_TS),hl
    ld (WR_CL),hl
    ld (WR_CLS),hl
    ld hl,WR_CAP
    ld (WR_GE),hl
    ld hl,1
    ld (WR_NL),hl
    ld hl,(WR_LT)
    ld (hl),0
    xor a
    ld (WR_CHG),a
    ld (WR_RUN),a
    ld hl,$FFFF
    ld (WR_BNL),hl              ; the bar is set next time
; wr_gab: WR_GA, WR_GB, WR_EA from the buffer, WR_GS, WR_GE.  Clobbers DE, HL.
wr_gab:
    ld de,(WR_BUF)
    ld hl,(WR_GS)
    add hl,de
    ld (WR_GA),hl
    ld hl,(WR_GE)
    add hl,de
    ld (WR_GB),hl
    ld hl,WR_CAP
    add hl,de
    ld (WR_EA),hl
    ret

; wr_len: HL = L = GS + CAP - GE.  Clobbers F, DE.
wr_len:
    ld hl,WR_CAP
    ld de,(WR_GE)
    or a
    sbc hl,de
    ld de,(WR_GS)
    add hl,de
    ret

; wr_ptr: HL = an offset -> HL = its address (past the gap from GS on).  Clobbers F, DE.
wr_ptr:
    ld de,(WR_GS)
    or a
    sbc hl,de
    jr nc,.after
    add hl,de
    ld de,(WR_BUF)
    add hl,de
    ret
.after:
    ld de,(WR_GB)
    add hl,de
    ret

; wr_lt: HL = a line index -> HL -> its entry, A = its length.  Clobbers F, DE.
wr_lt:
    ld de,(WR_LT)
    add hl,de
    ld a,(hl)
    ret

; wr_lstart: HL = a line index -> HL = its start (walked from top's start).  Clobbers AF, BC, DE.
wr_lstart:
    ld b,h
    ld c,l                      ; BC = t
    ld hl,(WR_TOP)
    or a
    sbc hl,bc                   ; top - t
    ld de,(WR_TS)
    jr c,.fwd
    jr z,.at
.back:                          ; t < top: TS less the lengths of t .. top - 1
    push hl
    push de
    ld h,b
    ld l,c
    call wr_lt
    pop de
    ld l,a
    ld a,e
    sub l
    ld e,a
    jr nc,.nb
    dec d
.nb:
    inc bc
    pop hl
    dec hl
    ld a,h
    or l
    jr nz,.back
.at:
    ex de,hl
    ret
.fwd:                           ; t > top: TS plus the lengths of top .. t - 1
    ld hl,(WR_TOP)
.f:
    push hl
    push de
    call wr_lt
    pop de
    add a,e
    ld e,a
    jr nc,.nf
    inc d
.nf:
    pop hl
    inc hl
    or a
    sbc hl,bc
    add hl,bc
    jr nz,.f
    ex de,hl
    ret

; wr_tw: HL = an offset, B = codes (0-255) -> DE = their width: at most two runs, either side of the gap.  Clobbers AF, BC, HL.
wr_tw:
    ld de,0
    ld a,b
    or a
    ret z
    push de
    ld de,(WR_GS)
    ex de,hl
    or a
    sbc hl,de                   ; GS - from
    jr c,.after
    jr z,.after
    ld a,h                      ; codes before the gap: min(B, GS - from)
    or a
    jr nz,.all
    ld a,l
    cp b
    jr nc,.all
    ld c,a
    ld a,b
    sub c
    push af                     ; the codes after the gap
    ld b,c
    ld hl,(WR_BUF)
    add hl,de
    pop af
    pop de
    push af
    call wr_twr
    pop af
    ld b,a
    ld hl,(WR_GB)
    jr wr_twr
.all:
    ld hl,(WR_BUF)
    add hl,de
    pop de
    jr wr_twr
.after:
    ex de,hl
    call wr_ptr
    pop de
; wr_twr: HL = an address, B = codes (> 0), DE = a width -> DE + their advances.  Clobbers AF, BC, HL.
wr_twr:
    ld a,(hl)
    inc hl
    ld c,l
    ld l,a
    ld a,h
    ld h,PROP6_W >> 8
    ld l,(hl)
    ld h,a
    ld a,l
    ld l,c
    add a,e
    ld e,a
    jr nc,.n
    inc d
.n:
    djnz wr_twr
    ret

; wr_gap: HL = an address -> GB when it is GA.  Clobbers F.
wr_gap:
    push de
    ld de,(WR_GA)
    or a
    sbc hl,de
    add hl,de
    pop de
    ret nz
    ld hl,(WR_GB)
    ret

; wr_line: HL = a line's start offset -> C = its length (11.4).  Clobbers AF, B, DE, HL; the alternate set kept.
; Main set: HL = the address, C = codes, B = codes up to the last space.  Alternate: BC' = codes to the next boundary (the gap
; or the end), DE' = room left (W - width), H' = PROP6_W's page.
wr_line:
    exx
    push bc
    push de
    push hl
    exx
    call wr_ptr
    call wr_run
    ld bc,0
.l:
    ld a,c
    inc a
    jr z,.out                   ; 255 codes
    exx
    ld a,b
    or c
    jr z,.bound
    dec bc
    exx
    ld a,(hl)
    cp 13
    jr z,.cr
    exx
    ld l,a
    ld a,e
    sub (hl)
    ld e,a
    jr nc,.ok
    dec d
    jp m,.over
.ok:
    ld a,l
    exx
    inc c
    inc hl
    cp ' '
    jr nz,.l
    ld b,c
    jr .l
.bound:
    exx
    call wr_next
    jr nz,.l
.out:
    exx
    pop hl
    pop de
    pop bc
    exx
    ret
.cr:
    inc c
    jr .out
.over:                          ; the code at HL takes the line past W
    ld a,l
    exx
    cp ' '
    jr z,.sp
    ld a,b
    or a
    jr z,.word
    ld c,b                      ; after the last space
    jr .out
.word:
    ld a,c
    or a
    jr nz,.out                  ; before this code
    inc c                       ; at least one code
    jr .out
.sp:                            ; this space and every space after it
    inc c
    inc hl
.sl:
    ld a,c
    inc a
    jr z,.out
    exx
    ld a,b
    or c
    jr z,.sb
    dec bc
    exx
    ld a,(hl)
    cp ' '
    jr nz,.out
    inc c
    inc hl
    jr .sl
.sb:
    exx
    call wr_next
    jr nz,.sl
    jr .out

; wr_run: HL = an address (main set) -> BC' = the codes to the next boundary, DE' = W, H' = PROP6_W's page.  Clobbers AF, DE.
wr_run:
    ex de,hl
    ld hl,(WR_GA)
    or a
    sbc hl,de
    jr nc,.r                    ; at or before the gap
    ld hl,(WR_EA)
    or a
    sbc hl,de
.r:
    push hl
    ex de,hl
    exx
    pop bc
    ld de,TV_TW
    ld h,PROP6_W >> 8
    exx
    ret
; wr_next: at a boundary (main set, HL): Z at the end; else HL = GB and BC' = the codes to the end (NZ, or Z when there are none).
wr_next:
    push de
    ld de,(WR_EA)
    or a
    sbc hl,de
    add hl,de
    pop de
    ret z
    ld hl,(WR_GB)
    push de
    ex de,hl
    ld hl,(WR_EA)
    or a
    sbc hl,de
    push hl
    ex de,hl
    exx
    pop bc
    exx
    pop de
    exx
    ld a,b
    or c
    exx
    ret

; wr_findcl: WR_CL / WR_CLS follow the caret (the last line whose start <= GS).  Clobbers AF, BC, DE, HL.
wr_findcl:
.back:
    ld hl,(WR_GS)
    ld de,(WR_CLS)
    or a
    sbc hl,de
    jr nc,.fwd
    ld hl,(WR_CL)
    dec hl
    ld (WR_CL),hl
    call wr_lt
    ld hl,(WR_CLS)
    ld e,a
    ld d,0
    or a
    sbc hl,de
    ld (WR_CLS),hl
    jr .back
.fwd:
    ld hl,(WR_CL)
    inc hl
    ld de,(WR_NL)
    or a
    sbc hl,de
    ret nc                      ; the last line
    ld hl,(WR_CL)
    call wr_lt
    ld hl,(WR_CLS)
    ld e,a
    ld d,0
    add hl,de                   ; the next line's start
    ex de,hl
    ld hl,(WR_GS)
    or a
    sbc hl,de
    ret c                       ; caret before it
    ld (WR_CLS),de
    ld hl,(WR_CL)
    inc hl
    ld (WR_CL),hl
    jr .fwd

; wr_moveto: HL = an offset (0..L): the gap moved there (the caret).  Clobbers AF, BC, DE, HL.
wr_moveto:
    ld de,(WR_GS)
    or a
    sbc hl,de
    ret z
    jr c,.left
    ld b,h                      ; right by n: [GB, GB + n) -> [GA, ..)
    ld c,l
    ld hl,(WR_GS)
    add hl,bc
    ld (WR_GS),hl
    ld hl,(WR_GE)
    add hl,bc
    ld (WR_GE),hl
    ld hl,(WR_GB)
    ld de,(WR_GA)
    ldir
    jp wr_gab
.left:                          ; left by n: [GA - n, GA) -> [GB - n, GB)
    ex de,hl
    ld hl,0
    or a
    sbc hl,de
    ld b,h
    ld c,l                      ; n
    ld hl,(WR_GS)
    or a
    sbc hl,bc
    ld (WR_GS),hl
    ld hl,(WR_GE)
    or a
    sbc hl,bc
    ld (WR_GE),hl
    ld hl,(WR_GA)
    dec hl
    ld de,(WR_GB)
    dec de
    lddr
    jp wr_gab

; ---------------------------------------------------------------------------------------------------------------------------
; Rewrapping (2.1, 11.4).  WR_K / WR_KS: the first line to wrap and its start; WR_OM: the first old offset a line may sync at;
; WR_D: +1 (an insert) or -1 (a delete).  The old lines from WR_K are read as the new ones are written; a slot is opened when
; the new lines catch up with the old ones, and the old tail is closed up after the sync.  WR_WE = the line after the last
; written; WR_NL updated.
wr_rewrap:
    ld hl,(WR_NL)
    ld (WR_ONL),hl
    ld hl,(WR_K)
    ld (WR_W),hl
    ld (WR_R),hl
    ld hl,(WR_KS)
    ld (WR_OS),hl
    ld (WR_NS),hl
.adv:                           ; the old lines that start before ns are passed
    ld hl,(WR_R)
    ld de,(WR_ONL)
    or a
    sbc hl,de
    jr nc,.wrap
    ld hl,(WR_OS)               ; map(os)
    ld de,(WR_OM)
    or a
    sbc hl,de
    add hl,de
    jr c,.m
    ld a,(WR_D)
    ld e,a
    rla
    sbc a,a
    ld d,a
    add hl,de
.m:
    ld de,(WR_NS)
    or a
    sbc hl,de
    jr z,.eq
    jr nc,.wrap
.pass:
    ld hl,(WR_R)                ; os += LT[r]; r + 1
    inc hl
    ld (WR_R),hl
    dec hl
    call wr_lt
    ld hl,(WR_OS)
    ld e,a
    ld d,0
    add hl,de
    ld (WR_OS),hl
    jr .adv
.eq:                            ; an old line starts at ns: the sync after the edit; before it, the new line replaces it
    ld hl,(WR_OS)
    ld de,(WR_OM)
    or a
    sbc hl,de
    jp nc,.sync
    jr .pass
.wrap:
    ld hl,(WR_NS)
    call wr_line                ; C = the new line's length
    ld hl,(WR_W)
    ld de,(WR_R)
    or a
    sbc hl,de
    jr nz,.put                  ; w < r: the slot is free
    ld hl,(WR_ONL)
    or a
    sbc hl,de
    jr z,.put                   ; no old line left
    push bc                     ; open a slot: LT[r .. ONL) up by one
    ld b,h
    ld c,l                      ; ONL - r
    ld hl,(WR_ONL)
    ld de,WR_MAXL
    or a
    sbc hl,de
    jr nc,.full
    ld hl,(WR_ONL)
    inc hl
    ld (WR_ONL),hl
    jr .mv
.full:
    dec bc                      ; the table is full: its last entry is lost
.mv:
    ld a,b
    or c
    jr z,.mv0
    ld hl,(WR_R)
    add hl,bc
    ld de,(WR_LT)
    add hl,de
    ld d,h
    ld e,l
    dec hl
    lddr
.mv0:
    ld hl,(WR_R)
    inc hl
    ld (WR_R),hl
    pop bc
.put:
    ld hl,(WR_W)
    inc hl
    ld (WR_W),hl
    dec hl
    call wr_lt
    ld (hl),c                   ; LT[w] = the length
    ld hl,(WR_NS)
    ld b,0
    add hl,bc
    ld (WR_NS),hl
    call wr_len                 ; (DE clobbered)
    ld de,(WR_NS)
    or a
    sbc hl,de
    jp nz,.adv                  ; not at the end
    ld a,c                      ; at the end: the last line, unless it ends with 13
    or a
    jr z,.last
    ex de,hl
    dec hl
    call wr_ptr
    ld a,(hl)
    cp 13
    jp z,.adv                   ; an empty line follows
.last:
    ld hl,(WR_W)
    ld (WR_NL),hl
    ld (WR_WE),hl
    ret
.sync:                          ; the old lines from r are the new ones: closed up to w
    ld hl,(WR_W)
    ld (WR_WE),hl
    ld de,(WR_ONL)
    ex de,hl
    ld bc,(WR_R)
    or a
    sbc hl,bc                   ; ONL - r
    push hl
    add hl,de
    ld (WR_NL),hl               ; w + ONL - r
    pop bc
    ld hl,(WR_R)
    or a
    sbc hl,de
    ret z                       ; r = w
    ld a,b
    or c
    ret z
    ld hl,(WR_LT)
    add hl,de
    push hl
    ld hl,(WR_R)
    ld de,(WR_LT)
    add hl,de
    pop de
    ldir
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; Editing.  wr_edit: A = a code to insert, or 0 for DELETE.  Carry when nothing changed (full, or DELETE at 0).
wr_edit:
    ld (WR_C),a
    ld hl,(WR_CL)               ; kp: the edit's line
    ld (WR_KP),hl
    ld de,(WR_GS)
    or a
    jr z,.del
    ld (WR_P),de                ; insert at p = GS
    ld (WR_OM),de
    push af
    call wr_len
    ld de,WR_CAP
    or a
    sbc hl,de
    jr nc,.refuse
    ld hl,(WR_NL)
    ld de,WR_MAXL
    or a
    sbc hl,de
    jr nc,.refuse
    pop af
    ld hl,(WR_GA)
    ld (hl),a
    ld hl,(WR_GS)
    inc hl
    ld (WR_GS),hl
    ld a,1
    jr .go
.refuse:
    pop af
    scf
    ret
.del:
    ld a,d
    or e
    scf
    ret z                       ; DELETE at 0
    dec de
    ld (WR_P),de                ; delete at p = GS - 1
    ld (WR_GS),de
    inc de
    ld (WR_OM),de               ; p + 1
    ld hl,(WR_CLS)
    dec de
    or a
    sbc hl,de
    jr c,.kp
    jr z,.kp
    ld hl,(WR_KP)               ; p < CLS: the line before
    dec hl
    ld (WR_KP),hl
.kp:
    ld a,-1
.go:
    ld (WR_D),a
    ld a,1
    ld (WR_CHG),a
    call wr_gab
    ld hl,(WR_KP)               ; k = kp - 1 (or 0)
    ld a,h
    or l
    jr z,.k
    dec hl
.k:
    ld (WR_K),hl
    call wr_lstart              ; (top's start is still valid: lines before k do not change)
    ld (WR_KS),hl
    ld hl,(WR_K)
    call wr_lt
    ld (WR_OLDK),a
    ld hl,(WR_NL)
    ld (WR_ONL0),hl
    call wr_rewrap
    ld hl,(WR_K)                ; the caret's line, from k
    ld (WR_CL),hl
    ld hl,(WR_KS)
    ld (WR_CLS),hl
    call wr_findcl
    ld hl,(WR_K)                ; top's start again when top is past k (walked from k)
    ld de,(WR_TOP)
    or a
    sbc hl,de
    jr nc,.ts
    push de
    ld hl,(WR_KS)
    ld (WR_TS),hl
    ld hl,(WR_K)
    ld (WR_TOP),hl
    pop hl
    push hl
    call wr_lstart
    ld (WR_TS),hl
    pop hl
    ld (WR_TOP),hl
.ts:
    or a
    ret

; wr_edraw: after wr_edit: the changed lines drawn (11.1 modes), then the caret shown (a scroll when needed).
wr_edraw:
    ld hl,(WR_K)                ; F: k, or kp when line k is as it was
    ld de,(WR_KP)
    or a
    sbc hl,de
    jr nc,.fk
    ld hl,(WR_K)
    call wr_lt
    ld hl,WR_OLDK
    cp (hl)
    jr nz,.fk
    ld hl,(WR_KP)
    jr .f
.fk:
    ld hl,(WR_K)
.f:
    ld (WR_F),hl
    ld hl,(WR_NL)               ; the line count changed: F to the bottom
    ld de,(WR_ONL0)
    or a
    sbc hl,de
    ld de,$7FFF                 ; (to the last line shown)
    jr nz,.range
    ld hl,(WR_WE)               ; one line, the edit's: from the edit on
    ld de,(WR_F)
    dec hl
    or a
    sbc hl,de
    jr nz,.we
    ld hl,(WR_F)
    ld de,(WR_KP)
    or a
    sbc hl,de
    jr nz,.we
    ld hl,(WR_F)
    call wr_jof                 ; A = the line's shown index, carry when not shown
    jr c,.show
    ld (WR_MJ),a
    ld hl,(WR_F)
    call wr_lstart              ; HL = its start
    push hl
    ex de,hl
    ld hl,(WR_P)
    ld (WR_MO),hl
    or a
    sbc hl,de
    ld b,l                      ; codes before p
    pop hl
    call wr_tw
    ld hl,TV_TX
    add hl,de
    ld (WR_MX),hl
    ld a,WM_FROM
    call wr_draw
    jr .show
.we:
    ld hl,(WR_WE)
    dec hl
    ex de,hl                    ; DE = the last line written
.range:                         ; lines F .. DE, the shown part
    ld hl,(WR_TOP)
    ex de,hl
    or a
    sbc hl,de                   ; last - top
    jr c,.show
    ld a,h
    or a
    jr nz,.r15
    ld a,l
    cp TV_N
    jr c,.r
.r15:
    ld a,TV_N - 1
.r:
    ld (WR_MJ2),a
    ld hl,(WR_F)
    or a
    sbc hl,de                   ; F - top
    jr nc,.r0
    ld hl,0
.r0:
    ld a,h
    or a
    jr nz,.show
    ld a,l
    cp TV_N
    jr nc,.show
    ld (WR_MJ),a
    ld a,WM_LINES
    call wr_draw
.show:
    jp wr_shown

; wr_jof: HL = a line -> A = its index among the lines shown; carry when it is not shown.  Clobbers F, DE, HL.
wr_jof:
    ld de,(WR_TOP)
    or a
    sbc hl,de
    ret c
    ld a,h
    or a
    scf
    ret nz
    ld a,l
    cp TV_N
    ccf
    ret

; wr_shown: top follows the caret (11.5): a scroll (or a full draw), else the caret drawn; the bar set when top or the line count
; changed.
wr_shown:
    ld hl,(WR_CL)
    ld de,(WR_TOP)
    or a
    sbc hl,de
    jr c,.up                    ; above: top = CL
    ld de,TV_N
    sbc hl,de
    jr c,.caret                 ; shown
    ld hl,(WR_CL)
    ld de,TV_N - 1
    sbc hl,de                   ; top = CL - 15
    jr .top
.up:
    ld hl,(WR_CL)
.top:
    call wr_settop
    jr .bar
.caret:
    ld a,(WR_DRAWN)             ; an edit's draw drew the caret already
    or a
    ld a,WM_CARET
    call z,wr_draw
.bar:
    jp wr_bar

; wr_settop: HL = a new top: TS follows, and the view scrolls (|d| < 16) or is drawn in full.  Clobbers AF, BC, DE, HL.
wr_settop:
    ld de,(WR_TOP)
    or a
    sbc hl,de
    jr z,.same
    push hl                     ; d
    add hl,de
    call wr_lstart              ; (from the old top)
    ld (WR_TS),hl
    pop hl
    ld de,(WR_TOP)
    add hl,de
    ld (WR_TOP),hl
    or a
    sbc hl,de                   ; d again
    ld a,h
    or a
    jr z,.pos
    inc a
    jr nz,.full
    ld a,l
    cp -(TV_N - 1)
    jr c,.full
    jr .scr
.pos:
    ld a,l
    cp TV_N
    jr nc,.full
.scr:
    ld (WR_MD),a
    ld a,WM_SCROLL
    jr wr_draw
.full:
    xor a
    jr wr_draw
.same:
    ld a,WM_CARET
; wr_draw: A = a mode: W_DRAWVIEW of the text view in it (the caret worked out first); the caret drawn is then the new one.
wr_draw:
    ld (WR_MODE),a
    ld (WR_DRAWN),a             ; (non-zero unless a full draw: then nothing follows it in the same event)
    call wr_nc
    push ix
    ld ix,(WR_TV)
    call wr_dv
    pop ix
wr_drawn:
    ld hl,WR_NCX
    ld de,WR_OCX
    ld bc,4
    ldir
    xor a
    ld (WR_MODE),a
    ret

; wr_nc: the new caret (11.3): WR_NCV (1 when focused and shown), WR_NCX, WR_NCY.  wr_ncf: with A = 1 focused, 0 not.
wr_nc:
    ld hl,(K_FOCUS)
    ld de,(WR_TV)
    or a
    sbc hl,de
    ld a,0
    jr nz,wr_ncf
    inc a
wr_ncf:
    ld (WR_NCV),a
    or a
    ret z
    ld hl,(WR_CL)
    call wr_jof
    jr nc,.sh
    xor a
    ld (WR_NCV),a
    ret
.sh:
    ld b,a                      ; y = 30 + 9 j
    add a,a
    add a,a
    add a,a
    add a,b
    add a,TV_Y
    ld (WR_NCY),a
    ld hl,(WR_GS)
    ld de,(WR_CLS)
    or a
    sbc hl,de
    ld b,l
    ex de,hl
    call wr_tw
    ld hl,TV_X + 2
    add hl,de
    ld de,TV_CMAX
    call wr_min
    ld (WR_NCX),hl
    ret

; wr_bar: the bar set from top and the line count (11.5: scaled by 1, 2 or 4), when either changed since it was last set.
; Clobbers AF, BC, DE, HL.
wr_bar:
    ld hl,(WR_NL)
    ld de,(WR_BNL)
    or a
    sbc hl,de
    jr nz,.set
    ld hl,(WR_TOP)
    ld de,(WR_BTOP)
    or a
    sbc hl,de
    ret z
.set:
    ld hl,(WR_NL)
    ld (WR_BNL),hl
    ld de,(WR_TOP)
    ld (WR_BTOP),de
    ld bc,TV_N
    or a
    sbc hl,bc
    jr nc,.m
    ld hl,0                     ; M
.m:
    ld b,TV_N                   ; page
.k:
    ld a,h
    or a
    jr z,.ok
    inc hl
    srl h
    rr l                        ; ceil(M / 2)
    srl d
    rr e                        ; top / 2
    srl b
    jr .k
.ok:
    ld c,l
    ld a,d
    or a
    ld a,e
    jr z,.v
    ld a,255
.v:
    push ix
    ld ix,(WR_BAR)
    KFAR TK_SETBAR
    pop ix
    ret

; ===========================================================================================================================
; TextView's methods (banked, through the thunks in the image).

; tv_draw: M_DRAW in the mode WR_MODE (section 5, 11.1): exactly the pixels of a full draw.
tv_draw:
    ld a,(WR_MODE)
    or a
    jr nz,.part
    ld a,1
    KFAR G_SETOP
    call wr_gav
    KFAR G_FILL
    ld bc,TV_N * 256            ; B = 16 lines from C = 0, not cleared (the view is paper)
    call wr_lines0
    jp .newc
.part:
    push af                     ; the old caret cleared
    ld a,(WR_OCV)
    or a
    jr z,.nold
    ld a,1
    KFAR G_SETOP
    ld hl,(WR_OCX)
    ld a,(WR_OCY)
    call wr_cga
    KFAR G_FILL
.nold:
    pop af
    dec a
    jr z,.newc                  ; caret only
    dec a
    jr z,.from
    dec a
    jr z,.lines
    call wr_scroll
    jr .newc
.lines:
    ld a,(WR_MJ)
    ld c,a
    ld a,(WR_MJ2)
    sub c
    inc a
    ld b,a
    call wr_lines
    jr .newc
.from:                          ; line MJ from x MX: paper from MX - 1 to the right edge, then the codes from MO
    ld a,1
    KFAR G_SETOP
    ld hl,(WR_MX)
    dec hl
    ld (GA),hl
    ex de,hl
    ld hl,TV_X + TV_W
    or a
    sbc hl,de
    ld (GA+4),hl
    ld a,(WR_MJ)
    call wr_jy
    ld (GA+2),hl
    ld hl,9
    ld (GA+6),hl
    KFAR G_FILL
    xor a
    KFAR G_SETOP
    ld a,(WR_MJ)
    ld hl,(WR_TOP)
    ld e,a
    ld d,0
    add hl,de
    push hl
    call wr_lstart              ; the line's start and length (without a final 13)
    pop de
    push hl
    ex de,hl
    call wr_ltn                 ; C = its codes to draw
    pop de                      ; DE = start
    ld hl,(WR_MO)
    or a
    sbc hl,de
    ld a,c
    sub l
    ld c,a                      ; codes from MO to the line's end
    ld hl,(WR_MX)
    ld (GA),hl
    ld hl,(WR_MO)
    call wr_text
.newc:
    ld a,(WR_NCV)
    or a
    ret z
    xor a
    KFAR G_SETOP
    ld hl,(WR_NCX)
    ld a,(WR_NCY)
    call wr_cga
    KFAR G_FILL
    ret

; wr_cga: HL = x, A = y -> GA = (x, y, 1, 9) (a caret).
wr_cga:
    ld (GA),hl
    ld l,a
    ld h,0
    ld (GA+2),hl
    ld l,1
    ld (GA+4),hl
    ld l,9
    ld (GA+6),hl
    ret
; wr_gav: GA = the text view's rectangle.
wr_gav:
    ld hl,TV_X
    ld (GA),hl
    ld hl,TV_Y
    ld (GA+2),hl
    ld hl,TV_W
    ld (GA+4),hl
    ld hl,TV_H
    ld (GA+6),hl
    ret
; wr_jy: A = a shown index j -> HL = 30 + 9 j.  Clobbers AF.
wr_jy:
    ld l,a
    add a,a
    add a,a
    add a,a
    add a,l
    add a,TV_Y
    ld l,a
    ld h,0
    ret

; wr_lines: C = the first shown index, B = lines: each band cleared, then its text.  wr_lines0: not cleared.
wr_lines:
    ld a,1
    jr wr_lns
wr_lines0:
    xor a
wr_lns:
    ld (WR_CLR),a
.l:
    ld a,c
    cp TV_N
    ret nc
    push bc
    ld a,(WR_CLR)
    or a
    jr z,.t
    ld a,1
    KFAR G_SETOP
    ld hl,TV_X
    ld (GA),hl
    ld hl,TV_W
    ld (GA+4),hl
    ld hl,9
    ld (GA+6),hl
    pop bc
    push bc
    ld a,c
    call wr_jy
    ld (GA+2),hl
    KFAR G_FILL
.t:
    pop bc
    push bc
    call wr_tline
    pop bc
    inc c
    djnz .l
    ret

; wr_tline: C = a shown index: the line's text (nothing when there is no line).
wr_tline:
    ld hl,(WR_TOP)
    ld e,c
    ld d,0
    add hl,de
    push bc
    ex de,hl
    ld hl,(WR_NL)
    or a
    sbc hl,de
    pop bc
    ret z
    ret c
    push bc
    push de
    ex de,hl
    call wr_lstart
    pop de
    push hl
    ex de,hl
    call wr_ltn
    pop hl                      ; HL = start, C = codes
    pop de                      ; E = the shown index
    push hl
    push bc
    ld a,e
    call wr_jy
    ld (GA+2),hl
    ld hl,TV_TX
    ld (GA),hl
    xor a
    KFAR G_SETOP
    pop bc
    pop hl
; wr_text: HL = an offset, C = codes, GA x, y set: the codes drawn (G_TEXTP; two calls when they straddle the gap).
wr_text:
    ld a,c
    or a
    ret z
    ld de,(WR_GS)
    ex de,hl
    or a
    sbc hl,de                   ; GS - from
    jr c,.two
    jr z,.two
    ld a,h
    or a
    jr nz,.one
    ld a,l
    cp c
    jr nc,.one
    ld b,a                      ; g1 = GS - from < n
    push bc
    push de
    ex de,hl
    ld de,(WR_BUF)
    add hl,de
    ld (GA+4),hl
    ld l,b
    ld h,0
    ld (GA+6),hl
    KFAR G_TEXTP
    ld (GA),hl                  ; the pen
    pop de
    pop bc
    ld a,c
    sub b
    ld c,a
    ld hl,(WR_GB)
    jr .part
.one:                           ; all before the gap
    ex de,hl
    ld de,(WR_BUF)
    add hl,de
    jr .part
.two:                           ; all after the gap
    ex de,hl
    call wr_ptr
.part:
    ld (GA+4),hl
    ld l,c
    ld h,0
    ld (GA+6),hl
    KFAR G_TEXTP
    ret

; wr_ltn: HL = a line index, DE = its start -> C = its codes without a final 13.  Clobbers AF, DE, HL.
wr_ltn:
    push de
    call wr_lt
    pop hl
    ld c,a
    or a
    ret z
    ld e,a
    ld d,0
    add hl,de
    dec hl
    push bc
    call wr_ptr
    pop bc
    ld a,(hl)
    cp 13
    ret nz
    dec c
    ret

; wr_scroll: (in tv_draw) G_SCROLLV of the view by 9 MD rows under the clip, then the lines meeting the uncovered rows.
wr_scroll:
    call wr_gav
    ld a,(WR_MD)                ; 9 d as a signed word (135 for d = 15 does not fit a signed byte)
    ld l,a
    rla
    sbc a,a
    ld h,a
    ld d,h
    ld e,l
    add hl,hl
    add hl,hl
    add hl,hl
    add hl,de
    ld (GA+8),hl
    KFAR G_SCROLLV
    ld a,(WR_MD)                ; the uncovered rows: [cy1 - 9 d, cy1) for d > 0, [cy0, cy0 + 9 |d|) for d < 0
    ld b,a
    bit 7,a
    jr z,.pos
    neg
.pos:
    ld c,a
    add a,a
    add a,a
    add a,a
    add a,c
    ld c,a                      ; 9 |d|
    bit 7,b
    jr nz,.down
    ld a,(GCY1)
    ld d,a                      ; y1
    sub c
    jr nc,.u0
    xor a
.u0:
    ld e,a                      ; y0
    jr .rows
.down:
    ld a,(GCY0)
    ld e,a
    add a,c
    jr nc,.d1
    ld a,255
.d1:
    ld d,a
.rows:                          ; rows E..D-1, within the view's rows
    ld a,e
    cp TV_Y
    jr nc,.y0
    ld a,TV_Y
.y0:
    sub TV_Y
    ld e,a                      ; from the view's top
    ld a,d
    cp TV_Y + TV_H
    jr c,.y1
    ld a,TV_Y + TV_H
.y1:
    sub TV_Y
    ret c
    ret z
    dec a                       ; the last row
    cp e
    ret c                       ; nothing uncovered
    call wr_div9
    ld d,c                      ; the last line
    ld a,e
    call wr_div9                ; C = the first
    ld a,d
    sub c
    inc a
    ld b,a
    jp wr_lines

; wr_div9: A -> C = floor(A / 9).  wr_min: HL = min(HL, DE), unsigned.  Clobber AF (wr_min: and DE).
wr_div9:
    ld c,-1
.l:
    inc c
    sub 9
    jr nc,.l
    ret
wr_min:
    ld a,l
    sub e
    ld a,h
    sbc a,d
    ret c
    ex de,hl
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; tv_event: M_EVENT (11.5).  The type and data are read through DE.
tv_event:
    xor a
    ld (WR_DRAWN),a
    ex de,hl
    ld a,(hl)
    inc hl
    ld c,(hl)                   ; data 1
    inc hl
    ld b,(hl)                   ; data 2
    inc hl
    ld e,(hl)                   ; data 3
    cp E_KEY
    jr z,.key
    cp E_SCROLL
    jp z,.scroll
    cp E_DOWN
    jp z,.down
    cp E_UP
    jr z,.cons
    cp E_MOVE
    jr nz,.no
    ld hl,(K_CAPTURE)
    push ix
    pop de
    or a
    sbc hl,de
    jr z,.cons
.no:
    or a
    ret
.cons:
    scf
    ret
.key:
    ld a,c
    cp K_UP
    jp z,.up
    cp K_DOWN
    jp z,.dn
    push af
    xor a
    ld (WR_RUN),a
    pop af
    cp K_LEFT
    jr z,.left
    cp K_RIGHT
    jr z,.right
    cp KC_DELETE
    jr z,.del
    cp KC_ENTER
    jr z,.ins
    cp 32
    jr c,.no
    cp 127
    jr nc,.no
.ins:
    call wr_edit
    jr c,.cons
    call wr_edraw
    jr .cons
.del:
    xor a
    jr .ins
.left:
    ld hl,(WR_GS)
    ld a,h
    or l
    jr z,.cons
    dec hl
    jr .goto
.right:
    call wr_len
    ld de,(WR_GS)
    or a
    sbc hl,de
    jr z,.cons
    ex de,hl
    inc hl
.goto:                          ; the caret to HL; the view follows
    call wr_moveto
    call wr_findcl
    call wr_shown
    jr .cons
.up:
    call .tx
    ld hl,(WR_CL)
    ld a,h
    or l
    ld hl,0
    jr z,.goto                  ; the first line: 0
    ld hl,(WR_CL)
    dec hl
    jr .ud
.dn:
    call .tx
    ld hl,(WR_CL)
    inc hl
    ld de,(WR_NL)
    or a
    sbc hl,de
    jr c,.dn1
    call wr_len                 ; the last line: L
    jr .goto
.dn1:
    add hl,de
.ud:
    ld de,(WR_TX)
    call wr_pos
    jr .goto
.tx:                            ; the target x: the caret's, at the first UP / DOWN of a run
    ld a,(WR_RUN)
    or a
    ret nz
    inc a
    ld (WR_RUN),a
    ld hl,(WR_CLS)
    ld de,(WR_GS)
    ex de,hl
    or a
    sbc hl,de
    ld b,l
    ex de,hl
    call wr_tw
    ld (WR_TX),de
    ret
.down:                          ; a click: the line, then the position (11.5)
    xor a
    ld (WR_RUN),a
    ld a,e
    and 1
    ld d,a
    ld e,c                      ; DE = px
    ld hl,-TV_TX
    add hl,de
    push hl                     ; r = px - 27
    ld a,b
    sub TV_Y
    jr nc,.dy
    xor a
.dy:
    call wr_div9                ; C = (py - 30) / 9
    ld hl,(WR_TOP)
    ld b,0
    add hl,bc
    ex de,hl
    ld hl,(WR_NL)
    dec hl
    or a
    sbc hl,de
    jr c,.last
    ex de,hl
    jr .dl
.last:
    ld hl,(WR_NL)
    dec hl
.dl:
    pop de
    call wr_pos
    jp .goto
.scroll:                        ; E_SCROLL from the bar: top = min(value x k, M); the caret stays
    ld hl,(WR_NL)
    ld de,TV_N
    or a
    sbc hl,de
    jr nc,.sm
    ld hl,0
.sm:
    push hl                     ; M
    ld b,0                      ; log2 k: M halved (ceil) until it fits a byte
.sk:
    ld a,h
    or a
    jr z,.sv
    inc hl
    srl h
    rr l
    inc b
    jr .sk
.sv:
    ld l,c                      ; the value
    ld h,0
    inc b
    jr .sh
.shl:
    add hl,hl
.sh:
    djnz .shl
    pop de                      ; M
    call wr_min
    push hl
    call wr_settop
    pop hl
    ld (WR_BTOP),hl             ; the bar has it already
    jp .cons

; wr_pos: HL = a line, DE = r (signed) -> HL = the position in that line by TOOLKIT 10.4's rule (11.4's positions).
wr_pos:
    push de
    push hl
    call wr_lstart
    ld (WR_PS),hl
    pop hl
    push hl
    call wr_lt
    ld e,a
    ld d,0
    ld hl,(WR_PS)
    add hl,de                   ; the line's end
    pop bc
    inc bc
    push hl
    ld hl,(WR_NL)
    or a
    sbc hl,bc
    pop hl
    jr z,.lastl                 ; the last line: up to L (its end)
    dec hl                      ; else up to its last code
.lastl:
    ld (WR_PE),hl
    pop de                      ; r
    ld hl,(WR_PS)
.w:
    push hl
    push de
    ld de,(WR_PE)
    or a
    sbc hl,de
    pop de
    pop hl
    ret nc                      ; at the last position
    bit 7,d
    ret nz                      ; r < 0
    push hl
    push de
    call wr_ptr
    ld a,(hl)
    ld l,a
    ld h,PROP6_W >> 8
    ld a,(hl)                   ; the advance
    pop de
    pop hl
    ld b,a
    srl a
    inc d
    dec d
    jr nz,.ge
    cp e
    jr z,.ge
    ret nc                      ; r < floor(a / 2): here
.ge:
    ld a,e
    sub b
    ld e,a
    jr nc,.nc
    dec d
.nc:
    inc hl
    jr .w

; tv_focus / tv_blur: M_FOCUS / M_BLUR: the caret shown / hidden (a caret draw).
tv_focus:
    ld a,1
    jr tv_fb
tv_blur:
    xor a
tv_fb:
    call wr_ncf
    ld a,WM_CARET
    ld (WR_MODE),a
    call wr_dv
    jp wr_drawn

; wr_dv: IX = the text view: W_DRAWVIEW in WR_MODE.  A partial mode narrows the view's rows to those it draws for the call
; (its drawing uses the fixed rectangle of 11.3, so the pixels are the same; W_DRAWVIEW then scans and clips only those rows).
; Clobbers AF, BC, DE, HL.
wr_dv:
    ld a,(WR_MODE)
    cp WM_CARET
    jr z,.caret
    cp WM_FROM
    jr z,.one
    cp WM_LINES
    jr nz,.whole
    ld a,(WR_MJ)                ; lines MJ .. MJ2
    ld c,a
    ld a,(WR_MJ2)
    sub c
    inc a
    ld b,a
    add a,a
    add a,a
    add a,a
    add a,b
    ld b,a                      ; 9 lines
    ld a,c
    jr .rows
.one:
    ld a,(WR_MJ)
    ld b,9
.rows:                          ; A = the first shown index, B = rows
    call wr_jy
    ld a,l
    jr .narrow
.caret:                         ; the old and the new caret's rows
    ld a,(WR_OCV)
    ld b,a
    ld a,(WR_NCV)
    or b
    ret z                       ; neither shown: nothing to draw
    ld a,(WR_NCY)
    ld c,a
    ld e,a
    ld a,(WR_NCV)
    or a
    jr nz,.n
    ld a,(WR_OCY)
    ld c,a
    ld e,a
.n:
    ld a,(WR_OCV)
    or a
    jr z,.cy
    ld a,(WR_OCY)
    cp c
    jr nc,.c1
    ld c,a                      ; C = the top
.c1:
    cp e
    jr c,.cy
    ld e,a                      ; E = the bottom caret's top
.cy:
    ld a,e
    sub c
    add a,9
    ld b,a
    ld a,c
.narrow:
    ld (ix+View_y),a
    ld (ix+View_h),b
    KFAR W_DRAWVIEW
    ld (ix+View_y),TV_Y
    ld (ix+View_h),TV_H
    ret
.whole:
    KFAR W_DRAWVIEW
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; The RAM image (to PROG_IMG = $C000).
WR_IMG:
    DISP PROG_IMG
    DW CL_View
    DB 205, 6, View_SIZE, 8
CL_TextView:                    ; TextView: a View whose Draw, Event, Focus and Blur are banked
    DW view_destroy, WR_THD, WR_THE, view_hittest, WR_THF, WR_THB
WR_THD:     KTHUNK tv_draw
WR_THE:     KTHUNK tv_event
WR_THF:     KTHUNK tv_focus
WR_THB:     KTHUNK tv_blur
WR_TITLE:   DB 5, "Write"
WR_SASK:    DB 21, "Discard the document?"
WR_SDISC:   DB 7, "Discard"
WR_SCANC:   DB 6, "Cancel"
WR_MENUS:
    DB 1
    DW WR_M1
WR_M1:
    DB 1, 4, "File", 1
    DB 1, 0, 3, "New"
WR_BUF:     DW 0
WR_GS:      DW 0
WR_GE:      DW 0
WR_LT:      DW 0
WR_NL:      DW 0
WR_TOP:     DW 0
WR_CHG:     DB 0
WR_GA:      DW 0                ; BUF + GS
WR_GB:      DW 0                ; BUF + GE
WR_EA:      DW 0                ; BUF + CAP
WR_TS:      DW 0                ; top's start
WR_CL:      DW 0                ; the caret's line
WR_CLS:     DW 0                ; its start
WR_TX:      DW 0                ; UP / DOWN: the target x
WR_RUN:     DB 0
WR_WIN:     DW 0
WR_TV:      DW 0
WR_BAR:     DW 0
WR_DLG:     DW 0
WR_PEND:    DB 0                ; 1 quit, 2 New, waiting for the dialog
WR_MODE:    DB 0
WR_MJ:      DB 0
WR_MJ2:     DB 0
WR_MD:      DB 0
WR_MX:      DW 0
WR_MO:      DW 0
WR_OCX:     DW 0                ; the caret drawn: x, y, shown
WR_OCY:     DB 0
WR_OCV:     DB 0
WR_NCX:     DW 0                ; the caret to draw
WR_NCY:     DB 0
WR_NCV:     DB 0
WR_CLR:     DB 0
WR_C:       DB 0
WR_P:       DW 0
WR_KP:      DW 0
WR_K:       DW 0
WR_KS:      DW 0
WR_OM:      DW 0
WR_D:       DB 0
WR_OLDK:    DB 0
WR_ONL0:    DW 0
WR_ONL:     DW 0
WR_W:       DW 0
WR_R:       DW 0
WR_OS:      DW 0
WR_NS:      DW 0
WR_WE:      DW 0
WR_F:       DW 0
WR_DRAWN:   DB 0
WR_BNL:     DW $FFFF            ; the line count and top the bar was last set from
WR_BTOP:    DW 0
WR_PS:      DW 0
WR_PE:      DW 0
    ENT
WR_IMG_LEN  EQU $ - WR_IMG
    ASSERT WR_IMG_LEN <= 1024 && (CL_TextView >> 8) == ((CL_TextView + 11) >> 8)
    ASSERT WR_OCX + 3 == WR_OCV && WR_NCX + 3 == WR_NCV
WR_END:
