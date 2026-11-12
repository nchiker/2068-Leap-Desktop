; far.asm -- K_FAR, the far call between the mappings K, A and R (docs/BANKING.md 5.1, 10.1).  The cartridge puts `jp K_FAR` at
; $0028 and includes this file in page 0's hole at $0068, and writes $C3 (JP) at K_FJP at boot.  It needs the cartridge's
; V_SHADOW_F4 and PORT_HSR.
;   Call site:  rst $28 / DW target   (macro KFAR target)
;   In:  A, BC, DE, HL, IX, IY reach the target unchanged; F does not.
;   Out: A, F, BC, DE, HL, IX as the target left them; IY and the alternate set preserved.  Stack: 6 bytes a level.
; The mapping during the target comes from its address: $0000-$3FFF and $8000-$BFFF K, $4000-$7FFF A, $C000-$DFFF R.
; The caller's mapping is restored on return.  Shadow before OUT, both ways (CLAUDE.md); no DI.

F4_K        EQU $33             ; DOCK 0, 1, 4, 5
F4_A        EQU $3F             ; + 2, 3 (over the display)
F4_R        EQU $73             ; + 6 (over the heap)
K_FJP       EQU $F0D0           ; 3 bytes: JP nnnn, the target written by each crossing
K_FA        EQU $F0D3           ; byte: A on entry

; KFAR target: a crossing to target (3 bytes).
    MACRO KFAR target
        ASSERT (target) < $E000
        rst $28
        DW target
    ENDM

; KTHUNK method: a banked method's slot (4 bytes, in a program's RAM image, 5.3).
    MACRO KTHUNK method
        ASSERT ((method) >= $4000 && (method) < $8000) || ((method) >= $C000 && (method) < $E000)
        rst $28
        DW method
        ret
    ENDM

K_FAR:
    ex (sp),hl                  ; HL -> the target word; (SP) = HL in
    ld (K_FA),a
    ld a,(hl)
    ld (K_FJP+1),a
    inc hl
    ld a,(hl)                   ; A = the target's high byte
    ld (K_FJP+2),a
    inc hl                      ; HL = the return address, past the word
    ex (sp),hl                  ; HL = HL in; (SP) = the return address
    add a,a                     ; S = address bit 14, carry = bit 15
    ld a,(V_SHADOW_F4)
    push af                     ; the caller's mapping (A; F is not kept)
    ld a,F4_K
    jp p,.set                   ; bit 14 clear: $0000-$3FFF, $8000-$BFFF
    ld a,F4_A
    jr nc,.set                  ; $4000-$7FFF
    ld a,F4_R                   ; $C000-$DFFF
.set:
    ld (V_SHADOW_F4),a
    out (PORT_HSR),a
    ld a,(K_FA)
    call K_FJP
    ex (sp),hl                  ; H = the caller's mapping; (SP) = HL out
    push af
    ld a,h
    ld (V_SHADOW_F4),a
    out (PORT_HSR),a
    pop af
    pop hl
    ret
K_FAR_END:
