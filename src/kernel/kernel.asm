; kernel.asm -- Leap Desktop kernel, roadmap step 3 (docs/OBJECTS_EVENTS.md).  Slice K1: arenas and pools, the view tree, the
; base classes' methods.  K_SEND is in send.asm (at $0008).  Included by the cartridge in DOCK chunk 5, starting on a page boundary
; (ZCHAIN must not cross a page).
;
; Conventions (section 5): IY and the alternate set preserved; IX preserved unless an output; no DI or EI.

; ---------------------------------------------------------------------------------------------------------------------------
; Variables (13.5).  Arena record (section 4): +0 top, +2 end, +4 base, +6/+8/+10/+12 free-list heads of the 8/16/24/32-byte
; pools, +14 a word that is always 0 (the "head" of pool 14: classes over 32 bytes).  Records never cross a page: the code steps
; through them with INC L.  Invariant: every byte in [top, end) of an arena is 0 (K_AINIT and K_ARESET zero it; only K_FREE
; writes below top, and only into freed blocks), so a block taken from the top is already zero.
K_VARS      EQU $F050
K_KARENA    EQU $F050           ; the kernel arena's record
K_AARENA    EQU $F060           ; the app arena's record
K_CURA      EQU $F070           ; word: the current arena's record
K_FOCUS     EQU $F072           ; word: the focused view (0 = none)
K_CAPTURE   EQU $F074           ; word: the view that has the pointer (0 = none)
K_ROOT      EQU $F076           ; word: the root view (0 = none)
K_SCRATCH   EQU $F078           ; 8 bytes of kernel scratch

    ASSERT (K_KARENA >> 8) == ((K_ROOT + 1) >> 8)

K_CODE:

; ZCHAIN: zeroes 0..30 bytes at DE upward (A = 0), entered at ZEND - 2 n; ends K_NEW.  13 T a byte.
ZCHAIN:
    DUP 30
    ld (de),a
    inc de
    EDUP
