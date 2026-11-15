; shell.asm -- the shell, program 0 (docs/SHELL.md 4, 10.4): the "Leap Desktop" window of program icons and the "Leap" menu.
; Code in DOCK 2-3 (mapping A); its RAM image (the Icon class, strings, menu, icons, variables) is assembled for $C000.

ICON_X0     EQU 48
ICON_DX     EQU 64
S_WINID     EQU 255
S_SOFF:     DB "Sound Off"     ; the menu item's text while sound is on / off (the item shows the action)
S_SON:      DB "Sound On "

; S_START: the image, the menu, the window and its icons, then the event loop.  Never returns.
S_START:
    ld hl,S_IMG
    ld de,PROG_IMG
    ld bc,S_IMG_LEN
    ldir
    call AL_INIT
    ld hl,S_MENUS
    KFAR MB_SET
    ld hl,S_TWIN                ; the window (the library's view table, APPLIB 3)
    call AL_NEW
    ld (S_WIN),ix
    ld a,1                      ; the icons: programs 1 .. S_NICONS
.icon:
    ld (S_I),a
    ld hl,CL_Icon
    call K_NEW
    ld a,(S_I)
    ld (ix+Icon_prog),a
    dec a
    ld l,a                      ; x = 48 + 64 (prog - 1)
    ld h,0
    add hl,hl
    add hl,hl
    add hl,hl
    add hl,hl
    add hl,hl
    add hl,hl
    ld de,ICON_X0
    add hl,de
    ld (ix+View_x),l
    ld (ix+View_x+1),h
    ld (ix+View_y),40
    ld (ix+View_w),64
    ld (ix+View_h),26
    ld (ix+View_flags),1        ; focusable
    ld a,(S_I)                  ; the name: S_NAMES[prog - 1]
    dec a
    add a,a
    ld l,a
    ld h,0
    ld de,S_NAMES
    add hl,de
    ld a,(hl)
    ld (ix+Icon_name),a
    inc hl
    ld a,(hl)
    ld (ix+Icon_name+1),a
    ld hl,S_WIN
    call AL_ADD
    ld a,(S_I)
    inc a
    cp S_NICONS + 1
    jr c,.icon
    ld ix,(S_WIN)
    KFAR W_OPEN
    ld a,1
    ld (S_OPEN),a
    KFAR K_MSET
s_loop:
    call K_GETEV
    jr nc,.ev
    halt
    jr s_loop
.ev:
    cp E_MENU
    jr z,.menu
    cp E_CMD
    jr z,.cmd
    KFAR TK_DISPATCH
    jr s_loop
.menu:                          ; Leap (1): About (1), Calculator (3), Key Caps (4), Notepad (5), Paint (6)
    ld a,(K_EV+2)
    cp 1
    jr z,.about
    cp 7
    jr z,.show                  ; Show Desktop (SHELL 12)
    cp 8
    jr z,.snd                   ; Sound Off / Sound On (docs/SOUND.md 5)
    sub 2
    jr c,s_loop
    jr z,s_loop
    cp S_NICONS + 1
    jr nc,s_loop
    KFAR K_LAUNCH               ; item 3 -> program 1, item 4 -> program 2
.cmd:                           ; the About dialog's OK (id 1); the shell window's close box or SS+Q (S_WINID)
    ld a,(K_EV+1)
    cp S_WINID
    jr z,.close
    cp 1
    jr nz,s_loop
    ld ix,(S_ABOUT)
    KFAR W_CLOSE
    jr s_loop
.close:                         ; every window closes, the last one too (SHELL 12): the window kept, the desktop and the menu bar remain
    ld ix,(S_WIN)
    KFAR W_CLOSE
    xor a
    ld (S_OPEN),a
    jr s_loop
.show:                          ; Show Desktop: the window opened again, or raised when it is open
    ld ix,(S_WIN)
    ld a,(S_OPEN)
    or a
    jr nz,.raise
    KFAR W_OPEN
    ld a,1
    ld (S_OPEN),a
    jr s_loop
.raise:
    KFAR W_RAISE
    jr s_loop
.snd:                           ; the sound toggled; the item shows the other state
    ld a,(K_SOUND)
    xor 1
    KFAR K_SNDSET
    ld hl,S_SOFF
    ld a,(K_SOUND)
    or a
    jr nz,.st
    ld hl,S_SON
.st:
    ld de,S_SNDTXT
    ld bc,9
    ldir
    jp s_loop
.about:                         ; the library's alert (APPLIB 5)
    ld hl,S_ABOUT
    ld de,S_ABOUTT
    call AL_ALERT
    jp s_loop

S_TWIN:                         ; the shell's window (SHELL 4, 12): an APPLIB 3 entry; a CWindow: its close box and SS+Q post E_CMD S_WINID
    DW CL_CWindow, 32
    DB 24
    DW 320                      ; four icons at x = 48 + 64 (p - 1): Paint is the fourth (docs/PAINT.md 10)
    DB 80, 0, S_WINID, 8
    DW S_TITLE

; ---------------------------------------------------------------------------------------------------------------------------
; Icon's methods (banked).  ic_draw (10.4, 10.5): paper, the bitmap (G_ICON: x + 16 is on the byte grid), the name centred
; below, inverted when focused.
ic_draw:
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    ld (GA),hl
    ld l,(ix+View_y)
    ld h,0
    ld (GA+2),hl
    ld l,(ix+View_w)
    ld (GA+4),hl
    ld l,(ix+View_h)
    ld (GA+6),hl
    ld a,1
    KFAR G_SETOP
    KFAR G_FILL
    ld l,(ix+View_x)            ; the bitmap at (x + 16, y), 32 x 16
    ld h,(ix+View_x+1)
    ld de,16
    add hl,de
    ld (GA),hl
    ld hl,32
    ld (GA+4),hl
    ld hl,16
    ld (GA+6),hl
    ld a,(ix+Icon_prog)
    dec a
    add a,a
    ld l,a
    ld h,0
    ld de,S_SETS
    add hl,de
    ld a,(hl)
    inc hl
    ld h,(hl)
    ld l,a
    ld (GA+8),hl
    KFAR G_ICON
    ld l,(ix+Icon_name)         ; the name
    ld h,(ix+Icon_name+1)
    ld a,(hl)
    inc hl
    ld (GA+4),hl
    ld l,a
    ld h,0
    ld (GA+6),hl
    KFAR G_TEXTW                ; HL = tw
    ld (S_TW),hl
    ld de,64
    ex de,hl
    or a
    sbc hl,de
    sra h
    rr l                        ; (64 - tw) / 2
    ld e,(ix+View_x)
    ld d,(ix+View_x+1)
    add hl,de
    ld (GA),hl                  ; tx
    ld a,(ix+View_y)
    add a,17
    ld l,a
    ld h,0
    ld (GA+2),hl
    xor a
    KFAR G_SETOP
    KFAR G_TEXTP
    ld hl,(K_FOCUS)             ; focused (not drawn by button_blur): the name inverted
    push ix
    pop de
    or a
    sbc hl,de
    ret nz
    ld a,(W2_BLUR)
    or a
    ret nz
    ld hl,(GA)                  ; (tx - 2, y + 17, tw + 4, 9)
    dec hl
    dec hl
    ld (GA),hl
    ld hl,(S_TW)
    inc hl
    inc hl
    inc hl
    inc hl
    ld (GA+4),hl
    ld hl,9
    ld (GA+6),hl
    ld a,2
    KFAR G_SETOP
    KFAR G_FILL
    ret

; ic_event (10.4): a double-click (the kernel's flag, WRITE 14.9) on the icon last pressed, or ENTER, opens it.
ic_event:
    ld a,(K_EV)
    cp E_DOWN
    jr z,.down
    cp E_KEY
    jr nz,.no
    ld a,(K_EV+1)
    cp 13
    jr z,.open
.no:
    or a
    ret
.down:
    ld hl,(S_LAST)
    push ix
    pop de
    or a
    sbc hl,de
    jr nz,.first
    ld a,(K_EV+3)               ; the kernel's double-click (WRITE 14.9)
    bit 2,a
    jr nz,.open
.first:
    ld (S_LAST),ix
    scf
    ret
.open:
    ld a,(ix+Icon_prog)
    KFAR K_LAUNCH               ; never returns

; ---------------------------------------------------------------------------------------------------------------------------
; The RAM image (to PROG_IMG = $C000).
S_IMG:
    DISP PROG_IMG
    DW CL_View
    DB 204, 6, Icon_SIZE, 10
CL_Icon:                        ; Icon: View + prog 1, name 2; Draw and Event banked; Focus and Blur draw it (Button's)
    DW view_destroy, S_THDRAW, S_THEVENT, view_hittest, button_fb, button_blur
S_THDRAW:
    KTHUNK ic_draw
S_THEVENT:
    KTHUNK ic_event
S_TITLE:    DB 12, "Leap Desktop"
S_ABOUTT:   DB 20, "Leap Desktop, step 5"

S_NCALC:    DB 10, "Calculator"
S_NCTRL:    DB 8, "Key Caps"
S_NWRITE:   DB 7, "Notepad"
S_NPAINT:   DB 5, "Paint"
S_NAMES:    DW S_NCALC, S_NCTRL, S_NWRITE, S_NPAINT
S_SETS:     DW ICON_CALC, ICON_KEYS, ICON_WRITE, ICON_PAINT   ; the bitmaps are in DOCK 6 (desk5.asm, docs/SIZE.md 4): G_ICON runs under R
S_MENUS:
    DB 1
    DW S_M1
S_M1:
    DB 1, 4, "Leap", 8
    DB 1, 0, 21, "About Leap Desktop..."
    DB 2, 2, 0                  ; a separator
    DB 3, 0, 10, "Calculator"
    DB 4, 0, 8, "Key Caps"
    DB 5, 0, 7, "Notepad"
    DB 6, 0, 5, "Paint"
    DB 7, 0, 12, "Show Desktop"
    DB 8, 0, 9
S_SNDTXT:   DB "Sound Off"
S_WIN:      DW 0
S_OPEN:     DB 0                ; 1 while the shell's window is open
S_ABOUT:    DW 0
S_LAST:     DW 0                ; the icon last pressed
S_TW:       DW 0
S_I:        DB 0
    ENT
S_IMG_LEN   EQU $ - S_IMG
S_NICONS    EQU 4
Icon_prog   EQU 16
Icon_name   EQU 17
Icon_SIZE   EQU 19
    ASSERT PROG_IMG + S_IMG_LEN <= AL_RAM && (CL_Icon >> 8) == ((CL_Icon + 11) >> 8)
S_END:
