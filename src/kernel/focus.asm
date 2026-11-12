; focus.asm -- event routing, Group, keyboard focus (docs/OBJECTS_EVENTS.md sections 6 and 15).  Included by kernel.asm.

; ---------------------------------------------------------------------------------------------------------------------------
; K_DISPATCH: routes the event in K_EV (section 6).  Preserves IX, IY.  Clobbers AF, BC, DE, HL.
K_DISPATCH:
    push ix
    call .route
    pop ix
    ret
.route:
    ld a,(K_EV)
    cp E_KEY
    jr z,.key
    cp E_DOWN
    jr z,.down
    cp E_MOVE
    jr z,.capt
    cp E_UP
    jr nz,.root
    ld hl,(K_CAPTURE)           ; E_UP: to the capture, which ends
    ld a,h
    or l
    jr z,.root
    ld de,0
    ld (K_CAPTURE),de
    jr k_evto
.down:
    ld hl,0
    ld (K_CAPTURE),hl
.root:
    ld hl,(K_ROOT)
    jr k_evto
.capt:
    ld hl,(K_CAPTURE)           ; E_MOVE: to the capture, else routed from the root
    ld a,h
    or l
    jr z,.root
    jr k_evto
.key:
    ld hl,(K_FOCUS)
    ld a,h
    or l
    jr nz,.bubble
    ld hl,(K_ROOT)
.bubble:
    ld a,h
    or l
    jr z,.default
    push hl
    call k_evto
    pop ix
    ret c                       ; consumed
    ld l,(ix+View_parent)
    ld h,(ix+View_parent+1)
    jr .bubble
.default:                       ; nobody consumed the key: TAB and the arrows move the focus
    ld a,(K_EV+1)
    cp K_TAB
    jp z,K_FOCUSNEXT
    cp K_DOWN
    jp z,K_FOCUSNEXT
    cp K_RIGHT
    jp z,K_FOCUSNEXT
    cp K_BACKTAB
    jp z,K_FOCUSPREV
    cp K_UP
    jp z,K_FOCUSPREV
    cp K_LEFT
    jp z,K_FOCUSPREV
    ret

; k_evto: HL = view or 0 -> M_EVENT (DE = K_EV) to it; carry = consumed.  Clobbers IX.
k_evto:
    ld a,h
    or l
    ret z
    push hl
    pop ix
    ld de,K_EV
    ld a,M_EVENT
    rst $08                     ; RST is a call: the method returns here
    ret

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
group_event:
    ld a,(K_EV)
    sub E_MOVE
    cp E_UP - E_MOVE + 1
    jr c,.ptr                   ; E_MOVE, E_DOWN, E_UP
    or a
    ret
.ptr:
    ld bc,(K_EV+1)              ; C = x low, B = y
    ld e,b
    ld d,0
    ld a,(K_EV+3)
    and 1
    ld b,a                      ; BC = x, DE = y, kept through the loop
    push ix                     ; the group, on the stack until the end
    ld l,(ix+View_child)
    ld h,(ix+View_child+1)
.loop:
    ld a,h
    or l
    jr z,.none
    push hl
    pop ix                      ; IX = the child
    ld a,(ix+View_flags)
    and 6
    jr nz,.skip                 ; hidden or disabled
    ld l,(ix+0)
    ld h,(ix+1)                 ; HL = the class
    ld a,l
    add a,M_HITTEST * 2
    ld l,a                      ; its HitTest slot (a method table never crosses a page)
    ld a,(hl)
    cp view_hittest & $FF
    jr nz,.send
    inc l
    ld a,(hl)
    cp view_hittest >> 8
    jr nz,.send
    ld a,c                      ; view_hittest in place: x - View_x, unsigned, below w; y - View_y below h (D is 0)
    sub (ix+View_x)
    ld l,a
    ld a,b
    sbc a,(ix+View_x+1)
    jr c,.skip
    ld h,a
    ld a,l
    sub (ix+View_w)
    ld a,h
    sbc a,(ix+View_w+1)
    jr nc,.skip
    ld a,e
    sub (ix+View_y)
    jr c,.skip
    cp (ix+View_h)
    jr c,.hit
.skip:
    ld l,(ix+View_next)
    ld h,(ix+View_next+1)
    jr .loop
.send:
    push bc
    push de
    ld a,M_HITTEST
    rst $08
    pop de
    pop bc
    jr c,.hit
    jr .skip
.none:
    pop ix
    or a
    ret
.hit:
    ld a,(K_EV)
    cp E_DOWN
    jr nz,.deliver
    bit 0,(ix+View_flags)
    jr z,.deliver
    push ix
    pop de
    call K_SETFOCUS
.deliver:
    ld de,K_EV
    ld a,M_EVENT
    rst $08
    pop hl                      ; the group (IX stays the child until the capture is set)
    jr nc,.back
    ld a,(K_EV)
    cp E_DOWN
    jr nz,.cons
    ld de,(K_CAPTURE)
    ld a,d
    or e
    jr nz,.cons
    ld (K_CAPTURE),ix
.cons:
    push hl
    pop ix
    scf
    ret
.back:
    push hl
    pop ix
    or a
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
    cp 1
    scf
    ret nz
.ok:
    push ix
    push de
    ld hl,(K_FOCUS)
    ld a,h
    or l
    jr z,.new
    push hl
    pop ix
    ld a,M_BLUR
    rst $08
.new:
    pop hl
    ld (K_FOCUS),hl
    ld a,h
    or l
    jr z,.done
    push hl
    pop ix
    ld a,M_FOCUS
    rst $08
.done:
    pop ix
    or a
    ret

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