ZEND:
    pop ix                      ; the new instance
    ret                         ; carry clear (K_NEW's XOR A)
    ASSERT (ZCHAIN >> 8) == (ZEND >> 8)

; ---------------------------------------------------------------------------------------------------------------------------
; K_NEW: HL = class -> IX = a new instance (class pointer, then zeros), carry clear; carry set (IX unchanged) when the current
; arena is full.  Clobbers AF, BC, DE, HL.
K_NEW:
    push hl                     ; the class
    dec hl
    ld a,(hl)                   ; pool: the head's offset in the record
    dec hl
    ld b,(hl)                   ; B = instance size
    ld hl,(K_CURA)
    add a,l
    ld l,a                      ; HL -> the pool's head
    ld e,(hl)
    inc l
    ld d,(hl)                   ; DE = the first free block
    ld a,d
    or e
    jr z,.top
    ld a,(de)                   ; head = the block's link
    dec l
    ld (hl),a
    inc de
    ld a,(de)
    inc l
    ld (hl),a
    dec de                      ; DE = the block
    pop hl                      ; HL = class
    ex de,hl                    ; HL = block, DE = class
    push hl                     ; the result, popped into IX at ZEND
    ld (hl),e
    inc hl
    ld (hl),d
    inc hl
    ex de,hl                    ; DE = block + 2
    ld a,(ZEND + 4) & $FF       ; enter ZCHAIN to zero size - 2 bytes
    sub b
    sub b
    ld l,a
    ld h,ZEND >> 8
    xor a
    jp (hl)

.top:                           ; the pool is empty: a fresh block from the arena top (already zero)
    ld a,b
    cp 33
    jr nc,.exact
    add a,7
    and $F8                     ; the pool's block size
.exact:
    ld c,a                      ; C = block size
    ld hl,(K_CURA)
    ld e,(hl)
    inc l
    ld d,(hl)                   ; DE = top = the block
    inc l
    ld a,(hl)
    sub e
    inc l
    ld l,(hl)
    ld h,a                      ; H = low byte of end - top
    ld a,l
    sbc a,d                     ; A = high byte of end - top
    jr nz,.room
    ld a,h
    cp c
    jr c,.full
.room:
    ld hl,(K_CURA)
    ld a,e
    add a,c
    ld (hl),a
    inc l
    ld a,d
    adc a,0
    ld (hl),a                   ; top += block size
    pop hl                      ; HL = class
    ex de,hl                    ; HL = block, DE = class
    ld (hl),e
    inc hl
    ld (hl),d
    dec hl
    push hl
    pop ix
    or a
    ret
.full:
    pop hl
    scf
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; K_FREE (and Object's M_DESTROY): IX = instance.  Back on the head of its pool's free list, in the app arena's record when the
; block is in the app arena, else the kernel arena's.  Pool 14 (over 32 bytes): nothing.  Clobbers AF, BC, DE, HL.
obj_destroy:
K_FREE:
    ld l,(ix+0)
    ld h,(ix+1)
    dec hl
    ld a,(hl)                   ; pool
    cp 14
    ret z
    ld c,a
    push ix
    pop hl                      ; HL = block
    ld de,K_KARENA
    ld a,(K_AARENA+5)           ; app base, high byte (page aligned)
    dec a
    cp h
    jr nc,.k                    ; block below the app arena
    ld a,(K_AARENA+3)           ; app end, high byte
    dec a
    cp h
    jr c,.k                     ; block at or above its end
    ld e,K_AARENA & $FF
.k:
    ld a,e
    add a,c
    ld e,a                      ; DE -> the head
    ex de,hl                    ; HL -> head, DE = block
    ld a,(hl)
    ld (de),a
    ld (hl),e                   ; link low, head low
    inc l
    ld a,(hl)
    ld (hl),d
    inc de
    ld (de),a                   ; link high, head high
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; K_ALLOC: BC = bytes -> HL = a block from the current arena's top (zero), carry clear; carry set when BC > end - top.
; Clobbers AF, BC, DE.
K_ALLOC:
    ld hl,(K_CURA)
    ld e,(hl)
    inc l
    ld d,(hl)                   ; DE = top
    inc l
    ld a,(hl)
    inc l
    ld h,(hl)
    ld l,a                      ; HL = end
    or a
    sbc hl,de
    sbc hl,bc                   ; end - top - BC (end >= top, so the first SBC leaves carry clear)
    ret c
    ld hl,(K_CURA)
    ex de,hl                    ; HL = top, DE -> record
    add hl,bc                   ; HL = new top (no carry: it is <= end)
    ex de,hl
    ld (hl),e
    inc l
    ld (hl),d
    ex de,hl
    sbc hl,bc                   ; HL = the block
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; K_ARENA: HL = arena record -> the current arena.
K_ARENA:
    ld (K_CURA),hl
    ret

; K_AINIT: HL = arena record, DE = base, BC = end (both page aligned, base <= end).  An empty arena, its memory zeroed.
; Clobbers AF, BC, DE, HL.
K_AINIT:
    ld (hl),e
    inc l
    ld (hl),d                   ; top = base
    inc l
    ld (hl),c
    inc l
    ld (hl),b                   ; end
    inc l
    ld (hl),e
    inc l
    ld (hl),d                   ; base
    push bc
    xor a
    ld b,10
.heads:
    inc l
    ld (hl),a                   ; +6..+15
    djnz .heads
    pop hl                      ; HL = end; DE = base
    ; fall into k_zero

; k_zero: zero [DE, HL).  Clobbers AF, BC, DE, HL.
k_zero:
    or a
    sbc hl,de
    ret z
    ld b,h
    ld c,l
    ex de,hl
    ld (hl),0
    dec bc
    ld a,b
    or c
    ret z
    ld d,h
    ld e,l
    inc de
    ldir
    ret

; K_ARESET: HL = arena record.  top = base, free lists empty, memory zeroed; K_FOCUS, K_CAPTURE and K_ROOT become 0 when they
; point into the arena.  Clobbers AF, BC, DE, HL.
K_ARESET:
    ld d,h
    ld e,l                      ; DE -> record
    inc l
    inc l
    inc l
    ld b,(hl)                   ; B = end, high byte
    inc l
    inc l
    ld c,(hl)                   ; C = base, high byte
    ex de,hl
    xor a
    ld (hl),a                   ; top = base (low byte 0)
    inc l
    ld (hl),c
    ld a,l
    add a,5
    ld l,a                      ; HL -> +6
    xor a
    ld e,10
.heads:
    ld (hl),a
    inc l
    dec e
    jr nz,.heads
    ld hl,K_FOCUS
    call .clr
    call .clr
    call .clr
    ld d,c
    ld e,0
    ld h,b
    ld l,e
    jr k_zero
.clr:                           ; HL -> a pointer: 0 when its high byte is in [C, B).  HL += 2
    inc l
    ld a,(hl)
    cp c
    jr c,.keep
    cp b
    jr nc,.keep
    xor a
    ld (hl),a
    dec l
    ld (hl),a
    inc l
.keep:
    inc l
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; K_SETROOT: DE = view or 0 -> K_ROOT; focus and capture cleared.  Clobbers HL.
K_SETROOT:
    ld (K_ROOT),de
    ld hl,0
    ld (K_FOCUS),hl
    ld (K_CAPTURE),hl
    ret

; K_ADDCHILD: IX = parent, DE = child (not linked).  The child becomes the parent's last child.  Clobbers AF, BC, DE, HL.
K_ADDCHILD:
    push de
    ld hl,View_parent
    add hl,de
    push ix
    pop bc
    ld (hl),c
    inc hl
    ld (hl),b                   ; child.parent = IX
    ld hl,View_next
    add hl,de
    xor a
    ld (hl),a
    inc hl
    ld (hl),a                   ; child.next = 0
    push ix
    pop hl
    ld de,View_child
    add hl,de                   ; HL -> the parent's first link
.walk:
    ld e,(hl)
    inc hl
    ld d,(hl)                   ; DE = the link; HL -> its high byte
    ld a,d
    or e
    jr z,.end
    ld hl,View_next
    add hl,de
    jr .walk
.end:
    pop de
    ld (hl),d
    dec hl
    ld (hl),e
    ret

; K_UNLINK: IX = view.  Removed from its parent's list (nothing for a root); its parent and next become 0.  Clobbers AF, BC,
; DE, HL.
K_UNLINK:
    ld l,(ix+View_parent)
    ld h,(ix+View_parent+1)
    ld a,h
    or l
    ret z
    ld de,View_child
    add hl,de                   ; HL -> the parent's first link
    push ix
    pop bc                      ; BC = self
.walk:
    ld e,(hl)
    inc hl
    ld d,(hl)                   ; DE = the link; HL -> its high byte
    ld a,e
    cp c
    jr nz,.next
    ld a,d
    cp b
    jr z,.found
.next:
    ld hl,View_next
    add hl,de
    jr .walk
.found:
    ld a,(ix+View_next+1)
    ld (hl),a
    dec hl
    ld a,(ix+View_next)
    ld (hl),a                   ; the link = self.next
    xor a
    ld (ix+View_parent),a
    ld (ix+View_parent+1),a
    ld (ix+View_next),a
    ld (ix+View_next+1),a
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; Base methods (13.3).

; k_nop: Object's Draw, Event, HitTest, Focus, Blur: nothing, carry clear.
k_nop:
    or a
    ret

; view_destroy: View's M_DESTROY.  Destroys the children (each unlinks itself), unlinks self, clears K_FOCUS / K_CAPTURE /
; K_ROOT that point at self, frees self.  A View subclass's override ends by jumping here.
view_destroy:
    ld l,(ix+View_child)
    ld h,(ix+View_child+1)
    ld a,h
    or l
    jr z,.self
    push ix
    push hl
    pop ix
    ld a,M_DESTROY
    rst $08
    pop ix
    jr view_destroy
.self:
    call K_UNLINK
    push ix
    pop de
    ld hl,K_FOCUS
    call k_clrptr
    call k_clrptr
    call k_clrptr
    jp K_FREE

; k_clrptr: HL -> a pointer: 0 when it equals DE.  HL += 2.  Clobbers AF.
k_clrptr:
    ld a,(hl)
    inc l
    cp e
    jr nz,.no
    ld a,(hl)
    cp d
    jr nz,.no
    xor a
    ld (hl),a
    dec l
    ld (hl),a
    inc l
.no:
    inc l
    ret

; view_hittest: BC = x, DE = y -> carry set when (x, y) is inside the view's rectangle (unsigned differences).
view_hittest:
    ld a,c
    sub (ix+View_x)
    ld l,a
    ld a,b
    sbc a,(ix+View_x+1)
    jr c,.miss
    ld h,a                      ; HL = x - View_x
    ld a,l
    sub (ix+View_w)
    ld a,h
    sbc a,(ix+View_w+1)
    ret nc                      ; >= w: miss, carry clear
    ld a,d
    or a
    jr nz,.miss
    ld a,e
    sub (ix+View_y)
    jr c,.miss
    cp (ix+View_h)              ; carry when y - View_y < h
    ret
.miss:
    or a
    ret

; ---------------------------------------------------------------------------------------------------------------------------
    INCLUDE "classes.inc"

K_CODE_END:
