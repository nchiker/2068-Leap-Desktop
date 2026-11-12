; kern4demo.asm -- the proof-of-concept demo (docs/WINDOWS.md 11, 18.6): menus Leap / File / Window, the windows "Text" and
; "Buttons", the About dialog, the mouse on.  Included by kern4.asm with DEMO = 1 (build target kern4demo), in chunk 5.

D_COUNT     EQU $E0D0           ; word: clicks counted
D_CLICKS    EQU $E0D2           ; the counter label's string: length, "Clicks: nnnnn" (14 bytes)
D_TEXT      EQU $E0E0           ; word: the Text window (0 once closed)
D_BUTTONS   EQU $E0E2           ; word: the Buttons window
D_ABOUT     EQU $E0E4           ; word: the About dialog
D_LABEL     EQU $E0E6           ; word: the counter label
D_NEWN      EQU $E0E8           ; byte: windows made by "New window"
D_DIG       EQU $E0E9           ; byte: d_count has written a digit
D_BP        EQU $E0EA           ; word: d_build's list pointer
D_ROOT      EQU $E0EC           ; word: d_build's root
D_LAST      EQU $E0EE           ; word: d_build's last object
    ASSERT D_LAST + 1 < $E0FF

; D_MAIN: builds the desktop, then the event loop.
D_MAIN:
    ld hl,K_AARENA
    call K_ARENA
    ld hl,D_MENUS
    call MB_SET
    xor a
    ld (D_NEWN),a
    ld hl,0
    ld (D_COUNT),hl
    ld (D_ABOUT),hl
    call d_count
    ld hl,D_TWIN
    call d_build
    ld (D_TEXT),ix
    ld hl,D_BWIN
    call d_build
    ld (D_BUTTONS),ix
    ld hl,(D_LAST)                      ; the counter label is the list's last object
    ld (D_LABEL),hl
    ld ix,(D_TEXT)
    call W_OPEN
    ld ix,(D_BUTTONS)
    call W_OPEN
    ld a,1
    call K_MSET                         ; the Kempston mouse on (no mouse: the ports read $FF, nothing moves)
D_LOOP:
    call K_GETEV
    jr nc,.ev
    halt
    jr D_LOOP
.ev:
    cp E_MENU_T
    jr z,d_menu
    cp E_CMD
    jp z,d_cmd
    call K_DISPATCH
    jr D_LOOP

; d_menu: K_EV = E_MENU (menu id, item id).
d_menu:
    ld hl,(K_EV+1)                      ; L = menu, H = item
    ld a,l
    cp 1
    jr z,.about                         ; Leap: About
    cp 3
    jr z,.window
    ld a,h                              ; File
    cp 1
    jr z,.new
    cp 2
    jr nz,D_LOOP
    call W_FRONT                        ; Close window: the front one, destroyed
    ld a,h
    or l
    jr z,D_LOOP
    push hl
    pop ix
    ld a,M_DESTROY
    rst $08
    call d_forget
    jr D_LOOP
.about:
    call d_about
    jr D_LOOP
.window:                                ; Window: Text (1) or Buttons (2) to the front
    ld ix,(D_TEXT)
    ld a,h
    cp 1
    jr z,.raise
    ld ix,(D_BUTTONS)
.raise:
    ld a,ixh
    or ixl
    jr z,D_LOOP
    call W_RAISE
    jr D_LOOP
.new:
    ld a,(D_NEWN)
    cp 6
    jr nc,D_LOOP
    inc a
    ld (D_NEWN),a
    ld hl,D_NWIN
    call d_build
    ld a,(D_NEWN)                       ; staggered: (32 + 32 n, 24 + 16 n)
    add a,a
    add a,a
    add a,a
    add a,a
    ld e,a
    add a,24
    ld (ix+View_y),a
    ld l,e
    ld h,0
    add hl,hl
    ld de,32
    add hl,de
    ld (ix+View_x),l
    ld (ix+View_x+1),h
    call W_OPEN
    jp D_LOOP

; d_forget: IX = a destroyed window: D_TEXT / D_BUTTONS / D_ABOUT cleared when they were it.
d_forget:
    push ix
    pop de
    ld hl,D_TEXT
    call .one
    ld hl,D_BUTTONS
    call .one
    ld hl,D_ABOUT
