; bank5.asm -- bank5's banked part (docs/BANKING.md 10): code in DOCK chunks 2-3 (mapping A) and 6 (mapping R), and a program's
; RAM image.  Included by kern4.asm with BANK5, after chunk 5.  The pool part is bank5k.asm.

; ===================================================================== DOCK chunk 2 ($4000): A
    ORG $4000

; The A callers (10.3).
CT_AK:
    KFAR XT_K
    ret
CT_AA:
    KFAR XT_A
    ret
CT_AR:
    KFAR XT_R
    ret
CR_AK:
    KFAR XR_K
    ret
CR_AA:
    KFAR XR_A
    ret
CR_AR:
    KFAR XR_R
    ret

; B_BTN (10.4): W_DRAWVIEW of the view IX, from A code.
B_BTN:
    KFAR W_DRAWVIEW
    ret

; The banked methods behind the image's thunks (10.2): each crosses back to the kern4 test method it stands for.
b_wdraw:
    KFAR t_wdraw
    ret
b_cdraw:
    KFAR t_cdraw
    ret
b_focus:
    KFAR t_focus
    ret
b_blur:
    KFAR t_blur
    ret
b_event:                        ; not consumed (4 T before the RET)
    or a
    ret

; B_INIT: the RAM image to its address (boot, interrupts off).  Under A: the image here, the heap at $C000.
B_INIT:
    ld hl,B_IMG
    ld de,B_IMG_ADDR
    ld bc,B_IMG_LEN
    ldir
    ret

; B5_MAIN (10.5): the self-test, entered from B5_START through K_FAR with interrupts on.
B5_MAIN:
    push ix
    push iy
    xor a
    ld (RESULT),a               ; the marker cleared until the record is written
    ld (RESULT+1),a
    ld (B_FAILK),a
    ld (B_FAILP),a
    ld hl,0
    ld (B_ITER),hl
    ld a,$EF                    ; T_STUB: rst $28 / DW caller / ret
    ld (T_STUB),a
    ld a,$C9
    ld (T_STUB+3),a
    call b_upcall
    KFAR B_RDRAW
.iter:
    call b_matrix
    call b_delay
    KFAR B_RDELAY
    ld hl,(B_ITER)
    inc hl
    ld (B_ITER),hl
    ld de,B5_N
    or a
    sbc hl,de
    jr nz,.iter
    KFAR t_record
    pop iy
    pop ix
    ret

; b_delay: about 3.3 k T in A.
b_delay:
    ld b,0
.l:
    djnz .l
    ret

; b_upcall (10.5 step 1): a BWin with a BCtl child, opened and repainted by the kernel through the thunks.
b_upcall:
    ld hl,B_CLWIN
    KFAR K_NEW
    ld (ix+View_x),64
    ld (ix+View_x+1),0
    ld (ix+View_y),40
    ld (ix+View_w),192
    ld (ix+View_w+1),0
    ld (ix+View_h),80
    ld (ix+Window_title),LOW B_TITLE
    ld (ix+Window_title+1),HIGH B_TITLE
    ld (ix+TWin_tag),1
    push ix
    ld hl,B_CLCTL
    KFAR K_NEW
    ld (ix+View_x),80
    ld (ix+View_x+1),0
    ld (ix+View_y),64
    ld (ix+View_w),64
    ld (ix+View_w+1),0
    ld (ix+View_h),16
    ld (ix+TCtl_tag),2
    push ix
    pop de                      ; DE = the control
    pop ix                      ; IX = the window
    KFAR K_ADDCHILD
    KFAR W_OPEN
    KFAR W_UPDATE
    ret

; b_matrix (10.5 step 3): the 9 register callers through T_STUB.  Failure kinds: 1 outputs, 2 inputs at the target, 3 the
; mapping at the target, 4 the mapping after the return.  The first failure is kept (B_FAILK, B_FAILP).
b_matrix:
    push ix
    push iy
    xor a
    ld (B_IDX),a
.pair:
    ld a,(B_IDX)
    ld l,a
    add a,a
    add a,l
    ld e,a
    ld d,0
    ld hl,B_PAIRS
    add hl,de
    ld e,(hl)
    inc hl
    ld d,(hl)
    inc hl
    ld a,(hl)
    ld (B_EXP),a
    ld (T_STUB+1),de
    ld a,(B_IDX)                ; T_OUT: 10 bytes from (16 idx + iteration) in steps of 37
    rlca
    rlca
    rlca
    rlca
    ld hl,B_ITER
    add a,(hl)
    ld hl,T_OUT
    ld b,10
.fo:
    ld (hl),a
    inc hl
    add a,37
    djnz .fo
    ld hl,T_IN
    ld b,14
    xor a
.fi:
    ld (hl),a
    inc hl
    djnz .fi
    ld a,$5A
    ld bc,$1234
    ld de,$5678
    ld hl,$9ABC
    ld ix,$DEF0
    ld iy,$1357
    call T_STUB
    ld (B_GOT),hl
    push af
    pop hl
    ld (B_GOT+2),hl
    ld (B_GOT+4),bc
    ld (B_GOT+6),de
    ld (B_GOT+8),ix
    ld a,(V_SHADOW_F4)
    cp F4_A
    ld c,4
    jr nz,.fail
    ld hl,T_OUT
    ld de,B_GOT
    ld b,10
    ld c,1
.co:
    ld a,(de)
    cp (hl)
    jr nz,.fail
    inc hl
    inc de
    djnz .co
    ld a,(B_EXP)
    ld hl,T_IN+12
    cp (hl)
    ld c,3
    jr nz,.fail
    ld hl,B_INS
    ld de,T_IN
    ld b,12
    ld c,2
.ci:
    ld a,e
    cp LOW (T_IN+2)             ; F is not an input
    jr z,.skip
    ld a,(de)
    cp (hl)
    jr nz,.fail
.skip:
    inc hl
    inc de
    djnz .ci
.next:
    ld a,(B_IDX)
    inc a
    ld (B_IDX),a
    cp 9
    jp c,.pair
    pop iy
    pop ix
    ret
.fail:
    ld a,(B_FAILK)
    or a
    jr nz,.next
    ld a,c
    ld (B_FAILK),a
    ld a,(B_IDX)
    ld (B_FAILP),a
    jr .next

B_PAIRS:                        ; the register caller, the mapping its target must run under
    DW CR_KK
    DB F4_K
    DW CR_KA
    DB F4_A
    DW CR_KR
    DB F4_R
    DW CR_AK
    DB F4_K
    DW CR_AA
    DB F4_A
    DW CR_AR
    DB F4_R
    DW CR_RK
    DB F4_K
    DW CR_RA
    DB F4_A
    DW CR_RR
    DB F4_R
B_INS:                          ; T_IN as the target must see it: HL, (F), A, BC, DE, IX, IY
    DB $BC, $9A, 0, $5A, $34, $12, $78, $56, $F0, $DE, $57, $13

; The RAM image (10.2): assembled for $C000, copied there by B_INIT.  The app arena starts at $C100.
B_IMG:
    DISP B_IMG_ADDR
    DW CL_Window
    DB 200, 6, TWin_SIZE, 10
B_CLWIN:
    DW window_destroy, B_THWDRAW, window_event, view_hittest, B_THFOCUS, B_THBLUR
    DW CL_View
    DB 201, 6, TCtl_SIZE, 10
B_CLCTL:
    DW view_destroy, B_THCDRAW, B_THEVENT, view_hittest, B_THFOCUS, B_THBLUR
B_THWDRAW:
    KTHUNK b_wdraw
B_THCDRAW:
    KTHUNK b_cdraw
B_THEVENT:
    KTHUNK b_event
B_THFOCUS:
    KTHUNK b_focus
B_THBLUR:
    KTHUNK b_blur
B_TITLE:
    DB 6, "Banked"
    ENT
B_IMG_LEN   EQU $ - B_IMG
    ASSERT B_IMG_LEN <= 256 && (B_CLWIN >> 8) == ((B_CLWIN + 11) >> 8) && (B_CLCTL >> 8) == ((B_CLCTL + 11) >> 8)
    ASSERT $ <= $6000           ; chunk 2 only

; ===================================================================== DOCK chunk 3 ($6000): A
    ORG $6000
XT_A:
    ret
XR_A:
    jp t_regs
    ASSERT $ <= $8000

; ===================================================================== DOCK chunk 6 ($C000): R
    ORG $C000
XT_R:
    ret
XR_R:
    jp t_regs
CT_RK:
    KFAR XT_K
    ret
CT_RA:
    KFAR XT_A
    ret
CT_RR:
    KFAR XT_R
    ret
CR_RK:
    KFAR XR_K
    ret
CR_RA:
    KFAR XR_A
    ret
CR_RR:
    KFAR XR_R
    ret

; B_RDELAY: about 3.3 k T in R.
B_RDELAY:
    ld b,0
.l:
    djnz .l
    ret

; B_RDRAW (10.5 step 2): draws B_RSTR from this chunk straight onto the display at (16, 176), shielded, clip the whole screen.
B_RDRAW:
    ld hl,0
    ld (GA_X),hl
    ld (GA_Y),hl
    ld hl,512
    ld (GA_W),hl
    ld hl,192
    ld (GA_H),hl
    call G_SETCLIP
    ld hl,16
    ld (GA_X),hl
    ld hl,176
    ld (GA_Y),hl
    ld hl,192
    ld (GA_W),hl
    ld hl,8
    ld (GA_H),hl
    call P_SHIELD
    xor a
    call G_SETOP
    ld hl,B_RSTR
    ld (GA+4),hl
    ld hl,B_RSTR_N
    ld (GA+6),hl
    call G_TEXTP
    jp P_UNSHIELD
B_RSTR:
    DB "Drawn from DOCK chunk 6"
B_RSTR_N    EQU $ - B_RSTR
    ASSERT $ <= $E000
