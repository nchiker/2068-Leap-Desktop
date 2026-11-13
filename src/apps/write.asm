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
WM_SEL      EQU 5               ; the selection's change: the lines of WR_SM (W2, 12.3)
MARK        EQU 18              ; the key code MARK (SS+E, 12.1)
WR_CLIP     EQU $7800           ; the clipboard (cold RAM, under K: 12.5)
WR_CLMAX    EQU 2048
WR_SCR      EQU $5800           ; cold RAM: the codes a refused paste puts back

; WR_START: program 3 (11.2).  Never returns.
WR_START:
    ld hl,WR_IMG
    ld de,PROG_IMG
    ld bc,WR_IMG_LEN
    ldir
    ld hl,WR_MENUS
    KFAR MB_SET
    ld hl,WR_SUNT
    call wr_nm
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
.menu:
    call WR_MENU
    jr wr_loop
.cmd:
    ld a,(K_EV+1)
    cp WR_WINID
    ld a,1
    jr z,.ask                   ; quit
    ld a,(WR_DK)
    or a
    jr nz,.dk
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
    call wr_do
    jr wr_loop
.ask:
    call wr_ask
    jr wr_loop
.dk:
    call wr_dkcmd
    jr wr_loop

; WR_MENU: Write's E_MENU handler (K_EV holds the record): File (1): New (1), Open... (2), Save... (3) (13.1); Edit (2): Cut,
; Copy, Paste, Select all (12.4).
WR_MENU:
    xor a
    ld (WR_DRAWN),a
    ld hl,(K_EV+1)              ; L = the menu, H = the item
    ld a,l
    cp 2
    jr z,wr_edmenu
    dec a
    ret nz
    ld a,h
    cp 3
    jp z,wr_sopen
    inc a                       ; New 2, Open 3
; wr_ask: A = 1 quit, 2 New, 3 Open: the dialog first when changed (11.6, 13.3).
wr_ask:
    ld b,a
    ld a,(WR_CHG)
    or a
    ld a,b
    jr z,wr_do
    ld (WR_PEND),a
    jp wr_dopen
; wr_do: A = 1 quit (never returns), 2 New, 3 Open.
wr_do:
    dec a
    jr nz,.new
    KFAR K_QUIT
.new:
    dec a
    jp nz,wr_open
; wr_new: an empty document named "Untitled", drawn (11.6, 13.1).
wr_new:
    call wr_empty
    ld hl,WR_SUNT
    call wr_setname
    call wr_bar
    xor a
    call wr_draw
    jp wr_menen

; wr_edmenu: H = an item of "Edit".  Each that takes effect ends the UP / DOWN run.
wr_edmenu:
    ld a,h
    cp 3
    jr z,.paste                 ; (a refused paste keeps the run: it changes nothing)
    xor a
    ld (WR_RUN),a
    ld a,h
    dec a
    jr z,.cut
    dec a
    jr z,.copy
    sub 2
    ret nz
    ld (WR_MK),a                ; Select all: anchor 0, caret L, mark 0
    ld h,a
    ld l,a
    ld (WR_AN),hl
    call wr_len
    call wr_moveto
    call wr_findcl
    call wr_seldraw
    jp wr_shown
.copy:
    call wr_copy
    xor a
    ld (WR_MK),a
    jp wr_menen
.cut:
    call wr_copy
    ret c
    ld bc,0
    xor a
    jp wr_replace
.paste:
    ld hl,WR_CLIP
    ld bc,(WR_CLN)
    ld a,b
    or c
    ret z
    ld a,1                      ; the lines counted
    call wr_replace
    ret c
    xor a
    ld (WR_RUN),a
    ret

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
    ld hl,WR_DLG
    ld de,WR_TDIS
    call wr_dlg
    KFAR W_OPEN
    ret
wr_dclose:
    ld ix,(WR_DLG)
    KFAR W_CLOSE
    xor a
    ld (WR_PEND),a
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; W3: Open and Save (13), through the FS_ calls (docs/FILES.md, src/apps/files.asm).

; wr_dlg: HL -> a dialog's variable, DE -> its table: IX = the dialog, made (wr_mkdlg) the first time.
wr_dlg:
    ld a,(hl)
    inc hl
    or (hl)
    jr z,.make
    ld a,(hl)
    dec hl
    ld l,(hl)
    ld h,a
    push hl
    pop ix
    ret
.make:
    push hl
    ex de,hl
    call wr_mkdlg
    pop hl
    push ix
    pop de
    ld (hl),d
    dec hl
    ld (hl),e
    ret

; wr_mkdlg: HL -> a table: a Dialog made, its views made and added; IX = the Dialog.  The table: the Dialog's x (DW), y, w (DW),
; h, flags, id (the View fields at 8-15, in order); then each view: its class (DW; 0 ends the table), those 8 bytes, a role
; (bit 0 the default, bit 1 the cancel, bit 2 a Field: cap 30, kept in WR_SFLD) and the word at offset 16 (a Label's or
; Button's text, a Field's buffer).
wr_mkdlg:
    push hl
    ld hl,CL_Dialog
    call K_NEW
    pop hl
    ld (WR_CDLG),ix
    call .rect
.view:
    ld e,(hl)
    inc hl
    ld d,(hl)
    inc hl
    ld a,d
    or e
    jr z,.end
    push hl
    ex de,hl
    call K_NEW
    pop hl
    call .rect
    ld c,(hl)                   ; the role
    inc hl
    ld a,(hl)
    ld (ix+16),a
    inc hl
    ld a,(hl)
    ld (ix+17),a
    inc hl
    push hl
    bit 2,c
    jr z,.nf
    ld (ix+Field_cap),30
    ld (WR_SFLD),ix
.nf:
    push ix
    pop de
    ld ix,(WR_CDLG)
    bit 0,c
    jr z,.nd
    ld (ix+Dialog_default),e
    ld (ix+Dialog_default+1),d
.nd:
    bit 1,c
    jr z,.nc
    ld (ix+Dialog_cancel),e
    ld (ix+Dialog_cancel+1),d
.nc:
    KFAR K_ADDCHILD
    pop hl
    jr .view
.end:
    ld ix,(WR_CDLG)
    ret
.rect:                          ; 8 bytes from HL to IX + 8; HL past them
    push ix
    pop de
    ld a,8
    add a,e
    ld e,a
    adc a,d
    sub e
    ld d,a
    ld bc,8
    ldir
    ret

; wr_setname: HL -> a name (a length byte, 1-30 codes): the document's name; the title "Write: " and the name; the title row
; made dirty (W_INVAL: the window manager redraws it).  wr_nm: the name and the title only.
wr_setname:
    call wr_nm
    ld hl,16
    ld (GA),hl
    ld (GA+2),hl
    ld hl,480
    ld (GA+4),hl
    ld hl,8
    ld (GA+6),hl
    KFAR W_INVAL
    ret

wr_nm:
    ld de,WR_NAME
    ld bc,31
    ldir
    ld hl,WR_STW
    ld de,WR_TITLE
    ld c,8
    ldir
    ld hl,WR_NAME
    ld a,(hl)
    ld c,a
    add a,7
    ld (WR_TITLE),a
    inc hl
    ldir                        ; (B = 0; C >= 1)
    ret

; wr_alert: HL = a message (in the image): the alert (13.4), made once, opened.
wr_alert:
    push hl
    ld hl,WR_ADLG
    ld de,WR_TALR
    call wr_dlg
    pop de
    ld l,(ix+View_child)        ; its Label
    ld h,(ix+View_child+1)
    ld bc,Label_text
    add hl,bc
    ld (hl),e
    inc hl
    ld (hl),d
    KFAR W_OPEN
    ld a,2
    ld (WR_DK),a
    ret

; wr_sopen: "Save...": the Save dialog (13.2), made once, its Field holding the name, opened, the Field focused.
wr_sopen:
    ld hl,WR_SDLG
    ld de,WR_TSAV
    call wr_dlg
    push ix
    ld ix,(WR_SFLD)
    ld hl,WR_NAME
    KFAR TK_SETTEXT             ; (the window is closed: nothing drawn)
    pop ix
    KFAR W_OPEN
    ld de,(WR_SFLD)
    KFAR K_SETFOCUS
    ld a,1
    ld (WR_DK),a
    ret

; wr_dkcmd: A = the dialog open (1 Save, 2 the alert): its E_CMD (K_EV + 1 = the id).  The dialog closes; Save (1: the
; button or ENTER in the Field) saves.
wr_dkcmd:
    ld b,a
    xor a
    ld (WR_DK),a
    ld ix,(WR_ADLG)
    djnz .close
    ld ix,(WR_SDLG)
    KFAR W_CLOSE
    ld a,(K_EV+1)
    dec a
    ret nz                      ; Cancel
    jr wr_save
.close:
    KFAR W_CLOSE
    ret

; wr_save: the Field's name (".txt" added when it has no "." and fits), the document written as text (13.2).
wr_save:
    ld hl,WR_FBUF
    ld a,(hl)
    or a
    ret z                       ; an empty name: nothing saved
    ld c,a
    ld b,a
.dot:
    inc hl
    ld a,(hl)
    cp '.'
    jr z,.named
    djnz .dot
    ld a,c
    cp 27
    jr nc,.named                ; ".txt" does not fit
    add a,4
    ld (WR_FBUF),a
    inc hl
    ex de,hl
    ld hl,WR_STXT
    ld bc,4
    ldir
.named:
    ld hl,WR_FBUF
    ld a,1                      ; write, text
    call FS_OPEN
    jp c,.fail
    ld bc,(WR_GS)               ; the codes before the gap, then after it
    ld a,b
    or c
    jr z,.after
    ld hl,(WR_BUF)
    call FS_WRITE
    jp c,.fail
.after:
    ld hl,WR_CAP
    ld de,(WR_GE)
    or a
    sbc hl,de
    ld b,h
    ld c,l
    ld a,b
    or c
    jr z,.close
    ld hl,(WR_GB)
    call FS_WRITE
    jp c,.fail
.close:
    call FS_CLOSE
    jp c,.fail
    xor a
    ld (WR_CHG),a
    ld hl,WR_FBUF
    jp wr_setname
.fail:
    ld hl,WR_SNSAV
    jp wr_alert

; wr_open: "Open..." once the discard dialog (if any) is passed (13.3): a file picked, checked, read into the gap's top end and
; inserted as a paste into the emptied document (the line count checked), the caret and top at 0.
wr_open:
    KFAR W_UPDATE               ; the menu or the dialog just closed is repainted before the wait
    ld hl,WR_PNAME
    call FS_PICK
    jr nc,.picked
    cp FS_CANCEL
    ret z
    jp .cant
.picked:
    ld hl,WR_PNAME
    xor a                       ; read, text
    call FS_OPEN
    jp c,.cant
    ld hl,WR_CAP
    or a
    sbc hl,bc
    jr nc,.fits
    call FS_CLOSE
    ld hl,WR_SLONG
    jp wr_alert
.fits:
    push hl                     ; CAP - n: where the codes go
    push bc
    call wr_empty
    pop bc
    pop de
    ld hl,(WR_BUF)
    add hl,de
    ex de,hl                    ; DE = BUF + CAP - n
    push de
    push bc
    ld a,b
    or c
    jr z,.read
    call FS_READ                ; BC = the codes read
    jp c,.rfail
    pop hl
    push hl
    or a
    sbc hl,bc
    jp nz,.rfail                ; fewer than the length given
.read:
    call FS_CLOSE
    pop bc
    pop hl
    ld a,b
    or c
    jr z,.shown                 ; an empty file
    push ix
    ld ix,(WR_WIN)              ; hidden while the codes go in: W_DRAWVIEW draws nothing inside it
    set 1,(ix+View_flags)
    ld a,1
    call wr_replace             ; A = 1: the lines counted
    ld ix,(WR_WIN)
    res 1,(ix+View_flags)
    pop ix                      ; (the carry kept)
    jp c,.lines
    ld hl,0
    call wr_moveto
    call wr_findcl
.shown:
    ld hl,0
    ld (WR_TOP),hl
    ld (WR_TS),hl
    ld (WR_AN),hl
    ld (WR_SA),hl
    ld (WR_SB),hl
    xor a
    ld (WR_CHG),a
    ld (WR_RUN),a
    ld (WR_MK),a
    ld hl,WR_PNAME
    call wr_setname
    ld hl,$FFFF
    ld (WR_BNL),hl              ; the bar set and drawn (the hidden replace set it unseen)
    call wr_bar
    xor a
    call wr_draw
    jp wr_menen
.rfail:
    pop bc
    pop de
    call wr_new
.cant:
    ld hl,WR_SNOPN
    jp wr_alert
.lines:
    call wr_new
    ld hl,WR_SLINES
    jp wr_alert

; The dialogs' tables (wr_mkdlg): the discard dialog (11.6), Save (13.2), the alert (13.4).
WR_TDIS:
    DW 128
    DB 64
    DW 256
    DB 64, 0, 0
    DW CL_Label, 144
    DB 76
    DW 200
    DB 9, 0, 0, 0
    DW WR_SASK
    DW CL_Button, 224
    DB 100
    DW 64
    DB 16, $11, 1, 1
    DW WR_SDISC
    DW CL_Button, 304
    DB 100
    DW 64
    DB 16, 1, 2, 2
    DW WR_SCANC
    DW 0
WR_TSAV:
    DW 128
    DB 56
    DW 256
    DB 80, 0, 0
    DW CL_Label, 144
    DB 68
    DW 200
    DB 9, 0, 0, 0
    DW WR_SSVAS
    DW CL_Field, 144
    DB 84
    DW 224
    DB 12, 1, 1, 4
    DW WR_FBUF
    DW CL_Button, 224
    DB 108
    DW 64
    DB 16, $11, 1, 1
    DW WR_SSAVE
    DW CL_Button, 304
    DB 108
    DW 64
    DB 16, 1, 2, 2
    DW WR_SCANC
    DW 0
WR_TALR:
    DW 128
    DB 64
    DW 256
    DB 64, 0, 0
    DW CL_Label, 144
    DB 76
    DW 224
    DB 18, 0, 0, 0              ; two lines (a message's 13)
    DW 0
    DW CL_Button, 304
    DB 100
    DW 64
    DB 16, $11, 1, 3
    DW WR_SOK
    DW 0
WR_STXT:    DB ".txt"
WR_STW:     DB 7, "Write: "

; ===========================================================================================================================
; The document.

; wr_empty: an empty document (one empty line), top 0, not changed.  Nothing drawn.
wr_empty:
    ld hl,0
    ld (WR_GS),hl
    ld (WR_AN),hl
    ld (WR_SA),hl
    ld (WR_SB),hl
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
    ld (WR_MK),a
    call wr_twclr
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
.fwd:                           ; t > top: TS plus the lengths of top .. t - 1 (HL = top - t)
    xor a
    sub l
    ld c,a
    sbc a,a
    sub h
    ld b,a                      ; BC = t - top
    ld hl,(WR_TOP)
    push de
    ld de,(WR_LT)
    add hl,de                   ; HL -> LT[top]
    pop de
.f:
    ld a,(hl)
    inc hl
    add a,e
    ld e,a
    jr nc,.nf
    inc d
.nf:
    dec bc
    ld a,b
    or c
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
; wr_twr: HL = an address, B = codes (> 0), DE = a width -> DE + their advances.  Clobbers AF, BC, HL (AF' kept).
wr_twr:
    ex af,af'
    push af
    ld a,b                      ; A' = the count; BC -> the advance of each code
    ld b,PROP6_W >> 8
.l:
    ld c,(hl)
    inc hl
    ex af,af'
    ld a,(bc)
    add a,e
    ld e,a
    jr nc,.n
    inc d
.n:
    ex af,af'
    dec a
    jr nz,.l
    pop af
    ex af,af'
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
; WR_DW: the edit's change of length (a word: +1 or -1 for a code, n - S for a replace, 12.4); WR_P: where it is.  Old lines that
; start inside a deleted range (WR_P, WR_OM) are passed.  The old lines from WR_K are read as the new ones are written; a slot is opened when
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
    jr c,.lo
    ld de,(WR_DW)
    add hl,de
    jr .m
.lo:                            ; before OM: unmapped; inside (P, OM): deleted, passed
    ld de,(WR_P)
    ex de,hl
    or a
    sbc hl,de                   ; P - os
    ex de,hl
    jr c,.pass
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
    ld hl,1
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
    ld hl,-1
.go:
    ld (WR_DW),hl
    call wr_gab
    call wr_ekp
; wr_ego: the edit made (text, gap, WR_P, WR_OM, WR_DW, K, KS): the lines rewrapped, the caret's line, top's start; the
; selection empty, mark 0 (12.2).  Carry clear.
wr_ego:
    call wr_twclr
    ld a,1
    ld (WR_CHG),a
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
    ld hl,(WR_GS)
    ld (WR_AN),hl
    xor a
    ld (WR_MK),a
    ret

; wr_ekp: K = KP - 1 (or 0), its start KS and length OLDK (top's start is still valid: lines before K do not change).
wr_ekp:
    ld hl,(WR_KP)
    ld a,h
    or l
    jr z,.k
    dec hl
.k:
    ld (WR_K),hl
    call wr_lstart
    ld (WR_KS),hl
    ld hl,(WR_K)
    call wr_lt
    ld (WR_OLDK),a
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
.show:                          ; the caret's line outside the rows drawn (a replace, 12.4): wr_shown draws the caret
    ld a,(WR_DRAWN)
    or a
    jp z,wr_shown
    ld hl,(WR_CL)
    call wr_jof
    jp c,wr_shown
    ld hl,WR_MJ
    cp (hl)
    jr c,.nd
    ld b,a
    ld a,(WR_DRAWN)
    cp WM_FROM
    ld a,b
    jr z,.f1
    ld hl,WR_MJ2
.f1:
    cp (hl)
    jr z,.sh
    jp c,wr_shown
.nd:
    xor a
    ld (WR_DRAWN),a
.sh:
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
    ld hl,(WR_AN)               ; a selection: no caret (12.3)
    ld de,(WR_GS)
    sbc hl,de                   ; (carry clear: A was not 0)
    jr z,.cl
    xor a
    ld (WR_NCV),a
    ret
.cl:
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
; The selection and the clipboard (W2, 12).

; wr_sel: HL = the selection's start, DE = its end; Z when it is empty (then both are the caret).  Clobbers F.
wr_sel:
    ld hl,(WR_AN)
    ld de,(WR_GS)
    or a
    sbc hl,de
    add hl,de
    ret z
    ret c                       ; anchor < caret
    ex de,hl
    ret

; wr_ord: HL = min(HL, DE), DE = the other.  wr_max: HL = max(HL, DE).  Clobber AF (wr_max: and DE).
wr_ord:
    ld a,l
    sub e
    ld a,h
    sbc a,d
    ret c
    ex de,hl
    ret
wr_max:
    ld a,l
    sub e
    ld a,h
    sbc a,d
    ret nc
    ex de,hl
    ret

; wr_menen: Cut and Copy enabled when 1 <= S <= 2,048, Paste when the clipboard holds a code (12.4); MB_ENABLE only for the
; bits that changed (WR_EN: bit 0 Cut and Copy, bit 1 Paste).  Clobbers AF, BC, DE, HL.
wr_menen:
    call wr_sel
    ld c,0
    jr z,.p
    ex de,hl
    or a
    sbc hl,de                   ; S
    ld de,WR_CLMAX + 1
    sbc hl,de
    jr nc,.p
    inc c
.p:
    ld hl,(WR_CLN)
    ld a,h
    or l
    jr z,.c
    set 1,c
.c:
    ld a,(WR_EN)
    xor c
    ret z
    ld b,a                      ; the bits that changed
    ld a,c
    ld (WR_EN),a
    bit 0,b
    jr z,.p2
    push bc
    ld a,c
    and 1
    ld b,a
    ld c,0                      ; Cut
    ld a,1                      ; "Edit" is the second menu
    call MB_ENABLE
    ld c,1                      ; Copy
    ld a,1
    call MB_ENABLE
    pop bc
.p2:
    bit 1,b
    ret z
    ld a,c
    rra
    and 1
    ld b,a
    ld c,2                      ; Paste
    ld a,1
    jp MB_ENABLE

; wr_copy: the clipboard = the selection's codes: one run, since the gap is at one of its ends.  Carry (nothing copied) when it
; is empty or longer than 2,048.  Clobbers AF, BC, DE, HL.
wr_copy:
    call wr_sel
    scf
    ret z
    push hl
    ex de,hl
    or a
    sbc hl,de                   ; S
    ld b,h
    ld c,l
    ld de,WR_CLMAX + 1
    or a
    sbc hl,de
    pop hl
    ccf
    ret c
    ld (WR_CLN),bc
    call wr_ptr                 ; its first code
    ld de,WR_CLIP
    KFAR K_LDIR
    or a
    ret

; wr_seldraw: the change of the selection drawn (12.3): the lines shown whose selected part differs between the one drawn
; [WR_SA, WR_SB) and the new one (the "selection" mode; the caret mode when there are none).  It is then the one drawn, and the
; "Edit" menu follows it.  Clobbers AF, BC, DE, HL.
wr_seldraw:
    call wr_sel
    ld (WR_XA),hl
    ld (WR_XB),de
    ld hl,(WR_SB)
    ld de,(WR_SA)
    or a
    sbc hl,de
    jr nz,.old
    ld hl,(WR_XA)               ; none drawn: the new one's lines
    ld de,(WR_XB)
    jr .one
.old:
    ld hl,(WR_XA)
    ld de,(WR_XB)
    or a
    sbc hl,de
    jr nz,.both
    ld hl,(WR_SA)               ; the new one is empty: the old one's lines
    ld de,(WR_SB)
.one:
    ld (WR_D1A),hl
    ld (WR_D1B),de
    ld hl,0
    ld (WR_D2A),hl
    ld (WR_D2B),hl
    jr .mask
.both:                          ; both: the codes between the starts and between the ends
    ld hl,(WR_SA)
    ld de,(WR_XA)
    call wr_ord
    ld (WR_D1A),hl
    ld (WR_D1B),de
    ld hl,(WR_SB)
    ld de,(WR_XB)
    call wr_ord
    ld (WR_D2A),hl
    ld (WR_D2B),de
.mask:                          ; WR_SM: the lines shown that meet either range
    ld hl,0
    ld (WR_SM),hl
    ld hl,(WR_D1B)              ; WR_XE: past both ranges no line can meet them
    ld de,(WR_D2B)
    call wr_max
    ld (WR_XE),hl
    ld hl,$FFFF                 ; WR_XS: the first code of either (a range that is empty does not count)
    ld de,(WR_D1A)
    ld bc,(WR_D1B)
    call .lo
    ld de,(WR_D2A)
    ld bc,(WR_D2B)
    call .lo
    ld (WR_XS),hl
    ld hl,(WR_NL)               ; B = the lines shown: min(16, NL - top)
    ld de,(WR_TOP)
    or a
    sbc hl,de
    ld b,TV_N
    ld a,h
    or a
    jr nz,.b
    ld a,l
    cp b
    jr nc,.b
    ld b,a
.b:
    ld hl,(WR_LT)
    add hl,de                   ; HL -> LT[top]
    ld de,(WR_TS)
    ld c,0
.sk:                            ; lines that end at or before XS are passed quickly
    push de
    ld a,(hl)
    add a,e
    ld e,a
    jr nc,.s1
    inc d
.s1:
    push hl
    ld hl,(WR_XS)
    or a
    sbc hl,de
    pop hl
    jr c,.stop
    pop af
    inc hl
    inc c
    djnz .sk
    jp .draw                    ; no line shown meets them
.stop:
    pop de
    ld (WR_RS),de
    ld hl,(WR_TOP)
    ld b,0
    add hl,bc
    ld (WR_RT),hl
    ld hl,1
    inc c
    jr .sh0
.shl:
    add hl,hl
.sh0:
    dec c
    jr nz,.shl
    ld (WR_BIT),hl
.l:
    ld hl,(WR_RS)
    ld de,(WR_XE)
    or a
    sbc hl,de
    jr nc,.draw
    ld hl,(WR_RT)
    ld de,(WR_NL)
    or a
    sbc hl,de
    jr nc,.draw
    add hl,de
    call wr_lt
    ld hl,(WR_RS)
    ld e,a
    ld d,0
    add hl,de
    ld (WR_RE),hl
    ld hl,(WR_D1A)
    ld de,(WR_D1B)
    call wr_meet
    jr c,.hit
    ld hl,(WR_D2A)
    ld de,(WR_D2B)
    call wr_meet
    jr nc,.next
.hit:
    ld hl,(WR_SM)
    ld a,h
    or l
    jr nz,.h1
    ld hl,(WR_RT)               ; the first line met: where wr_seldelta starts
    ld (WR_FT),hl
    ld hl,(WR_RS)
    ld (WR_FS),hl
    ld hl,(WR_SM)
.h1:
    ld de,(WR_BIT)
    ld a,l
    or e
    ld l,a
    ld a,h
    or d
    ld h,a
    ld (WR_SM),hl
.next:
    ld hl,(WR_RE)
    ld (WR_RS),hl
    ld hl,(WR_RT)
    inc hl
    ld (WR_RT),hl
    ld hl,(WR_BIT)
    add hl,hl
    ld (WR_BIT),hl
    jr nc,.l                    ; 16 lines
.draw:
    ld hl,(WR_SM)
    ld a,h
    or l
    ld a,WM_CARET
    jr z,.d
    ld a,WM_SEL
.d:
    call wr_draw
    call wr_sel
    ld (WR_SA),hl
    ld (WR_SB),de
    jp wr_menen
.lo:                            ; HL = min(HL, DE) when DE < BC
    ld a,e
    sub c
    ld a,d
    sbc a,b
    ret nc
    jp wr_ord

; wr_meet: HL = x, DE = y: carry when [x, y) meets the line [WR_RS, WR_RE).  Clobbers AF, BC, HL.
wr_meet:
    push hl
    or a
    sbc hl,de
    pop hl
    ret nc                      ; empty
    ld bc,(WR_RE)
    or a
    sbc hl,bc
    ret nc                      ; x >= the line's end
    ld hl,(WR_RS)
    or a
    sbc hl,de                   ; carry: the line's start < y
    ret

; wr_seldelta: (in tv_draw) each line of WR_SM: the difference between its old part and its new one, XOR filled: the two
; strips between the old and new starts and between the old and new ends (12.3).
wr_seldelta:
    ld a,2                      ; XOR
    ld (GOP),a
    ld hl,(WR_FT)               ; from the first line met (wr_seldraw)
    ld (WR_RT),hl
    ld de,(WR_TOP)
    or a
    sbc hl,de
    ld a,l                      ; its shown index
    ld b,l
    inc b
    call wr_jy
    ld a,l
    ld (WR_RY),a
    ld hl,(WR_FS)
    ld (WR_RS),hl
    ld hl,(WR_SM)
    jr .f0
.f1:
    srl h
    rr l
.f0:
    djnz .f1
.j:
    ld a,h
    or l
    ret z
    srl h
    rr l
    push hl
    jr nc,.next
    ld hl,(WR_SA)               ; the old part: OX0, OX1 (OX0 = OX1: none)
    ld de,(WR_SB)
    ld (WR_XA),hl
    ld (WR_XB),de
    ld bc,0
    ld (WR_OX0),bc
    ld (WR_OX1),bc
    or a
    sbc hl,de
    jr z,.nold
    call wr_selx
    jr c,.nold
    ld (WR_OX0),hl
    ld (WR_OX1),de
.nold:
    call wr_sel                 ; the new part
    jr z,.onlyo
    ld (WR_XA),hl
    ld (WR_XB),de
    call wr_selx
    jr c,.onlyo
    ld bc,(WR_OX0)              ; both: [min x0, max x0) and [min x1, max x1)
    push de
    ld d,b
    ld e,c
    call .pair
    pop hl
    ld de,(WR_OX1)
    call .pair
    jr .next
.onlyo:                         ; the old part only (or the new only, when the old has none)
    ld hl,(WR_OX0)
    ld de,(WR_OX1)
    call wr_fillx
.next:
    ld hl,(WR_RT)
    push hl
    call wr_lt
    ld hl,(WR_RS)
    ld e,a
    ld d,0
    add hl,de
    ld (WR_RS),hl
    pop hl
    inc hl
    ld (WR_RT),hl
    ld a,(WR_RY)
    add a,9
    ld (WR_RY),a
    pop hl
    jp .j
.pair:                          ; HL, DE: the strip between them
    call wr_ord
; wr_fillx: HL = x0, DE = x1: XOR fill (x0, WR_RY, x1 - x0, 9) when x1 > x0 (GOP is XOR).  Clobbers AF, DE, HL.
wr_fillx:
    ex de,hl
    or a
    sbc hl,de
    ret z
    ret c
    ld (GA+4),hl
    ld (GA),de
    ld a,(WR_RY)
    ld l,a
    ld h,0
    ld (GA+2),hl
    ld l,9
    ld (GA+6),hl
    KFAR G_FILL
    ret

; wr_selfill: line WR_RT (start WR_RS, band at y WR_RY): its part of [WR_XA, WR_XB) as an XOR fill (12.3); nothing when it has
; none.  Clobbers AF, BC, DE, HL.
wr_selfill:
    call wr_selx
    ret c
    ld a,2
    ld (GOP),a
    jr wr_fillx

; wr_selx: line WR_RT (start WR_RS): its part of [WR_XA, WR_XB) -> HL = x0, DE = x1 (12.3); carry when it has none.  Clobbers
; AF, BC.
wr_selx:
    ld hl,(WR_RT)
    call wr_lt
    ld hl,(WR_RS)
    ld e,a
    ld d,0
    add hl,de
    ld (WR_RE),hl               ; the line's end
    ex de,hl
    ld hl,(WR_XB)
    call wr_min
    ld (WR_RB),hl               ; b'
    ld hl,(WR_RS)
    ld de,(WR_XA)
    call wr_max                 ; a'
    ld (WR_RA),hl
    ld de,(WR_RB)
    or a
    sbc hl,de
    ccf
    ret c                       ; a' >= b'
    ld hl,(WR_RA)               ; x0 = min(26 + tw(s, a'), 471)
    call .tw
    ld hl,TV_X + 2
    add hl,de
    ld de,TV_CMAX
    call wr_min
    push hl
    ld hl,(WR_RB)               ; x1: 472 when b' is the line's end and another line follows
    ld de,(WR_RE)
    or a
    sbc hl,de
    jr nz,.x
    ld hl,(WR_RT)
    inc hl
    ld de,(WR_NL)
    or a
    sbc hl,de
    ld de,TV_X + TV_W
    jr c,.x1
.x:
    ld hl,(WR_RB)               ; else min(27 + tw(s, b'), 472)
    call .tw
    ld hl,TV_TX
    add hl,de
    ld de,TV_X + TV_W
    call wr_min
    ex de,hl
.x1:
    pop hl
    or a
    ret
.tw:                            ; HL = an offset in the line -> DE = tw(s, HL): a width kept, else summed and kept
    ld de,(WR_RS)
    or a
    sbc hl,de
    add hl,de
    ld de,0
    ret z                       ; the line's start: 0
    ld (WR_TWQ),hl
    ld hl,WR_TWC
    ld b,4
.c:
    ld a,(WR_TWQ)
    cp (hl)
    jr nz,.c1
    inc hl
    ld a,(WR_TWQ + 1)
    cp (hl)
    jr nz,.c2
    inc hl
    ld a,(WR_RS)
    cp (hl)
    jr nz,.c3
    inc hl
    ld a,(WR_RS + 1)
    cp (hl)
    jr nz,.c4
    inc hl
    ld e,(hl)
    inc hl
    ld d,(hl)
    ret
.c1:
    inc hl
.c2:
    inc hl
.c3:
    inc hl
.c4:
    inc hl
    inc hl
    inc hl
    djnz .c
    ld hl,(WR_TWQ)
    ld de,(WR_RS)
    or a
    sbc hl,de
    ld b,l
    ex de,hl
    call wr_tw
    ld hl,(WR_TWQ)
    ld bc,(WR_RS)
    jp wr_twput

; wr_replace: the selection [lo, hi) replaced by BC codes from HL (BC = 0: deleted; HL is read under K) as one edit (12.4): the
; caret after them, the view drawn, the "Edit" menu set.  A = 1: a paste, refused (carry, nothing changed) when the result would
; have more than 1,024 lines (counted first, 11.4).  Refused (carry) too when it would hold more than 5,120 codes.
wr_replace:
    ld (WR_RCK),a
    ld (WR_RSRC),hl
    ld (WR_RC),bc
    ld hl,(WR_GS)
    ld (WR_RCAR),hl
    call wr_sel
    ld (WR_LO),hl
    ld (WR_HI),de
    ex de,hl
    or a
    sbc hl,de
    ld (WR_RSN),hl              ; S
    call wr_len
    ld de,(WR_RSN)
    or a
    sbc hl,de
    ld de,(WR_RC)
    add hl,de                   ; L - S + n
    ld de,WR_CAP + 1
    or a
    sbc hl,de
    ccf
    ret c
    ld hl,(WR_LO)               ; the gap to lo: the selection is after it
    call wr_moveto
    call wr_findcl
    ld hl,(WR_CL)
    ld (WR_KP),hl
    call wr_ekp
    ld hl,(WR_LO)
    ld (WR_P),hl
    ld hl,(WR_HI)
    ld (WR_OM),hl
    ld hl,(WR_RC)
    ld de,(WR_RSN)
    or a
    sbc hl,de
    ld (WR_DW),hl               ; n - S
    ld hl,(WR_GE)
    ld (WR_RGE),hl
    ld hl,0
    ld (WR_RSV),hl
    ld bc,(WR_RC)
    ld a,b
    or c
    jr z,.del
    ld a,(WR_RCK)               ; a paste: the codes the insert writes over (n - G of the selection's first) are kept
    or a
    jr z,.ins
    ld hl,(WR_GE)
    ld de,(WR_GS)
    or a
    sbc hl,de                   ; G
    sbc hl,bc                   ; G - n
    jr nc,.ins
    ex de,hl
    ld hl,0
    or a
    sbc hl,de                   ; n - G
    ld (WR_RSV),hl
    ld b,h
    ld c,l
    ld hl,(WR_GB)
    ld de,WR_SCR
    KFAR K_LDIR
.ins:
    ld hl,(WR_RSRC)             ; n codes at the gap's start
    ld de,(WR_GA)
    ld bc,(WR_RC)
    KFAR K_LDIR
    ld hl,(WR_GS)
    ld de,(WR_RC)
    add hl,de
    ld (WR_GS),hl
.del:
    ld hl,(WR_GE)               ; S codes after the gap removed
    ld de,(WR_RSN)
    add hl,de
    ld (WR_GE),hl
    call wr_gab
    ld a,(WR_RCK)
    or a
    jr z,.go
    call wr_count
    jr nc,.go
    ld hl,(WR_GS)               ; refused: the text, the gap and the caret as they were
    ld de,(WR_RC)
    or a
    sbc hl,de
    ld (WR_GS),hl
    ld hl,(WR_RGE)
    ld (WR_GE),hl
    call wr_gab
    ld bc,(WR_RSV)
    ld a,b
    or c
    jr z,.back
    ld hl,WR_SCR
    ld de,(WR_GB)
    KFAR K_LDIR
.back:
    ld hl,(WR_RCAR)
    call wr_moveto
    call wr_findcl
    scf
    ret
.go:
    call wr_ego
    ld hl,(WR_GS)               ; nothing is selected now: its lines are among those drawn
    ld (WR_SA),hl
    ld (WR_SB),hl
    ld hl,(WR_CL)               ; top by "Shown" (11.5): unchanged, the changed lines; else a full draw at the new top
    ld de,(WR_TOP)
    or a
    sbc hl,de
    jr c,.above
    ld de,TV_N
    sbc hl,de
    jr nc,.below
    call wr_edraw
    jr .done
.below:
    ld hl,(WR_CL)
    ld de,TV_N - 1
    sbc hl,de
    jr .top
.above:
    ld hl,(WR_CL)
.top:
    push hl
    ld hl,(WR_K)                ; walked from K (lines from min(K, the new top) are valid)
    ld (WR_TOP),hl
    ld hl,(WR_KS)
    ld (WR_TS),hl
    pop hl
    push hl
    call wr_lstart
    ld (WR_TS),hl
    pop hl
    ld (WR_TOP),hl
    xor a
    call wr_draw
    call wr_bar
.done:
    call wr_menen
    or a
    ret

; wr_count: carry when the text has more than 1,024 lines, counted from line K (start KS) by 11.4.  Clobbers AF, BC, DE, HL.
wr_count:
    ld hl,(WR_K)
    ld (WR_W),hl
    ld hl,(WR_KS)
.l:
    ld (WR_NS),hl
    call wr_line                ; C = the line's length
    ld hl,(WR_W)
    inc hl
    ld (WR_W),hl
    ld de,WR_MAXL + 1
    or a
    sbc hl,de
    ccf
    ret c
    ld hl,(WR_NS)
    ld b,0
    add hl,bc
    ld (WR_NS),hl
    call wr_len
    ld de,(WR_NS)
    or a
    sbc hl,de
    ex de,hl
    jr nz,.l
    ld a,c
    or a
    ret z                       ; an empty last line
    dec hl
    call wr_ptr
    ld a,(hl)
    cp 13
    ld hl,(WR_NS)
    jr z,.l                     ; an empty line follows the final 13
    or a
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
    dec a
    jr nz,.sel
    call wr_scroll
    jr .newc
.sel:
    call wr_seldelta
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
    ld (WR_RT),de
    push bc
    push de
    ex de,hl
    call wr_lstart
    ld (WR_RS),hl
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
    ld a,l
    ld (WR_RY),a
    ld hl,TV_TX
    ld (GA),hl
    xor a
    KFAR G_SETOP
    pop bc
    pop hl
    call wr_text
    call wr_sel                 ; the line's selected part (12.3)
    ret z
    ld (WR_XA),hl
    ld (WR_XB),de
    jp wr_selfill
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
    push ix                     ; a drag: the text view has the capture
    pop hl
    ld a,(K_CAPTURE)
    cp l
    jr nz,.no
    ld a,(K_CAPTURE+1)
    cp h
    ld d,1
    jp z,.pt
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
    cp MARK
    jr z,.mark
    cp KC_ENTER
    jr z,.ins
    cp 32
    jr c,.no
    cp 127
    jr nc,.no
.ins:
    push af
    call wr_sel
    jr nz,.rsel
    pop af
.w1:
    call wr_edit
    jr c,.cons
    call wr_edraw
    jr .cons
.del:
    xor a
    jr .ins
.rsel:                          ; a selection (12.4): DELETE removes it; a code replaces it (at 1,024 lines: removed, then W1's rule)
    pop af
    ld (WR_C),a
    ld bc,0
    or a
    jr z,.rdel
    ld hl,(WR_NL)
    ld de,WR_MAXL
    sbc hl,de
    jr nc,.r2
    ld hl,WR_C
    inc c
.rdel:
    xor a
    call wr_replace
    jr .cons
.r2:
    xor a
    call wr_replace
    ld a,(WR_C)
    jr .w1
.mark:                          ; MARK (12.4): on, the anchor kept; off, the selection cleared
    ld hl,WR_MK
    ld a,(hl)
    xor 1
    ld (hl),a
    jr nz,.cons
    ld hl,(WR_GS)
    ld (WR_AN),hl
    call wr_seldraw
    jr .cons
.left:
    call .col
    jr nz,.goto                 ; mark 0 and a selection: its start
    ld hl,(WR_GS)
    ld a,h
    or l
    jp z,.cons
    dec hl
    jr .goto
.right:
    call .col
    ex de,hl
    jr nz,.goto                 ; its end
    call wr_len
    ld de,(WR_GS)
    or a
    sbc hl,de
    jp z,.cons
    ex de,hl
    inc hl
.goto:                          ; the caret to HL; the anchor follows unless the mark is on; the view follows
    call wr_moveto
    call wr_findcl
    ld a,(WR_MK)
    or a
    jr nz,.ext
    ld hl,(WR_GS)
    ld (WR_AN),hl
    ld hl,(WR_SA)               ; a selection was drawn: cleared
    ld de,(WR_SB)
    or a
    sbc hl,de
    call nz,wr_seldraw
    call wr_shown
    jp .cons
.ext:                           ; the anchor stays
    call wr_seldraw
    call wr_shown
    jp .cons
.col:                           ; NZ when the mark is off and there is a selection: HL = its start, DE = its end
    ld a,(WR_MK)
    or a
    jp z,wr_sel
    xor a
    ret
.cto:                           ; the caret to HL, nothing drawn
    call wr_moveto
    jp wr_findcl
.up:
    call .col
    call nz,.cto                ; mark 0 and a selection: from its start
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
    call .col
    ex de,hl
    call nz,.cto                ; from its end
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
.down:                          ; a press: the line, then the position (11.5); the anchor by the mark (12.4)
    xor a
    ld (WR_RUN),a
    ld d,a
.pt:                            ; D = 1 a drag: the line clamped to the lines shown; the anchor stays
    ld a,d
    push af
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
    ld a,c
    cp TV_N
    jr c,.dy1
    ld c,TV_N - 1
.dy1:
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
    pop af
    or a
    jp z,.goto
    call wr_moveto
    call wr_findcl
    jp .ext
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
    ld de,(WR_PS)
    or a
    sbc hl,de
    ld a,l                      ; n: the positions to step over (0..255)
    ld (WR_PN),a
    ex de,hl
    call wr_ptr                 ; HL = PS's address
    pop de                      ; r
    ld (WR_PR0),de
    ld c,0                      ; C = the steps left
    ld a,(WR_PN)
    or a
    jr z,.pos
    push ix
    ex af,af'
    push af
    ld a,(WR_PN)
    ex af,af'                   ; A' = the steps left
    push hl                     ; IXL = the codes before the gap's start (0: none ahead within 255)
    ld bc,(WR_GA)
    or a
    sbc hl,bc
    ld a,0
    jr nc,.g0
    ld a,h
    inc a
    ld a,0
    jr nz,.g0
    sub l
.g0:
    ld ixl,a
    pop hl
    ld b,PROP6_W >> 8
.l:
    bit 7,d
    jr nz,.stop                 ; r < 0
    ld c,(hl)
    ld a,(bc)
    srl a
    inc d
    dec d
    jr nz,.ge
    cp e
    jr z,.ge
    jr nc,.stop                 ; r < floor(a / 2): here
.ge:
    ld a,(bc)                   ; r - a
    neg
    add a,e
    ld e,a
    jr c,.nb
    dec d
.nb:
    inc hl
    dec ixl
    jr nz,.g1
    ld hl,(WR_GB)
.g1:
    ex af,af'
    dec a
    jr z,.endx
    ex af,af'
    jr .l
.stop:
    ex af,af'
    ld c,a
    jr .x
.endx:
    ld c,a
.x:
    pop af
    ex af,af'
    pop ix
.pos:
    ld b,0
    ld hl,(WR_PE)
    or a
    sbc hl,bc                   ; the position: PE less the steps left
    push hl
    ld hl,(WR_PR0)              ; its width from the line's start, r0 - r: kept for the selection (12.3)
    or a
    sbc hl,de
    ex de,hl
    pop hl
    push hl
    ld bc,(WR_PS)
    call wr_twput
    pop hl
    ret

; wr_twput: HL = an offset, BC = its line's start, DE = their width: kept (4 kept, the oldest replaced).  Clobbers AF, HL.
wr_twput:
    push hl
    ld a,(WR_TWI)
    inc a
    and 3
    ld (WR_TWI),a
    ld l,a
    add a,a
    add a,l
    add a,a                     ; 6 i
    ld l,a
    ld h,0
    push bc
    ld bc,WR_TWC
    add hl,bc
    pop bc
    ex (sp),hl                  ; HL = the offset, (SP) -> the entry
    push de
    ex de,hl                    ; DE = the offset
    pop hl                      ; HL = the width
    ex (sp),hl                  ; HL -> the entry, (SP) = the width
    ld (hl),e
    inc hl
    ld (hl),d
    inc hl
    ld (hl),c
    inc hl
    ld (hl),b
    inc hl
    pop de
    ld (hl),e
    inc hl
    ld (hl),d
    ret
; wr_twclr: no width kept (an edit changed the text).  Clobbers AF.
wr_twclr:
    ld a,$FF                    ; an offset's high byte is never $FF
    ld (WR_TWC + 1),a
    ld (WR_TWC + 7),a
    ld (WR_TWC + 13),a
    ld (WR_TWC + 19),a
    ret

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
    cp WM_SEL
    jr z,.sel
    cp WM_LINES
    jp nz,.whole
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
    jr .narrow
.sel:                           ; the lines of the mask (C first, E last) and the carets: their rows
    ld hl,(WR_SM)
    ld c,-1
.s0:
    inc c
    srl h
    rr l
    jr nc,.s0
    ld b,c
    ld e,c
.s1:
    ld a,h
    or l
    jr z,.s2
    inc b
    srl h
    rr l
    jr nc,.s1
    ld e,b
    jr .s1
.s2:
    ld a,c
    call wr_jy
    ld c,l
    ld a,e
    call wr_jy
    ld e,l
    ld a,(WR_OCV)
    or a
    ld a,(WR_OCY)
    call nz,.mm
    ld a,(WR_NCV)
    or a
    ld a,(WR_NCY)
    call nz,.mm
    jr .cy
.mm:
    cp c
    jr nc,.m1
    ld c,a
.m1:
    cp e
    ret c
    ld e,a
    ret
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
WR_SUNT:    DB 8, "Untitled"
WR_SSVAS:   DB 8, "Save as:"
WR_SSAVE:   DB 4, "Save"
WR_SOK:     DB 2, "OK"
WR_SNSAV:   DB 28, "The file could not be saved."
WR_SNOPN:   DB 29, "The file could not be opened."
WR_SLONG:   DB 50, "The file is too long for Write", 13, "(5,120 characters)."
WR_SLINES:  DB 46, "The file has too many lines for Write", 13, "(1,024)."
WR_SASK:    DB 21, "Discard the document?"
WR_SDISC:   DB 7, "Discard"
WR_SCANC:   DB 6, "Cancel"
WR_MENUS:
    DB 2
    DW WR_M1, WR_M2
WR_M1:
    DB 1, 4, "File", 3
    DB 1, 0, 3, "New"
    DB 2, 0, 7, "Open..."
    DB 3, 0, 7, "Save..."
WR_M2:                          ; 12.4: Cut, Copy, Paste disabled at the start
    DB 2, 4, "Edit", 5
    DB 1, 1, 3, "Cut"
    DB 2, 1, 4, "Copy"
    DB 3, 1, 5, "Paste"
    DB 0, 2, 0
    DB 4, 0, 10, "Select all"
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
WR_PEND:    DB 0                ; 1 quit, 2 New, 3 Open, waiting for the dialog
WR_SDLG:    DW 0                ; W3 (13): the Save dialog, the alert, the Field, the dialog being made
WR_ADLG:    DW 0
WR_SFLD:    DW 0
WR_CDLG:    DW 0
WR_DK:      DB 0                ; the dialog open: 0 none (or the discard dialog), 1 Save, 2 the alert
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
WR_DW:      DW 0
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
WR_AN:      DW 0                ; W2 (12): the anchor
WR_MK:      DB 0                ; the mark
WR_CLN:     DW 0                ; the clipboard's length
WR_EN:      DB 0                ; the "Edit" bits set: bit 0 Cut and Copy, bit 1 Paste
WR_SA:      DW 0                ; the selection drawn (empty when SA = SB)
WR_SB:      DW 0
WR_XA:      DW 0                ; the selection a fill is for
WR_XB:      DW 0
WR_D1A:     DW 0                ; the ranges whose lines a change of the selection redraws
WR_D1B:     DW 0
WR_D2A:     DW 0
WR_D2B:     DW 0
WR_SM:      DW 0                ; their lines shown, bit j = line top + j
WR_BIT:     DW 0
WR_RT:      DW 0                ; a line: its index, start, end, band's y; its selected part [RA, RB)
WR_RS:      DW 0
WR_RE:      DW 0
WR_RY:      DB 0
WR_RA:      DW 0
WR_RB:      DW 0
WR_OX0:     DW 0                ; a line's old part's x0, x1
WR_OX1:     DW 0
WR_TWC:     DS 24, $FF          ; 4 widths kept: offset, the line's start, tw (wr_twput)
WR_TWI:     DB 0
WR_TWQ:     DW 0
WR_PN:      DB 0                ; wr_pos: the positions to step over, r
WR_PR0:     DW 0
WR_XE:      DW 0
WR_XS:      DW 0
WR_FT:      DW 0                ; the first line the change meets, its start
WR_FS:      DW 0
WR_RCK:     DB 0                ; wr_replace: count the lines; the source, n, S, lo, hi, the caret, GE, the codes kept
WR_RSRC:    DW 0
WR_RC:      DW 0
WR_RSN:     DW 0
WR_LO:      DW 0
WR_HI:      DW 0
WR_RCAR:    DW 0
WR_RGE:     DW 0
WR_RSV:     DW 0
    ENT
WR_IMG_LEN  EQU $ - WR_IMG
; RAM after the image (below the arena, not copied: each is written before it is read).
WR_TITLE    EQU PROG_IMG + WR_IMG_LEN   ; "Write: " and the name: a length byte and up to 37 codes (13.1)
WR_NAME     EQU WR_TITLE + 38           ; the document's name: a length byte and up to 30 codes
WR_FBUF     EQU WR_NAME + 31            ; the Save dialog's Field
WR_PNAME    EQU WR_FBUF + 31            ; the picked name (FS_PICK)
    ASSERT WR_PNAME + 32 <= AARENA_BASE
    ASSERT WR_IMG_LEN <= 1024 && (CL_TextView >> 8) == ((CL_TextView + 11) >> 8)
    ASSERT WR_OCX + 3 == WR_OCV && WR_NCX + 3 == WR_NCV
WR_END:
