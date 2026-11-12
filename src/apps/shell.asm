; shell.asm -- the shell, program 0 (docs/SHELL.md 4, 10.4): the "Leap Desktop" window of program icons and the "Leap" menu.
; Code in DOCK 2-3 (mapping A); its RAM image (the Icon class, strings, menu, icons, variables) is assembled for $C000.

ICON_X0     EQU 48
ICON_DX     EQU 64

; S_START: the image, the menu, the window and its icons, then the event loop.  Never returns.
S_START:
    ld hl,S_IMG
    ld de,PROG_IMG
    ld bc,S_IMG_LEN
    ldir
    ld hl,S_MENUS
    KFAR MB_SET
    ld hl,CL_Window
    call K_NEW
    ld (ix+View_x),32
    ld (ix+View_y),24
    ld (ix+View_w),LOW 256
    ld (ix+View_w+1),HIGH 256
    ld (ix+View_h),80
    ld (ix+Window_title),LOW S_TITLE
    ld (ix+Window_title+1),HIGH S_TITLE
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
    push ix
    pop de
    ld ix,(S_WIN)
    KFAR K_ADDCHILD
    ld a,(S_I)
    inc a
    cp S_NICONS + 1
    jr c,.icon
    ld ix,(S_WIN)
    KFAR W_OPEN
    ld a,1
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
.menu:                          ; Leap (1): About (1), Calculator (3), Controls (4)
    ld a,(K_EV+2)
    cp 1
    jr z,.about
    sub 2
    jr c,s_loop
    jr z,s_loop
    cp S_NICONS + 1
    jr nc,s_loop
    KFAR K_LAUNCH               ; item 3 -> program 1, item 4 -> program 2
.cmd:                           ; the About dialog's OK (id 1)
    ld a,(K_EV+1)
    cp 1
    jr nz,s_loop
    ld ix,(S_ABOUT)
    KFAR W_CLOSE
    jr s_loop
.about:
    ld ix,(S_ABOUT)
    ld a,ixh
    or ixl
    call z,s_mkabout
    KFAR W_OPEN
    jr s_loop

; s_mkabout: the About dialog (10.4), made once -> IX, S_ABOUT.
s_mkabout:
    ld hl,CL_Dialog
    call K_NEW
    ld (ix+View_x),128
    ld (ix+View_y),64
    ld (ix+View_w),LOW 256
    ld (ix+View_w+1),HIGH 256
    ld (ix+View_h),64
    ld (S_ABOUT),ix
    ld hl,CL_Label
    call K_NEW
    ld (ix+View_x),144
    ld (ix+View_y),76
    ld (ix+View_w),200
    ld (ix+View_h),9
    ld (ix+Label_text),LOW S_ABOUTT
    ld (ix+Label_text+1),HIGH S_ABOUTT
    call s_addabout
    ld hl,CL_Button
    call K_NEW
    ld (ix+View_x),LOW 304
    ld (ix+View_x+1),HIGH 304
    ld (ix+View_y),100
    ld (ix+View_w),64
    ld (ix+View_h),16
    ld (ix+View_flags),$11      ; focusable, default
    ld (ix+View_id),1
    ld (ix+Button_text),LOW S_OK
    ld (ix+Button_text+1),HIGH S_OK
    push ix
    call s_addabout
    pop hl
    ld ix,(S_ABOUT)
    ld (ix+Dialog_default),l
    ld (ix+Dialog_default+1),h
    ld (ix+Dialog_cancel),l
    ld (ix+Dialog_cancel+1),h
    ret
s_addabout:                     ; IX = a view -> the dialog's last child
    push ix
    pop de
    ld ix,(S_ABOUT)
    KFAR K_ADDCHILD
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; Icon's methods (banked).  ic_draw (10.4, 10.5): paper, the bitmap (G_BLIT, copy 0: x + 16 is on the byte grid), the name centred
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
    KFAR G_BLIT
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

; ic_event (10.4): a second E_DOWN on the same icon within 20 frames, or ENTER, opens it.
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
    ld hl,(V_FRAMES)
    ld de,(S_LASTF)
    or a
    sbc hl,de
    ld de,21
    or a
    sbc hl,de
    jr c,.open
.first:
    ld (S_LAST),ix
    ld hl,(V_FRAMES)
    ld (S_LASTF),hl
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
S_OK:       DB 2, "OK"
S_NCALC:    DB 10, "Calculator"
S_NCTRL:    DB 8, "Controls"
S_NAMES:    DW S_NCALC, S_NCTRL
S_SETS:     DW ICON_CALC, ICON_CTRL
S_MENUS:
    DB 1
    DW S_M1
S_M1:
    DB 1, 4, "Leap", 4
    DB 1, 0, 21, "About Leap Desktop..."
    DB 2, 2, 0                  ; a separator
    DB 3, 0, 10, "Calculator"
    DB 4, 0, 8, "Controls"
S_WIN:      DW 0
S_ABOUT:    DW 0
S_LAST:     DW 0                ; the icon last pressed
S_LASTF:    DW 0                ; V_FRAMES then
S_TW:       DW 0
S_I:        DB 0
    INCLUDE "icons.inc"
    ENT
S_IMG_LEN   EQU $ - S_IMG
S_NICONS    EQU 2
Icon_prog   EQU 16
Icon_name   EQU 17
Icon_SIZE   EQU 19
    ASSERT S_IMG_LEN <= 1024 && (CL_Icon >> 8) == ((CL_Icon + 11) >> 8)
S_END:
