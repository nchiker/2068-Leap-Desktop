; send.asm -- K_SEND, the message dispatcher (docs/OBJECTS_EVENTS.md section 3).  Assembled at $0008 so programs send with RST $08;
; it runs on into $0010-$0015, so RST $10 is not available.
;   In:  IX = self, A = message number, BC and DE = arguments.
;   Out: jumps to the method with IX, IY, BC, DE unchanged; A, F, HL undefined.  The method's RET returns to the sender.
; The class pointer (IX+0) points at method 0; the generator keeps each method table inside one page, so INC L is enough.
; 87 T from the RST to the method's first instruction.

K_SEND:
    ld l,(ix+0)
    ld h,(ix+1)                 ; HL = the class (its method table)
    add a,a
    add a,l
    ld l,a                      ; HL = the method's slot
    ld a,(hl)
    inc l
    ld h,(hl)
    ld l,a
    jp (hl)
K_SEND_END:
