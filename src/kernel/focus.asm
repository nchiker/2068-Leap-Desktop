; focus.asm -- event routing, Group, keyboard focus (docs/OBJECTS_EVENTS.md sections 6 and 15).  Included by kernel.asm.

; ---------------------------------------------------------------------------------------------------------------------------
; K_DISPATCH: routes the event in K_EV (section 6).  Preserves IX, IY.  Clobbers AF, BC, DE, HL.
; The view being served is held in HL and handed to k_evto, which makes it IX for the method; a method preserves IX (section 3),
; so after a send IX is still the receiver.
K_DISPATCH:
    push ix
    call .route
    pop ix
    ret
.key:
    ld hl,(K_FOCUS)
    ld a,h
    or l
    jr nz,.bubble
    ld hl,(K_ROOT)
    jr .more
.bubble:
    call k_evto
    ret c                       ; consumed
    ld l,(ix+View_parent)       ; IX = the view that did not consume it
    ld h,(ix+View_parent+1)
.more:
    ld a,h
    or l
    jr nz,.bubble
    ld a,(K_EV+1)               ; nobody consumed the key: TAB and the arrows move the focus
    sub K_LEFT
    cp K_BACKTAB - K_LEFT + 1
    ret nc
    ld b,a
    inc b
    ld hl,%1000100111001111     ; bit n is key K_LEFT + n.  L: the keys acted on; H: those that go to the previous view
.bit:
    rrc h
    rrc l
    djnz .bit
    ret nc                      ; none of the six
    ld a,h
    rlca
    and 1                       ; 0 = next, 1 = previous
    jp k_focuswalk
.route:
    ld a,(K_EV)
    cp E_DOWN
    jr z,.down
    dec a
    jr z,.key                   ; E_KEY
    dec a
    jr z,.move                  ; E_MOVE
    cp E_UP - E_MOVE
    jr nz,.root
    ld hl,(K_CAPTURE)           ; E_UP: to the capture, which ends
    ld a,h
    or l
    jr z,.root
    ld de,0
    ld (K_CAPTURE),de
    jr k_evto
.move:
    ld hl,(K_CAPTURE)           ; E_MOVE: to the capture, else routed from the root
    ld a,h
    or l
    jr z,.root
    jr k_evto
.down:
    ld hl,0
    ld (K_CAPTURE),hl
.root:
    ld hl,(K_ROOT)
    ld a,h
    or l
    ret z                       ; and on into k_evto

; k_evto: HL = a view (not 0) -> M_EVENT (DE = K_EV) to it; carry = consumed.  IX = the view on return.
; k_sendhl: HL = a view (not 0), A = 2 * the message, BC / DE = the arguments -> the method, entered as K_SEND enters it
; (IX = the view; A, F, HL undefined).  The send for a caller that holds the view in HL: the class is read through HL, 75 T
; against 112 for PUSH HL / POP IX / RST $08.  A method table never crosses a page, so the slot's low byte is one ADD.
k_evto:
    ld de,K_EV
    ld a,M_EVENT * 2
k_sendhl:
    push hl
    pop ix
    add a,(hl)
    inc hl
    ld h,(hl)
    ld l,a                      ; HL = the method's slot
    ld a,(hl)
    inc l
    ld h,(hl)
    ld l,a
    jp (hl)

; Key codes the kernel acts on (14.4)
K_LEFT      EQU 8
K_RIGHT     EQU 9
K_DOWN      EQU 10
K_UP        EQU 11
K_TAB       EQU 14
K_BACKTAB   EQU 15

; ---------------------------------------------------------------------------------------------------------------------------
; group_event: Group's M_EVENT.  A pointer event goes to the front-most child (not hidden, not disabled) whose M_HITTEST hits;
; on E_DOWN a focusable child takes the focus first, and the child that consumes it becomes the capture if there is none.
; Carry = the child consumed it.  Other events: not consumed.
; A child whose HitTest slot holds view_hittest is tested here, in place, with the same arithmetic (option E, 16.4); any other
; child gets M_HITTEST.
; The children are walked with HL (option D): BC = x for the whole walk, DE = scratch, and IX = the class last found to have
; view_hittest, so that a run of children of one class costs two compares a child instead of the slot lookup.  The tests are
; pure, so their order is free: class, x, width, y, height, flags (the fields in address order, y after the width).
group_event:
    ld a,(K_EV)
    sub E_MOVE
    cp E_UP - E_MOVE + 1
    ret nc                      ; not E_MOVE, E_DOWN, E_UP: not consumed
    push ix                     ; the group, on the stack until the end
    ld l,(ix+View_child)
    ld h,(ix+View_child+1)
    ld bc,(K_EV+1)              ; C = x low
    ld a,(K_EV+3)
    and 1
    ld b,a                      ; BC = x
    ld a,h
    or l
    jr z,.none
    ld a,(hl)                   ; the first child: straight to the slot lookup.  IX (still the group) stands for "no class
    jr .class                   ; known": a class pointer is never the address of a view
.loop:                          ; HL = a child
    ld a,(hl)
    cp ixl
    jr nz,.class
    inc hl
    ld a,(hl)
    cp ixh
    jr nz,.class1
.geom:                          ; HL = the child + 1; its HitTest is view_hittest
    ld de,View_x - 1
    add hl,de
    ld a,c
    sub (hl)
    ld e,a
    inc hl
    ld a,b
    sbc a,(hl)
    jr c,.left
    ld d,a                      ; DE = x - View_x
    inc hl
    inc hl
    ld a,e
    sub (hl)                    ; View_w
    inc hl
    ld a,d
    sbc a,(hl)
    jr c,.xin
    ld de,View_next - View_w - 1
.next:                          ; HL + DE = the child's View_next
    add hl,de
    ld a,(hl)
    inc hl
    ld h,(hl)
    ld l,a
.test:
    or h
    jp nz,.loop
.none:
    pop ix                      ; no child hit (carry clear)
    ret
.left:
    ld de,View_next - View_x - 1
    jr .next
.xin:                           ; x is inside; HL = View_w + 1
    dec hl
    dec hl
    ld a,(K_EV+2)
    sub (hl)                    ; y - View_y
    inc hl
    inc hl
    inc hl                      ; View_h (the flags are kept)
    jr c,.out13
    cp (hl)
    jr nc,.out13
    inc hl
    ld a,(hl)                   ; View_flags
    and 6
    jr z,.inside
    dec hl                      ; hidden or disabled
.out13:
    ld de,View_next - View_h
    jr .next
.class1:
    dec hl
    ld a,(hl)
.class:                         ; HL = the child, A = its class's low byte; not the class known
    add a,M_HITTEST * 2
    ld e,a
    inc hl
    ld d,(hl)                   ; DE = its HitTest slot (a method table never crosses a page)
    ld a,(de)
    cp view_hittest & $FF
    jr nz,.send
    inc e
    ld a,(de)
    cp view_hittest >> 8
    jr nz,.send
    ld a,e
    sub M_HITTEST * 2 + 1
    ld ixl,a
    ld ixh,d                    ; this class is the one known
    jr .geom
.send:                          ; HL = the child + 1; its class has a HitTest of its own
    dec hl
    push ix
    push bc
    push hl
    pop ix                      ; IX = the child
    ld a,(ix+View_flags)
    and 6
    jr nz,.pass                 ; hidden or disabled
    ld a,(K_EV+2)
    ld e,a
    ld d,0                      ; BC = x, DE = y
    ld a,M_HITTEST
    rst $08
    jr c,.sent
.pass:
    ld l,(ix+View_next)
    ld h,(ix+View_next+1)
    pop bc
    pop ix
    ld a,l
    jr .test
.sent:                          ; it hit
    pop bc
    pop bc
    ld c,(ix+View_flags)
    push ix
    pop hl
    jr .hit
.inside:
    ld c,(hl)                   ; BC is x no longer
    ld de,-View_flags
    add hl,de
.hit:                           ; HL = the target, C = its flags
    ld a,(K_EV)
    cp E_DOWN
    jr nz,.deliver
    ld a,c
    and 7
    dec a
    jr nz,.deliver              ; it cannot take the focus
    ex de,hl                    ; K_SETFOCUS, its flags test done
    ld hl,(K_FOCUS)
    sbc hl,de                   ; (the CP left carry clear)
    add hl,de                   ; HL = the old focus, Z as the SBC left it
    push de
    call nz,k_setf
    pop hl
.deliver:
    call k_evto                 ; IX = the target on return
    jr nc,.back
    ld a,(K_EV)
    cp E_DOWN
    jr nz,.cons
    ld hl,(K_CAPTURE)
    ld a,h
    or l
    jr nz,.cons
    ld (K_CAPTURE),ix
.cons:
    scf
.back:
    pop ix
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; K_SETFOCUS: DE = view or 0.  Nothing when it is already the focus (carry clear).  Carry set (nothing) when DE is a view that
; cannot take focus (flags: focusable, not hidden, not disabled).  Else M_BLUR to the old focus, K_FOCUS = DE, M_FOCUS to DE.
; Preserves IX, IY.  Clobbers AF, BC, DE, HL.
K_SETFOCUS:
    ld hl,(K_FOCUS)
    or a
    sbc hl,de
    ret z
    ld a,d
    or e
    jr z,.ok
    ld hl,View_flags
    add hl,de
    ld a,(hl)
    and 7
    dec a
    scf
    ret nz
.ok:
    ld hl,(K_FOCUS)
    push ix
    call k_setf
    pop ix
    or a
    ret

; k_setf: DE = the new focus (0, or a view that can take it), HL = the old one (0 or a view, not DE): M_BLUR to the old,
; K_FOCUS = the new, M_FOCUS to the new.  Clobbers IX.
k_setf:
    push de
    ld a,h
    or l
    ld a,M_BLUR * 2
    call nz,k_sendhl
    pop hl
    ld (K_FOCUS),hl
    ld a,h
    or l
    ret z
    ld a,M_FOCUS * 2
    jp k_sendhl

; ---------------------------------------------------------------------------------------------------------------------------
; K_FOCUSNEXT / K_FOCUSPREV (15.3): the next / previous view that can take focus (flags AND 7 = 1), in pre-order under K_ROOT,
; wrapping; the children of a hidden or disabled view are skipped.  The walk starts after the focus (with no focus, the root is
; the first view tried) and ends at the start, or when it would wrap to the root a second time.  Preserves IX, IY.  Clobbers AF,
; BC, DE, HL.
K_FOCUSNEXT:
    xor a
    jr k_focuswalk
K_FOCUSPREV:
    ld a,1
k_focuswalk:
    ld d,a                      ; D = 0 next, 1 previous
    ld hl,(K_ROOT)
    ld a,h
    or l
    ret z
    push ix
    push iy
    ld iy,0                     ; IY = the last candidate seen (previous)
    ld a,2
    ld (K_SCRATCH),a            ; wraps to the root left
    ld bc,(K_FOCUS)             ; BC = the start
    ld a,b
    or c
    jr nz,.from
    ld b,h
    ld c,l                      ; no focus: start at the root and try it first
    push hl
    pop ix
    ld e,(ix+View_flags)
    jr .test
.from:
    push bc
    pop ix
    ld e,(ix+View_flags)
.step:                          ; IX = a view, E = its flags: on to the next view in pre-order
    ld a,e
    and 6
    jr nz,.up                   ; hidden or disabled: skip the children
    ld l,(ix+View_child)
    ld h,(ix+View_child+1)
    ld a,h
    or l
    jr nz,.go
.up:
    ld l,(ix+View_next)
    ld h,(ix+View_next+1)
    ld a,h
    or l
    jr nz,.go
    ld l,(ix+View_parent)
    ld h,(ix+View_parent+1)
    push hl
    pop ix
    ld a,h
    or l
    jr nz,.up
    ld hl,K_SCRATCH             ; past the last view: wrap to the root
    dec (hl)
    jr z,.end
    ld hl,(K_ROOT)
.go:
    push hl
    pop ix
    or a
    sbc hl,bc
    jr z,.end                   ; back at the start
    ld e,(ix+View_flags)
.test:
    ld a,e
    and 7
    dec a
    jr nz,.step
    ld a,d
    or a
    jr z,.found                 ; next: the first candidate
    push ix
    pop iy                      ; previous: remember it, walk on
    jr .step
.end:
    ld a,d
    or a
    jr z,.none
    push iy
    pop ix
    ld a,ixh
    or ixl
    jr z,.none
.found:
    push ix
    pop de
    call K_SETFOCUS
.none:
    pop iy
    pop ix
    ret
