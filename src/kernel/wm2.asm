; wm2.asm -- the window manager, slice W2 (docs/WINDOWS.md 17): window clicks and the outline drag, dialogs and the modal rule,
; Button, Label and E_CMD.  Included by kernel.asm after wm.asm.

E_CMD       EQU 10
KC_BREAK    EQU 3
KC_ENTER    EQU 13
KC_MENU     EQU 16
KC_ESC      EQU 27
KC_SPACE    EQU 32
BTN_PRESSED EQU 3               ; Button flags bits (17.1)
BTN_DEFAULT EQU 4

; W2's scratch (internal; in the part of $F480-$F4FF that W3 leaves free)
W2_SX       EQU $F4F0           ; word: W_DRAG's start x
W2_SY       EQU $F4F2           ; byte: start y
W2_P0X      EQU $F4F3           ; word: the press's x
W2_P0Y      EQU $F4F5           ; byte: its y
W2_CX       EQU $F4F6           ; word: the candidate
W2_CY       EQU $F4F8           ; byte
W2_DRAWN    EQU $F4F9           ; byte: the outline is drawn at the candidate
W2_TYPE     EQU $F4FA           ; byte: the event W_DRAG is handling
W2_TX       EQU $F4FB           ; word: button_draw's text x
W2_TY       EQU $F4FD           ; word: its y
W2_BLUR     EQU $F4FF           ; byte: 1 while button_blur draws (no focus look)

; ---------------------------------------------------------------------------------------------------------------------------
; w_isdlg: IX = a view -> Z when its class is Dialog or descends from it.  Clobbers AF, DE, HL.
w_isdlg:
    ld l,(ix+0)
    ld h,(ix+1)
.l:
    ld a,h
    or l
    jr z,.no
    ld a,l
    cp CL_Dialog & $FF
    jr nz,.up
    ld a,h
    cp CL_Dialog >> 8
    ret z
.up:
    ld de,-6
    add hl,de
    ld a,(hl)
    inc hl
    ld h,(hl)
    ld l,a
    jr .l
.no:
    or 1                        ; NZ
    ret

; w_point: BC = x, DE = y of the pointer event in K_EV.  Clobbers AF.
w_point:
    ld a,(K_EV+3)
    and 1
    ld b,a
    ld a,(K_EV+1)
    ld c,a
    ld a,(K_EV+2)
    ld e,a
    ld d,0
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; desk_event (17.3): the modal rule for pointer events, else Group's routing.
desk_event:
    ld a,(K_EV)
    cp E_KEY
    jr nz,.ptr
    ld a,(K_EV+1)               ; the MENU key opens the menus (18.4)
    cp KC_MENU
    jp nz,group_event
    ld hl,(W_MODAL)
    ld a,h
    or l
    jp nz,group_event
    ld a,(MB_N)
    or a
    jp z,group_event
    call MB_KEY
    scf
    ret
.ptr:
    ld a,(K_EV)
    sub E_MOVE
    cp E_UP - E_MOVE + 1
    jp nc,group_event           ; not a pointer event
    ld hl,(W_MODAL)
    ld a,h
    or l
    jp z,group_event
    call w_point
    push ix
    push hl
    pop ix
    call view_hittest           ; carry: inside the dialog
    pop ix
    ccf
    ret c                       ; outside: consumed, nothing else
    ld hl,(W_MODAL)
    push ix
    call k_evto                 ; M_EVENT to the dialog; its carry
    pop ix
    ret

; window_event (17.3): a click on an inactive window raises it; a press in the title bar drags.
window_event:
    ld a,(K_EV)
    cp E_DOWN
    jp nz,group_event
    call W_FRONT
    push ix
    pop de
    or a
    sbc hl,de
    jr z,.front
    call W_RAISE
    jr c,.no
    call .intitle
    call c,W_DRAG
.no:
    or a                        ; not consumed: no capture after a raise or a drag
    ret
.front:
    call .intitle
    jp nc,group_event
    call W_DRAG
    or a
    ret
.intitle:                       ; carry when the point is in rows y .. y + 8
    ld a,(K_EV+2)
    sub (ix+View_y)
    cp 9
    ret

; dialog_event (17.3): ENTER clicks the default button, ESC or BREAK the cancel button; the rest is Group's routing.
dialog_event:
    ld a,(K_EV)
    cp E_KEY
    jp nz,group_event
    ld a,(K_EV+1)
    cp KC_ENTER
    jr z,.def
    cp KC_ESC
    jr z,.can
    cp KC_BREAK
    jr nz,.no
.can:
    ld l,(ix+Dialog_cancel)
    ld h,(ix+Dialog_cancel+1)
    jr .click
.def:
    ld l,(ix+Dialog_default)
    ld h,(ix+Dialog_default+1)
.click:
    ld a,h
    or l
    jr z,.no
    push ix
    push hl
    pop ix
    call b_click
    pop ix
    scf
    ret
.no:
    or a
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; button_event (17.3).
button_event:
    ld a,(K_EV)
    cp E_DOWN
    jr z,.down
    cp E_MOVE
    jr z,.move
    cp E_UP
    jr z,.up
    cp E_KEY
    jr nz,.no
    ld a,(K_EV+1)
    cp KC_ENTER
    jr z,.key
    cp KC_SPACE
    jr nz,.no
.key:
    call b_click
    scf
    ret
.no:
    or a
    ret
.down:
    set BTN_PRESSED,(ix+View_flags)
    call W_DRAWVIEW
    scf
    ret
.move:
    ld hl,(K_CAPTURE)
    push ix
    pop de
    or a
    sbc hl,de
    jr nz,.no                   ; not the capture: hover, not consumed
    call w_point
    call view_hittest           ; carry: inside
    ld a,0
    rla                         ; A = inside
    ld b,a
    ld a,(ix+View_flags)
    rrca
    rrca
    rrca
    and 1                       ; pressed
    cp b
    jr z,.cons
    ld a,(ix+View_flags)
    xor 1 << BTN_PRESSED
    ld (ix+View_flags),a
    call W_DRAWVIEW
.cons:
    scf
    ret
.up:
    bit BTN_PRESSED,(ix+View_flags)
    jr z,.cons
    res BTN_PRESSED,(ix+View_flags)
    call W_DRAWVIEW
    call b_post
    scf
    ret

; b_click: IX = a button: pressed and drawn, four frames, released and drawn, E_CMD posted (17.3).  Interrupts must be on.
; Preserves IX.  Clobbers AF, BC, DE, HL.
b_click:
    set BTN_PRESSED,(ix+View_flags)
    call W_DRAWVIEW
    ld b,4
.wait:
    halt
    djnz .wait
    res BTN_PRESSED,(ix+View_flags)
    call W_DRAWVIEW
; b_post: E_CMD (C = View_id, E = the slot of its window, D = 0) posted.  Clobbers AF, BC, DE, HL.
b_post:
    push ix
    pop hl
    call w_slotof
    ld e,a
    ld c,(ix+View_id)
    ld d,0
    ld a,E_CMD
    jp K_POST

; w_slotof: HL = a view -> A = the slot of the open window it is in (0 when none).  Clobbers F, DE, HL.
w_slotof:
    ld a,h
    or l
    ret z
    push hl
    ld de,View_parent
    add hl,de
    ld e,(hl)
    inc hl
    ld d,(hl)
    pop hl
    ld a,d
    or e
    ret z                       ; a root: none
    push hl
    ld hl,(W_SLOTS)
    or a
    sbc hl,de
    pop hl
    jr z,.top                   ; its parent is the desk
    ex de,hl
    jr w_slotof
.top:
    ld de,(W_SLOTS+30)
    or a
    sbc hl,de
    ld a,0
    ret z                       ; the bar
    add hl,de
    ld de,Window_slot
    add hl,de
    ld a,(hl)
    ret

; button_fb / button_blur: Button's M_FOCUS / M_BLUR: drawn again, so the focus look follows the focus.  During M_BLUR K_FOCUS
; still points at the button, so the blur draws it with W2_BLUR set: no focus look.
button_fb:
    jp W_DRAWVIEW
button_blur:
    ld a,1
    ld (W2_BLUR),a
    call W_DRAWVIEW
    xor a
    ld (W2_BLUR),a
    ret

; ===========================================================================================================================
; W_DRAG (17.4): IX = a window, K_EV = the E_DOWN that started it.  Preserves IX.  Clobbers AF, BC, DE, HL; GA, GOP.
W_DRAG:
    call W_UPDATE
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    ld (W2_SX),hl
    ld (W2_CX),hl
    ld a,(ix+View_y)
    ld (W2_SY),a
    ld (W2_CY),a
    call w_point
    ld (W2_P0X),bc
    ld a,e
    ld (W2_P0Y),a
    xor a
    ld (W2_DRAWN),a
.loop:
    call K_GETEV
    jr nc,.ev
    halt
    jr .loop
.ev:
    ld (W2_TYPE),a
    cp E_KEY
    jp z,.key
    cp E_MOVE
    jr z,.pt
    cp E_UP
    jr nz,.loop                 ; anything else: dropped
.pt:
    call w_point                ; BC = px, DE = py
    ld hl,(W2_P0X)
    ex de,hl                    ; DE = p0x, HL = py
    push hl
    ld h,b
    ld l,c
    or a
    sbc hl,de
    ld de,8
    add hl,de
    ld a,l
    and $F0
    ld l,a                      ; 16 floor((px - p0x + 8) / 16)
    ld de,(W2_SX)
    add hl,de                   ; cx
    bit 7,h
    jr z,.cx0
    ld hl,0
.cx0:
    push hl
    ld e,(ix+View_w)
    ld d,(ix+View_w+1)
    ld hl,512
    or a
    sbc hl,de                   ; 512 - w
    pop de                      ; DE = cx
    push hl
    or a
    sbc hl,de
    pop hl
    jr c,.cx1                   ; cx > 512 - w: the limit
    ex de,hl
.cx1:
    ld (W2_NX),hl
    pop hl                      ; py
    ld a,(W2_P0Y)
    ld e,a
    ld d,0
    or a
    sbc hl,de
    ld de,4
    add hl,de
    ld a,l
    and $F8
    ld l,a                      ; 8 floor((py - p0y + 4) / 8)
    ld a,(W2_SY)
    ld e,a
    ld d,0
    add hl,de                   ; cy
    bit 7,h
    jr nz,.cy8
    ld a,h
    or a
    jr nz,.cymax
    ld a,l
    cp 8
    jr nc,.cy1
.cy8:
    ld a,8
    jr .cy2
.cy1:
    ld c,a
    ld a,192
    sub (ix+View_h)             ; 192 - h
    cp c
    jr c,.cy2                   ; cy > 192 - h: the limit
    ld a,c
    jr .cy2
.cymax:
    ld a,192
    sub (ix+View_h)
.cy2:
    ld (W2_NY),a
    ld hl,(W2_NX)               ; changed?
    ld de,(W2_CX)
    or a
    sbc hl,de
    jr nz,.change
    ld a,(W2_NY)
    ld hl,W2_CY
    cp (hl)
    jr z,.same
.change:
    call .erase
    ld hl,(W2_NX)
    ld (W2_CX),hl
    ld a,(W2_NY)
    ld (W2_CY),a
    call .atstart
    jr z,.same                  ; back at the start: no outline
    call .draw
.same:
    ld a,(W2_TYPE)
    cp E_UP
    jp nz,.loop
    call .erase
    call .atstart
    ret z
    ld hl,(W2_CX)
    ld a,(W2_CY)
    ld e,a
    ld d,0
    jp W_MOVE
.key:
    ld a,(K_EV+1)
    cp KC_ESC
    jr z,.cancel
    cp KC_BREAK
    jp nz,.loop
.cancel:
.erase:                         ; the outline at the candidate, when drawn, is erased
    ld a,(W2_DRAWN)
    or a
    ret z
    xor a
    ld (W2_DRAWN),a
    jr .xor
.draw:
    ld a,1
    ld (W2_DRAWN),a
.xor:
    ld hl,(W2_CX)
    ld a,(W2_CY)
    ld e,a
    ld d,0
    jp w_outline
.atstart:                       ; Z when the candidate is the start
    ld hl,(W2_CX)
    ld de,(W2_SX)
    or a
    sbc hl,de
    ret nz
    ld a,(W2_CY)
    ld hl,W2_SY
    cp (hl)
    ret
W2_NX       EQU W2_TX           ; the new candidate (W_DRAG and button_draw never run together)
W2_NY       EQU W2_TY

; w_outline: IX = a window, HL = x, DE = y: the XOR outline of its size at (x, y), each side shielded on its own (17.4).
; Clobbers AF, BC, DE, HL; GA, GOP.
w_outline:
    push de
    push hl
    ld a,2
    call G_SETOP
    pop hl
    pop de
    ld (GA),hl
    ld (GA+2),de
    ld l,(ix+View_w)
    ld h,(ix+View_w+1)
    ld (GA+4),hl
    ld hl,1
    ld (GA+6),hl
    call w_side                 ; top
    ld hl,(GA+2)
    ld e,(ix+View_h)
    ld d,0
    add hl,de
    dec hl
    ld (GA+2),hl
    call w_side                 ; bottom
    ld hl,(GA+2)
    ld e,(ix+View_h)
    ld d,0
    or a
    sbc hl,de
    inc hl
    inc hl
    ld (GA+2),hl                ; y + 1
    ld hl,1
    ld (GA+4),hl
    ld l,(ix+View_h)
    ld h,0
    dec hl
    dec hl
    ld (GA+6),hl
    call w_side                 ; left
    ld hl,(GA)
    ld e,(ix+View_w)
    ld d,(ix+View_w+1)
    add hl,de
    dec hl
    ld (GA),hl
w_side:                         ; GA: P_SHIELD, G_FILL, P_UNSHIELD (GA unchanged)
    call P_SHIELD
    call G_FILL
    jp P_UNSHIELD

; ===========================================================================================================================
; Drawing (17.5).

; dialog_draw: paper, the frame, the inner frame, the children.
dialog_draw:
    ld a,1
    call G_SETOP
    call w_gaview
    call G_FILL
    xor a
    call G_SETOP
    call w_gaview
    call G_FRAME
    call w_gaview
    ld hl,(GA)
    ld de,4
    add hl,de
    ld (GA),hl
    ld hl,(GA+2)
    inc hl
    inc hl
    ld (GA+2),hl
    ld hl,(GA+4)
    ld de,-8
    add hl,de
    ld (GA+4),hl
    ld hl,(GA+6)
    ld de,-4
    add hl,de
    ld (GA+6),hl
    call G_FRAME
    jp group_draw

; button_draw: paper and frame; the default frame; the text centred; the focus underline; pressed inverts the inside.
button_draw:
    ld a,1
    call G_SETOP
    call w_gaview
    call G_FILL
    xor a
    call G_SETOP
    call w_gaview
    call G_FRAME
    bit BTN_DEFAULT,(ix+View_flags)
    jr z,.text
    call w_gaview
    ld hl,(GA)
    inc hl
    inc hl
    ld (GA),hl
    ld hl,(GA+2)
    inc hl
    ld (GA+2),hl
    ld hl,(GA+4)
    ld de,-4
    add hl,de
    ld (GA+4),hl
    ld hl,(GA+6)
    dec hl
    dec hl
    ld (GA+6),hl
    call G_FRAME
.text:
    ld hl,0
    ld (GA+6),hl                ; n = 0 with no text
    ld l,(ix+Button_text)
    ld h,(ix+Button_text+1)
    ld a,h
    or l
    jr z,.tw
    ld a,(hl)
    inc hl
    ld (GA+4),hl
    ld (GA+6),a
    call G_TEXTW                ; HL = tw
.tw:
    push hl                     ; tw
    ex de,hl
    ld l,(ix+View_w)
    ld h,(ix+View_w+1)
    or a
    sbc hl,de
    sra h
    rr l                        ; floor((w - tw) / 2)
    ld e,(ix+View_x)
    ld d,(ix+View_x+1)
    add hl,de
    ld (W2_TX),hl
    ld (GA),hl
    ld l,(ix+View_h)
    ld h,0
    ld de,-8
    add hl,de
    sra h
    rr l                        ; floor((h - 8) / 2)
    ld e,(ix+View_y)
    ld d,0
    add hl,de
    ld (W2_TY),hl
    ld (GA+2),hl
    ld a,(GA+6)
    or a
    jr z,.notext
    xor a
    call G_SETOP
    call G_TEXTP
.notext:
    ld hl,(K_FOCUS)             ; focused: the underline
    push ix
    pop de
    or a
    sbc hl,de
    pop bc                      ; BC = tw
    jr nz,.press
    ld a,(W2_BLUR)
    or a
    jr nz,.press
    xor a
    call G_SETOP
    ld hl,(W2_TY)
    ld de,8
    add hl,de
    ex de,hl
    ld hl,(W2_TX)
    call G_HLINE
.press:
    bit BTN_PRESSED,(ix+View_flags)
    ret z
    ld a,2
    call G_SETOP
    call w_gaview
    call w_inset1
    ld hl,(GA+6)
    dec hl
    dec hl
    ld (GA+6),hl
    jp G_FILL

; w_inset1: GA's x + 1, y + 1, w - 2.  Clobbers HL.
w_inset1:
    ld hl,(GA)
    inc hl
    ld (GA),hl
    ld hl,(GA+2)
    inc hl
    ld (GA+2),hl
    ld hl,(GA+4)
    dec hl
    dec hl
    ld (GA+4),hl
    ret

; label_draw: paper, then the text: G_TEXTP at (x, y), or with flags bit 3 G_TEXT8 at the cell (x / 8, y / 8).
label_draw:
    ld a,1
    call G_SETOP
    call w_gaview
    call G_FILL
    ld l,(ix+Label_text)
    ld h,(ix+Label_text+1)
    ld a,h
    or l
    ret z
    ld a,(hl)
    inc hl
    ld (GA+4),hl
    ld l,a
    ld h,0
    ld (GA+6),hl
    xor a
    call G_SETOP
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    ld a,(ix+View_y)
    bit 3,(ix+View_flags)
    jr nz,.cells
    ld (GA),hl
    ld l,a
    ld h,0
    ld (GA+2),hl
    jp G_TEXTP
.cells:
    srl h
    rr l
    srl h
    rr l
    srl h
    rr l
    ld (GA),hl                  ; column
    rrca
    rrca
    rrca
    and $1F
    ld l,a
    ld h,0
    ld (GA+2),hl                ; row
    jp G_TEXT8