.one:                                   ; HL -> a word: 0 when it equals DE
    ld a,(hl)
    cp e
    ret nz
    inc hl
    ld a,(hl)
    cp d
    ret nz
    xor a
    ld (hl),a
    dec hl
    ld (hl),a
    ret

; d_cmd: K_EV = E_CMD (id, slot).
d_cmd:
    ld a,(K_EV+1)
    cp 1
    jr z,.count
    cp 2
    jr z,.reset
    cp 3
    jr z,.about
    cp 9
    jp nz,D_LOOP
    ld ix,(D_ABOUT)                     ; the dialog's OK
    ld a,ixh
    or ixl
    jp z,D_LOOP
    ld a,M_DESTROY
    rst $08
    call d_forget
    jp D_LOOP
.about:
    call d_about
    jp D_LOOP
.reset:
    ld hl,0
    jr .set
.count:
    ld hl,(D_COUNT)
    inc hl
.set:
    ld (D_COUNT),hl
    call d_count
    ld ix,(D_LABEL)
    ld a,ixh
    or ixl
    call nz,W_DRAWVIEW
    jp D_LOOP

; d_about: the About dialog, built and opened (nothing while a dialog is open).
d_about:
    ld hl,(W_MODAL)
    ld a,h
    or l
    ret nz
    ld hl,D_DLG
    call d_build
    ld (D_ABOUT),ix
    ld l,(ix+View_child)                ; its first child is the OK button: default and cancel
    ld h,(ix+View_child+1)
    ld (ix+Dialog_default),l
    ld (ix+Dialog_default+1),h
    ld (ix+Dialog_cancel),l
    ld (ix+Dialog_cancel+1),h
    jp W_OPEN

; d_count: D_CLICKS = "Clicks: " and D_COUNT in decimal, no leading zeros.
d_count:
    ld hl,D_SCLICK
    ld de,D_CLICKS + 1
    ld bc,8
    ldir                                ; DE -> where the digits go
    xor a
    ld (D_DIG),a
    ld hl,(D_COUNT)
    ld ix,D_TENS
.digit:
    ld c,(ix+0)
    ld b,(ix+1)
    ld a,b
    or c
    jr z,.end
    ld a,'0' - 1
.sub:
    inc a
    or a
    sbc hl,bc
    jr nc,.sub
    add hl,bc
    push af
    ld a,(D_DIG)
    or a
    jr nz,.put
    pop af
    push af
    cp '0'
    jr nz,.put
    dec bc                              ; a leading zero: dropped unless it is the units
    ld a,b
    or c
    jr nz,.skip
.put:
    pop af
    ld (de),a
    inc de
    ld a,1
    ld (D_DIG),a
    jr .nx
.skip:
    pop af
.nx:
    inc ix
    inc ix
    jr .digit
.end:
    ld a,e
    sub (D_CLICKS + 1) & $FF
    ld (D_CLICKS),a
    ret
D_TENS:
    DW 10000, 1000, 100, 10, 1, 0
D_SCLICK:
    DB "Clicks: "

; d_build: HL -> a build list -> IX = its root; D_LAST = the last object.  An entry: class (word; 0 ends the list), x (word),
; y, w (word), h, flags, id, the offset of the class's text field (0: none), the text (word), the parent (0: this is the
; root, 1: the root).
d_build:
    ld (D_BP),hl
.next:
    ld hl,(D_BP)
    ld e,(hl)
    inc hl
    ld d,(hl)
    inc hl
    ld a,d
    or e
    jr z,.done
    ld (D_BP),hl
    ex de,hl
    call K_NEW
    ld (D_LAST),ix
    ld hl,(D_BP)
    ld e,(hl)
    inc hl
    ld d,(hl)
    inc hl
    ld (ix+View_x),e
    ld (ix+View_x+1),d
    ld a,(hl)
    inc hl
    ld (ix+View_y),a
    ld e,(hl)
    inc hl
    ld d,(hl)
    inc hl
    ld (ix+View_w),e
    ld (ix+View_w+1),d
    ld a,(hl)
    inc hl
    ld (ix+View_h),a
    ld a,(hl)
    inc hl
    ld (ix+View_flags),a
    ld a,(hl)
    inc hl
    ld (ix+View_id),a
    ld c,(hl)                           ; the text field's offset
    inc hl
    ld e,(hl)
    inc hl
    ld d,(hl)
    inc hl
    ld a,(hl)                           ; the parent
    inc hl
    ld (D_BP),hl
    push af
    ld a,c
    or a
    jr z,.notext
    push ix
    pop hl
    ld b,0
    add hl,bc
    ld (hl),e
    inc hl
    ld (hl),d
.notext:
    pop af
    or a
    jr nz,.child
    ld (D_ROOT),ix
    jr .next
.child:
    push ix
    pop de
    ld ix,(D_ROOT)
    call K_ADDCHILD
    jr .next
.done:
    ld ix,(D_ROOT)
    ret

; Build lists (d_build).
D_TWIN:
    DW CL_Window, 16
    DB 24
    DW 288
    DB 104, 0, 1, Window_title
    DW D_STEXT
    DB 0
    DW CL_Label, 32
    DB 40
    DW 240
    DB 8, 8, 0, Label_text
    DW D_S8X8
    DB 1
    DW CL_Label, 32
    DB 56
    DW 256
    DB 48, 0, 0, Label_text
    DW D_SPROP
    DB 1
    DW 0
D_BWIN:
    DW CL_Window, 224
    DB 64
    DW 272
    DB 104, 0, 2, Window_title
    DW D_SBUTTONS
    DB 0
    DW CL_Button, 240
    DB 96
    DW 72
    DB 16, 1 | 16, 1, Button_text
    DW D_SCOUNT
    DB 1
    DW CL_Button, 328
    DB 96
    DW 72
    DB 16, 1, 2, Button_text
    DW D_SRESET
    DB 1
    DW CL_Button, 416
    DB 96
    DW 64
    DB 16, 1, 3, Button_text
    DW D_SABOUT
    DB 1
    DW CL_Label, 240
    DB 128
    DW 160
    DB 8, 0, 4, Label_text
    DW D_CLICKS
    DB 1
    DW 0
D_NWIN:
    DW CL_Window, 0
    DB 8
    DW 192
    DB 64, 0, 5, Window_title
    DW D_SNEW
    DB 0
    DW 0
D_DLG:
    DW CL_Dialog, 128
    DB 56
    DW 256
    DB 72, 0, 6, 0
    DW 0
    DB 0
    DW CL_Button, 288
    DB 104
    DW 64
    DB 16, 1 | 16, 9, Button_text
    DW T_SOK
    DB 1
    DW CL_Label, 152
    DB 70
    DW 208
    DB 8, 0, 0, Label_text
    DW D_SABOUT1
    DB 1
    DW CL_Label, 152
    DB 82
    DW 208
    DB 8, 0, 0, Label_text
    DW D_SABOUT2
    DB 1
    DW 0

D_MENUS:
    DB 3
    DW D_MLEAP, D_MFILE, D_MWIN
D_MLEAP:
    DB 1, 4, "Leap", 1
    DB 1, 0, 21, "About Leap Desktop..."
D_MFILE:
    DB 2, 4, "File", 4
    DB 1, 0, 10, "New window"
    DB 2, 0, 12, "Close window"
    DB 3, 2, 0
    DB 4, 1, 4, "Quit"
D_MWIN:
    DB 3, 6, "Window", 2
    DB 1, 0, 4, "Text"
    DB 2, 0, 7, "Buttons"

D_STEXT:    DB 4, "Text"
D_SBUTTONS: DB 7, "Buttons"
D_SNEW:     DB 10, "New window"
D_S8X8:     DB 23, "8X8 TEXT: 64 COLUMNS..."
D_SPROP:    DB 63, "Proportional text,", 13, "The quick brown fox jumps", 13, "over the lazy dog."
D_SCOUNT:   DB 5, "Count"
D_SRESET:   DB 5, "Reset"
D_SABOUT:   DB 5, "About"
D_SABOUT1:  DB 28, "Leap Desktop, roadmap step 4"
D_SABOUT2:  DB 24, "The first milestone, PoC"
