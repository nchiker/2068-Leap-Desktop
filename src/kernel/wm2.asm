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

; W2's scratch (internal: the end of W1's internal area, docs/WINDOWS.md 14.2)
W2_BX       EQU $F470           ; word: W_DRAG: the window's x - the press's x + 8
W2_BY       EQU $F472           ; word: the window's y - the press's y + 4
W2_CX       EQU $F474           ; word: the candidate
W2_CY       EQU $F476           ; word (0..191)
W2_BLUR     EQU $F478           ; byte: 1 while button_blur draws (no focus look)
    ASSERT W2_BX >= W_BASE + 4 && W2_BLUR < $F480

; ---------------------------------------------------------------------------------------------------------------------------
; w_isdlg: IX = a view -> Z when its class is Dialog or descends from it (carry clear either way).  Clobbers AF, DE, HL.
w_isdlg:
    ld l,(ix+0)
    ld h,(ix+1)
.l:
    ld de,CL_Dialog
    or a
    sbc hl,de
    ret z
    add hl,de
    ld a,-6                     ; the parent class (0 after Object: a class is never in page 0)
    dec h
    call w_hlfld
    ld a,h
    or a
    jr nz,.l
    inc a                       ; NZ
    ret

; w_point: BC = x, DE = y of the pointer event in K_EV.  Clobbers AF.
w_point:
    ld bc,(K_EV+1)              ; C = data 1, B = data 2
    ld e,b
    ld d,0
    ld a,(K_EV+3)
    and 1
    ld b,a
    ret

; w_wait: waits (HALT) for the next event: K_EV, A = its type.  Clobbers F, BC, DE, HL.
w_wait:
    call K_GETEV
    ret nc
    halt
    jr w_wait

; ---------------------------------------------------------------------------------------------------------------------------
; desk_event (17.3): the modal rule for pointer events, the MENU key (18.4), else Group's routing.
desk_event:
    ld hl,(K_EV)                ; L = the type, H = data 1
    ld a,(W_MODAL+1)            ; not 0: a dialog is open
    dec l
    jr z,.key
    or a
    jp z,group_event
    ld a,l
    cp E_UP
    jr nc,.no                   ; not a pointer event
    push ix
    ld ix,(W_MODAL)
    call w_point
    call view_hittest           ; carry: inside the dialog
    ccf
    jr c,.out                   ; outside: consumed, nothing else
    push ix
    pop hl
    call k_evto                 ; M_EVENT to the dialog; its carry
.out:
    pop ix
    ret
.key:
    or a
    jr nz,.no                   ; no menus while a dialog is open
    ld a,h
    cp KC_MENU
    jr nz,.no
    ld a,(MB_N)
    or a
    ret z
    call MB_KEY
    scf
    ret
.no:
    or a
    ret

; window_event (17.3): a click on an inactive window raises it; a press in the title bar drags.
window_event:
    ld a,(K_EV)
    cp E_DOWN
    jp nz,group_event
    call w_isfront
    push af                     ; Z: in front
    call nz,W_RAISE
    ld a,(K_EV+2)
    sub (ix+View_y)
    cp 9                        ; carry: in the title bar, rows y .. y + 8
    jr nc,.body
    pop af
    call W_DRAG
    or a                        ; not consumed: no capture after a raise or a drag
    ret
.body:
    pop af
    jp z,group_event
    or a
    ret

; dialog_event (17.3): ENTER clicks the default button, ESC or BREAK the cancel button; the rest is Group's routing.
dialog_event:
    ld hl,(K_EV)                ; L = the type, H = data 1
    dec l
    jr nz,.group
    ld a,h
    ld c,Dialog_default
    cp KC_ENTER
    jr z,.click
    ld c,Dialog_cancel
    cp KC_ESC
    jr z,.click
    cp KC_BREAK
    jr nz,.group
.click:
    push ix
    pop hl
    ld a,c
    call w_hlfld                ; HL = the button
    ld a,h
    or a
    jr z,.group                 ; none: not consumed
    push ix
    push hl
    pop ix
    call b_click                ; carry set
    pop ix
    ret
.group:
    jp group_event

; ---------------------------------------------------------------------------------------------------------------------------
; button_event (17.3).
button_event:
    ld hl,(K_EV)                ; L = the type, H = data 1
    ld a,l
    cp E_DOWN
    jr z,.down
    cp E_UP
    jr z,.up
    cp E_MOVE
    jr z,.move
    dec a
    jr nz,.no                   ; not E_KEY
    ld a,h
    cp KC_ENTER
    jr z,b_click
    cp KC_SPACE
    jr z,b_click
.no:
    or a
    ret
.move:
    ld hl,(K_CAPTURE)
    call w_cpix
    jr nz,.no                   ; not the capture: hover, not consumed
    call w_point
    call view_hittest           ; carry: inside
    sbc a,a
    xor (ix+View_flags)
    and 1 << BTN_PRESSED
    jr z,.cons                  ; pressed = inside already
    xor (ix+View_flags)
    ld (ix+View_flags),a
    jr .draw
.down:
    set BTN_PRESSED,(ix+View_flags)
.draw:
    call W_DRAWVIEW
.cons:
    scf
    ret
.up:
    bit BTN_PRESSED,(ix+View_flags)
    jr z,.cons
    jr b_release

; b_click: IX = a button: pressed and drawn, four frames, released and drawn, E_CMD posted (17.3).  Interrupts must be on.
; Carry set.  Preserves IX.  Clobbers AF, BC, DE, HL.
b_click:
    set BTN_PRESSED,(ix+View_flags)
    call W_DRAWVIEW
    ld b,4
.wait:
    halt
    djnz .wait
b_release:
    res BTN_PRESSED,(ix+View_flags)
    call W_DRAWVIEW
; b_post: E_CMD (C = View_id, E = the slot of its window, 0 when it is in none, D = 0) posted.  Carry set.
b_post:
    call w_owner
    cp 15
    jr nz,.slot
    xor a                       ; the bar: no window
.slot:
    ld e,a
    ld c,(ix+View_id)
    ld d,0
    ld a,E_CMD
    call K_POST
    scf
    ret

; button_fb / button_blur: Button's M_FOCUS / M_BLUR: drawn again, so the focus look follows the focus.  During M_BLUR K_FOCUS
; still points at the button, so the blur draws it with W2_BLUR set: no focus look.
button_fb   EQU W_DRAWVIEW
button_blur:
    ld hl,W2_BLUR
    inc (hl)
    call W_DRAWVIEW
    ld hl,W2_BLUR
    dec (hl)
    ret

; ===========================================================================================================================
; W_DRAG (17.4): IX = a window, K_EV = the E_DOWN that started it.  Preserves IX.  Clobbers AF, BC, DE, HL; GA, GOP.
; The start is the window's own (x, y), which does not change before the W_MOVE at the end, and the outline is drawn exactly
; when the candidate is not the start.  The candidate's x is (px + W2_BX) AND $FFF0: the start is on the cell grid.
W_DRAG:
    call W_UPDATE
    call w_point                ; BC = the press's x, DE = its y
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    ld (W2_CX),hl
    or a
    sbc hl,bc
    ld bc,8
    add hl,bc
    ld (W2_BX),hl
    ld l,(ix+View_y)
    ld h,b
    ld (W2_CY),hl
    or a
    sbc hl,de
    ld c,4
    add hl,bc
    ld (W2_BY),hl
.loop:
    call w_wait
    cp E_KEY
    jp z,.key
    cp E_MOVE
    jr z,.pt
    cp E_UP
    jr nz,.loop                 ; anything else: dropped
.pt:
    push af
    call w_point                ; BC = px, DE = py
    ld hl,(W2_BX)
    add hl,bc
    ld a,l
    and $F0
    ld l,a                      ; sx + 16 floor((px - p0x + 8) / 16)
    push de                     ; py
    push hl
    ld hl,512
    ld c,(ix+View_w)
    ld b,(ix+View_w+1)
    or a
    sbc hl,bc
    ex de,hl
    pop hl
    call k_clamp                ; 0 .. 512 - w
    ex (sp),hl                  ; HL = py, (SP) = the new x
    ld de,(W2_BY)
    add hl,de
    ld a,l
    and $F8
    ld l,a                      ; sy + 8 floor((py - p0y + 4) / 8), -184 .. 368
    inc h                       ; + 256, so the clamp to [8, 192 - h] is unsigned
    ld de,256 + 8
    call w_max
    ld a,192
    sub (ix+View_h)
    ld e,a
    ld d,1
    call w_min
    ld c,l                      ; C = the new y
    pop de                      ; DE = the new x
    ld hl,(W2_CX)
    or a
    sbc hl,de
    jr nz,.change
    ld a,(W2_CY)
    cp c
    jr z,.same
.change:
    push de
    push bc
    call .xor                   ; the outline leaves the old candidate
    pop bc
    pop hl
    ld (W2_CX),hl
    ld a,c
    ld (W2_CY),a
    call .xor                   ; and shows at the new one
.same:
    pop af
    cp E_UP
    jr nz,.loop
    call .xor                   ; released: the outline goes
    call .cand
    jp W_MOVE                   ; (nothing when the candidate is the start)
.cand:                          ; HL = the candidate's x, DE = its y; Z when it is the start
    ld hl,(W2_CX)
    ld de,(W2_CY)
    ld a,e
    cp (ix+View_y)
    ret nz
    ld a,l
    cp (ix+View_x)
    ret nz
    ld a,h
    cp (ix+View_x+1)
    ret
.key:
    ld a,(K_EV+1)
    cp KC_ESC
    jr z,.xor
    cp KC_BREAK
    jp nz,.loop
.xor:                           ; the outline at the candidate drawn or erased (XOR); nothing when that is the start
    call .cand
    ret z
; w_outline: IX = a window, HL = x, DE = y (0..191): the XOR outline of its size at (x, y), each side shielded on its own
; (17.4).  Clobbers AF, BC, DE, HL; GA, GOP.
w_outline:
    ld (GA),hl
    ld (GA+2),de
    ld a,2
    call G_SETOP
    ld l,(ix+View_w)
    ld h,(ix+View_w+1)
    ld (GA+4),hl
    ld hl,1
    ld (GA+6),hl
    call w_side                 ; top
    ld hl,GA+2
    ld a,(hl)
    add a,(ix+View_h)
    dec a
    ld (hl),a
    call w_side                 ; bottom
    ld hl,GA+2
    ld a,(hl)
    sub (ix+View_h)
    add a,2
    ld (hl),a                   ; y + 1
    ld a,(ix+View_h)
    sub 2
    ld (GA+6),a
    ld hl,1
    ld (GA+4),hl
    call w_side                 ; left
    call w_garight
w_side:                         ; GA: P_SHIELD, G_FILL, P_UNSHIELD (GA unchanged)
    call P_SHIELD
    call G_FILL
    jp P_UNSHIELD

; ===========================================================================================================================
; Drawing (17.5).

; w_clear: paper over IX's rectangle.  w_box: and its frame in ink; GOP = SET after.  w_clearga, w_boxga: the same for the
; rectangle in GA.  Clobber AF, BC, DE, HL; GA.
w_box:
    call w_gaview
w_boxga:
    call w_clearga
    xor a
    call G_SETOP
    jp G_FRAME
w_clear:
    call w_gaview
w_clearga:
    ld a,1
    call G_SETOP
    jp G_FILL

; w_gains: GA = IX's rectangle inset by B pixels on the left and the right, C at the top and the bottom.  Clobbers AF, E, HL.
w_gains:
    call w_gaview
    ld hl,GA
    ld a,b
    call .axis
    ld l,(GA+2) & $FF
    ld a,c
.axis:                          ; HL -> x or y: += A; the size, 4 bytes on: -= 2 A
    ld e,a
    add a,(hl)
    ld (hl),a
    inc l
    jr nc,.nc
    inc (hl)
.nc:
    inc l
    inc l
    inc l
    sla e
    ld a,(hl)
    sub e
    ld (hl),a
    ret nc
    inc l
    dec (hl)
    ret

; dialog_draw: paper, the frame, the inner frame, the children.
dialog_draw:
    call w_box
    ld bc,4 * 256 + 2
    call w_gains
    call G_FRAME
    jp group_draw

; button_draw: paper and frame; the default frame; the text centred; the focus underline; pressed inverts the inside.
button_draw:
    call w_box
    bit BTN_DEFAULT,(ix+View_flags)
    jr z,.text
    ld bc,2 * 256 + 1
    call w_gains
    call G_FRAME
.text:
    call w_gatext               ; no text: the empty string
    call G_TEXTW                ; HL = tw
    push hl
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
    ld (GA),hl                  ; tx
    ld a,(ix+View_h)
    sub 8
    sra a                       ; floor((h - 8) / 2)
    add a,(ix+View_y)
    ld l,a
    ld h,0
    ld (GA+2),hl                ; ty
    call G_TEXTP                ; (it keeps GA)
    pop bc                      ; BC = tw
    ld hl,(K_FOCUS)             ; focused: the underline
    call w_cpix
    jr nz,.press
    ld a,(W2_BLUR)
    or a
    jr nz,.press
    ld hl,(GA+2)
    ld de,8
    add hl,de
    ex de,hl
    ld hl,(GA)
    call G_HLINE
.press:
    bit BTN_PRESSED,(ix+View_flags)
    ret z
    ld a,2
    call G_SETOP
    ld bc,1 * 256 + 1
    call w_gains
    jp G_FILL

; label_draw: paper, then the text: G_TEXTP at (x, y), or with flags bit 3 G_TEXT8 at the cell (x / 8, y / 8).
label_draw:
    call w_clear                ; GA = (x, y, ..)
    call w_gatext
    xor a
    call G_SETOP
    bit 3,(ix+View_flags)
    jp z,G_TEXTP
    ld hl,(GA)
    call w_shr3
    ld (GA),hl                  ; column
    ld hl,GA+2
    ld a,(hl)
    rrca
    rrca
    rrca
    and $1F
    ld (hl),a                   ; row
    jp G_TEXT8
