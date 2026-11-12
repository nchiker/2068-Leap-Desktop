; bank5k.asm -- bank5's pool part (docs/BANKING.md 10): included by kern4.asm with BANK5, in chunk 1 after the kernel's second
; part.  K code, reached directly or through K_FAR.  The banked part is bank5.asm.

; XT_K: the K timing target.  t_regs (= XR_K): the register target, run under whatever mapping the crossing chose (it touches
; only hot RAM): records HL, AF, BC, DE, IX, IY and V_SHADOW_F4 in T_IN, then returns HL, AF, BC, DE, IX from T_OUT.
XT_K:
    ret
XR_K:
t_regs:
    ld (T_IN+0),hl
    push af
    pop hl
    ld (T_IN+2),hl
    ld (T_IN+4),bc
    ld (T_IN+6),de
    ld (T_IN+8),ix
    ld (T_IN+10),iy
    ld a,(V_SHADOW_F4)
    ld (T_IN+12),a
    ld hl,(T_OUT+2)
    push hl
    ld bc,(T_OUT+4)
    ld de,(T_OUT+6)
    ld ix,(T_OUT+8)
    ld hl,(T_OUT+0)
    pop af
    ret

; The K callers (10.3): CT_K<to> cross to the timing target, CR_K<to> to the register target, then RET.
CT_KK:
    KFAR XT_K
    ret
CT_KA:
    KFAR XT_A
    ret
CT_KR:
    KFAR XT_R
    ret
CR_KK:
    KFAR XR_K
    ret
CR_KA:
    KFAR XR_A
    ret
CR_KR:
    KFAR XR_R
    ret

; B5_START: after boot's EI: the self-test (in chunk 2), then idle.
B5_START:
    KFAR B5_MAIN
    jp T_IDLE

; t_record (10.5): the record at RESULT, the marker last.
t_record:
    ld a,(B_FAILK)
    or a
    jr nz,.have
    ld hl,(V_IRQA)
    ld a,h
    or l
    ld a,5
    jr z,.set
    ld hl,(V_IRQR)
    ld a,h
    or l
    ld a,6
    jr z,.set
    xor a
.set:
    ld (B_FAILK),a
.have:
    ld (R_KIND),a
    ld b,1
    or a
    jr z,.state
    inc b
.state:
    ld a,b
    ld (R_STATE),a
    ld a,(B_FAILP)
    ld (R_PAIR),a
    ld hl,(B_ITER)
    ld (R_ITER),hl
    ld hl,(V_FRAMES)
    ld (R_FRAMES),hl
    ld hl,(V_IRQA)
    ld (R_IRQA),hl
    ld hl,(V_IRQR)
    ld (R_IRQR),hl
    ld hl,(T_LOGN)
    ld (R_LOGN),hl
    ld de,0
    ld hl,T_LOG
    ld bc,$0800
    call t_sumn
    ld (R_LSUM),de
    ld de,0
    ld hl,$4000
    call t_sum
    ld hl,$6000
    call t_sum
    ld (R_DSUM),de
    ld hl,320                   ; the verdict on the screen (10.5), for Fuse
    ld (GA_X),hl
    ld hl,176
    ld (GA_Y),hl
    ld hl,64
    ld (GA_W),hl
    ld hl,8
    ld (GA_H),hl
    call P_SHIELD
    xor a
    call G_SETOP
    ld hl,T_SPASS
    ld a,(R_STATE)
    dec a
    jr z,.str
    ld hl,T_SFAIL
.str:
    ld (GA+4),hl
    ld hl,7
    ld (GA+6),hl
    call G_TEXTP
    call P_UNSHIELD
    ld hl,$5AA5
    ld (RESULT),hl
    ret

T_SPASS:
    DB "B0 PASS"
T_SFAIL:
    DB "B0 FAIL"

; t_sum: DE += the $1800 bytes from HL.  t_sumn: BC bytes.  Clobbers AF, BC, HL.
t_sum:
    ld bc,$1800
t_sumn:
    ld a,(hl)
    add a,e
    ld e,a
    jr nc,.n
    inc d
.n:
    inc hl
    dec bc
    ld a,b
    or c
    jr nz,t_sumn
    ret
