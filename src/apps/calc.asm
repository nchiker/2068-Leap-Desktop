; calc.asm -- Calculator, the first banked application (docs/CALCULATOR.md).  Code in DOCK chunks 2-3 (mapping A); its RAM
; image (classes, thunk, strings, menu table, variables) is assembled for C_IMG_ADDR ($C000) and copied there by C_INIT.
; Kernel calls go through KFAR, except the A-direct K_GETEV and K_NEW (docs/BANKING.md 11.1).  Nothing here touches $4000-$7FFF
; as data.

NS          EQU 0               ; a number record: sign (0 +, 1 -)
ND          EQU 1               ; d, the digits after the point (0..7)
NM          EQU 2               ; M, 32 bits little-endian (< 10^8)

    ORG $4000

; C_START: program 1 (docs/SHELL.md 5, 10.3): the image, the window (a CWindow: its close box quits to the shell; no menu), the
; mouse, then the event loop.  Never returns.
C_START:
    ld hl,C_IMG
    ld de,C_IMG_ADDR
    ld bc,C_IMG_LEN
    ldir
    call c_build
    ld ix,(C_WIN)
    KFAR W_OPEN
    ld a,1
    KFAR K_MSET
    ld a,27
    call C_KEY
c_loop:
    call K_GETEV
    jr nc,.ev
    halt
    jr c_loop
.ev:
    cp E_KEY
    jr nz,.notkey
    ld a,(K_EV+1)
    call c_iskey
    jr nc,.disp
    ld a,(K_EV+1)
    jr .key
.notkey:
    cp E_CMD
    jr nz,.disp
    ld a,(K_EV+1)
    cp C_WINID
    jr nz,.key
    KFAR K_QUIT                 ; the close box (or SYMBOL SHIFT + Q): back to the shell
.key:
    call C_KEY
    ld ix,(C_DISP)
    KFAR W_DRAWVIEW
    jr c_loop
.disp:
    KFAR TK_DISPATCH
    jr c_loop

C_WINID     EQU 255             ; the window's View_id: its close posts E_CMD with it

; c_iskey: A = a key code -> carry when it is a Calculator key (section 5).  Clobbers F, BC, HL.
c_iskey:
    ld hl,C_KEYS
    ld b,C_KEYS_N
.l:
    cp (hl)
    scf
    ret z
    inc hl
    djnz .l
    or a
    ret
C_KEYS:
    DB "0123456789.+-*/=", 13, 12, 27, 3, "cen"
C_KEYS_N    EQU $ - C_KEYS

; c_build (section 4): the window, the display and the 20 buttons in the app arena.
c_build:
    ld hl,C_TWIN                ; the window and the display (the library's view table, APPLIB 3)
    call AL_NEW
    ld (C_WIN),ix
    call AL_VIEW
    ld (C_DISP),de
    xor a
    ld (C_I),a
.b:
    ld hl,CL_Button
    call K_NEW
    ld a,(C_I)                  ; x = 172 + 40 (i AND 3)
    and 3
    ld l,a
    add a,a
    add a,a
    add a,l                     ; 5 c
    add a,a
    add a,a
    add a,a                     ; 40 c
    ld l,a
    ld h,0
    ld de,172
    add hl,de
    ld (ix+View_x),l
    ld (ix+View_x+1),h
    ld a,(C_I)                  ; y = 64 + 20 (i >> 2)
    and $FC
    ld l,a
    add a,a
    add a,a
    add a,l                     ; 20 (i >> 2) = 5 (i AND $FC)
    add a,64
    ld (ix+View_y),a
    ld (ix+View_w),32
    ld (ix+View_w+1),0
    ld (ix+View_h),16
    ld (ix+View_flags),1        ; focusable
    ld a,(C_I)
    ld l,a
    add a,a
    add a,l
    ld l,a
    ld h,0
    ld de,C_BTNS
    add hl,de                   ; the button's entry: id, text
    ld a,(hl)
    ld (ix+View_id),a
    inc hl
    ld a,(hl)
    ld (ix+Button_text),a
    inc hl
    ld a,(hl)
    ld (ix+Button_text+1),a
    ld hl,C_WIN
    call AL_ADD
    ld hl,C_I
    inc (hl)
    ld a,(hl)
    cp 20
    jr c,.b
    ret

C_TWIN:                         ; the window (a CWindow, section 4) and the display: APPLIB 3 entries
    DW CL_CWindow, 160
    DB 24
    DW 176
    DB 144, 0, C_WINID, 8
    DW C_TITLE
    DW CL_CDisp, 168
    DB 40
    DW 160
    DB 16, 0, 0, 0
    DW 0

C_BTNS:                         ; id, text: rows of 4 (section 4)
    DB 27
    DW C_SC
    DB 'e'
    DW C_SCE
    DB 'n'
    DW C_SNEG
    DB '/'
    DW C_SDIV
    DB '7'
    DW C_S7
    DB '8'
    DW C_S8
    DB '9'
    DW C_S9
    DB '*'
    DW C_SMUL
    DB '4'
    DW C_S4
    DB '5'
    DW C_S5
    DB '6'
    DW C_S6
    DB '-'
    DW C_SSUB
    DB '1'
    DW C_S1
    DB '2'
    DW C_S2
    DB '3'
    DW C_S3
    DB '+'
    DW C_SADD
    DB '0'
    DW C_S0
    DB '.'
    DW C_SPT
    DB 12
    DW C_SDEL
    DB '='
    DW C_SEQ

; ---------------------------------------------------------------------------------------------------------------------------
; cd_draw: CDisp's M_DRAW (section 4), IX = the display.  Every drawing call crosses into K.
cd_draw:
    call cd_rect
    ld a,1
    KFAR G_SETOP                ; CLR
    KFAR G_FILL
    xor a
    KFAR G_SETOP                ; SET
    KFAR G_FRAME                ; GA overwritten
    ld hl,C_DSTR+1
    ld (GA+4),hl
    ld a,(C_DSTR)
    ld l,a
    ld h,0
    ld (GA+6),hl
    KFAR G_TEXTW                ; HL = tw
    ex de,hl
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    ld c,(ix+View_w)
    ld b,(ix+View_w+1)
    add hl,bc
    ld bc,4
    or a
    sbc hl,bc
    sbc hl,de                   ; x + w - 4 - tw
    ld (GA_X),hl
    ld a,(ix+View_y)
    add a,4
    ld l,a
    ld h,0
    ld (GA_Y),hl                ; GA+4 / GA+6 still hold the string (G_TEXTW only reads them)
    KFAR G_TEXTP
    ret
cd_rect:                        ; GA = the view's rectangle
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    ld (GA_X),hl
    ld l,(ix+View_y)
    ld h,0
    ld (GA_Y),hl
    ld l,(ix+View_w)
    ld h,(ix+View_w+1)
    ld (GA_W),hl
    ld l,(ix+View_h)
    ld h,0
    ld (GA_H),hl
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; C_KEY (section 5): A = a key code -> the state changed, C_DSTR = what the display shows.  Preserves IX and IY.
C_KEY:
    push ix
    push iy
    call c_key1
    pop iy
    pop ix
    ret
c_key1:
    ld (C_KC),a
    ld c,a
    ld a,(C_ERR)
    or a
    jr z,.live
    ld a,c
    cp 27
    jp z,c_clear
    cp 3
    jp z,c_clear
    cp 'c'
    jp z,c_clear
    cp 'e'
    jp z,c_clear
    ret
.live:
    ld a,c
    cp '0'
    jr c,.notdig
    cp '9' + 1
    jp c,c_digit
.notdig:
    cp '.'
    jp z,c_point
    cp 12
    jp z,c_bs
    cp 'n'
    jp z,c_neg
    cp '+'
    jp z,c_oper
    cp '-'
    jp z,c_oper
    cp '*'
    jp z,c_oper
    cp '/'
    jp z,c_oper
    cp '='
    jp z,c_equals
    cp 13
    jp z,c_equals
    cp 27
    jp z,c_clear
    cp 3
    jp z,c_clear
    cp 'c'
    jp z,c_clear
    cp 'e'
    jp z,c_ce
    ret

c_clear:                        ; C: X = 0, OP none, ENT 0, ERR 0
    ld hl,C_X
    ld b,6
    xor a
.z:
    ld (hl),a
    inc hl
    djnz .z
    ld (C_OP),a
    ld (C_ENT),a
    ld (C_ERR),a
    jp c_show

c_ce:                           ; CE: E = "0", ENT = 1
    call c_ezero0
    jp c_show

c_ezero0:                       ; E = "0", ENT = 1
    ld hl,C_E
    ld (hl),1
    inc hl
    ld (hl),'0'
    ld a,1
    ld (C_ENT),a
    ret

c_digit:
    ld a,(C_ENT)
    or a
    jr nz,.d1
    xor a
    ld (C_E),a
    inc a
    ld (C_ENT),a
.d1:
    call c_eiszero              ; Z: E is "0" or "-0"
    jr nz,.d2
    ld a,(C_E)                  ; the 0 replaced
    ld e,a
    ld d,0
    ld hl,C_E
    add hl,de
    ld a,(C_KC)
    ld (hl),a
    jp c_show
.d2:
    call c_edigits
    cp 8
    jp nc,c_show
    ld a,(C_KC)
    call c_eappend
    jp c_show

c_point:
    ld a,(C_ENT)
    or a
    jr nz,.p1
    ld hl,C_E
    ld (hl),2
    inc hl
    ld (hl),'0'
    inc hl
    ld (hl),'.'
    ld a,1
    ld (C_ENT),a
    jp c_show
.p1:
    call c_ehaspt
    jp z,c_show
    ld a,'.'
    call c_eappend
    jp c_show

c_bs:                           ; back space, only while ENT
    ld a,(C_ENT)
    or a
    jp z,c_show
    ld hl,C_E
    dec (hl)
    jr z,.zero
    ld a,(hl)
    cp 1
    jp nz,c_show
    inc hl
    ld a,(hl)
    cp '-'
    jp nz,c_show
.zero:
    call c_ezero0
    jp c_show

c_neg:
    ld a,(C_ENT)
    or a
    jr z,.x
    ld a,(C_E+1)
    cp '-'
    jr nz,.add
    ld a,(C_E)                  ; remove the leading '-'
    dec a
    ld (C_E),a
    ld c,a
    ld b,0
    ld hl,C_E+2
    ld de,C_E+1
    ldir                        ; (E's length is at least 1 after the '-')
    jp c_show
.add:
    ld a,(C_E)                  ; insert a '-' in front
    ld c,a
    ld b,0
    ld hl,C_E
    add hl,bc                   ; HL -> the last character
    ld d,h
    ld e,l
    inc de
    lddr
    ld a,'-'
    ld (C_E+1),a
    ld hl,C_E
    inc (hl)
    jp c_show
.x:
    ld hl,C_X+NM                ; X = -X (0 stays +)
    call c_isz32
    jp z,c_show
    ld a,(C_X+NS)
    xor 1
    ld (C_X+NS),a
    jp c_show

c_oper:
    ld a,(C_ENT)
    or a
    jr z,.set
    call c_eval                 ; Y = the value of E
    ld a,(C_OP)
    or a
    jr z,.first
    call c_arith
    jr .done
.first:
    ld hl,C_Y
    ld de,C_X
    ld bc,6
    ldir
.done:
    xor a
    ld (C_ENT),a
.set:
    ld a,(C_KC)
    ld (C_OP),a
    jp c_show

c_equals:
    ld a,(C_OP)
    or a
    jr z,.noop
    ld a,(C_ENT)
    or a
    jr z,.usex
    call c_eval
    jr .go
.usex:
    ld hl,C_X
    ld de,C_Y
    ld bc,6
    ldir
.go:
    call c_arith
    xor a
    ld (C_OP),a
    ld (C_ENT),a
    jp c_show
.noop:
    ld a,(C_ENT)
    or a
    jp z,c_show
    call c_eval
    ld hl,C_Y
    ld de,C_X
    ld bc,6
    ldir
    xor a
    ld (C_ENT),a
    jp c_show

; c_show: C_DSTR = "Error", E, or the format of X.
c_show:
    ld a,(C_ERR)
    or a
    jr z,.ok
    ld hl,C_SERR
    ld de,C_DSTR
    ld bc,6
    ldir
    ret
.ok:
    ld a,(C_ENT)
    or a
    jp z,c_fmt
    ld hl,C_E
    ld de,C_DSTR
    ld a,(hl)
    inc a
    ld c,a
    ld b,0
    ldir
    ret
C_SERR:
    DB 5, "Error"

; E helpers.  c_eappend: A appended.  c_eiszero: Z when E is "0" or "-0".  c_edigits: A = E's digits.  c_ehaspt: Z when E has
; a '.'.  All clobber AF, BC, DE, HL.
c_eappend:
    ld hl,C_E
    inc (hl)
    ld e,(hl)
    ld d,0
    add hl,de
    ld (hl),a
    ret
c_eiszero:
    ld hl,C_E
    ld a,(hl)
    inc hl
    cp 1
    jr z,.one
    cp 2
    ret nz
    ld a,(hl)
    cp '-'
    ret nz
    inc hl
.one:
    ld a,(hl)
    cp '0'
    ret
c_edigits:
    ld hl,C_E
    ld b,(hl)
    ld c,0
    ld a,b
    or a
    ret z                       ; E = "": 0 digits
.l:
    inc hl
    ld a,(hl)
    sub '0'
    cp 10
    jr nc,.n
    inc c
.n:
    djnz .l
    ld a,c
    ret
c_ehaspt:
    ld hl,C_E
    ld b,(hl)
.l:
    inc hl
    ld a,(hl)
    cp '.'
    ret z
    djnz .l
    or a                        ; NZ ('.' is not 0)
    ret

; c_isz32: Z when the 32 bits at HL are 0.
c_isz32:
    ld a,(hl)
    inc hl
    or (hl)
    inc hl
    or (hl)
    inc hl
    or (hl)
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; Numbers (section 6).  c_eval: Y = the value of E.
c_eval:
    ld hl,C_N
    call q_zero
    xor a
    ld (C_S),a
    ld (C_FD),a
    ld (C_PT),a
    ld hl,C_E
    ld b,(hl)
.l:
    inc hl
    ld a,(hl)
    cp '-'
    jr nz,.np
    ld a,1
    ld (C_S),a
    jr .nx
.np:
    cp '.'
    jr nz,.dg
    ld a,1
    ld (C_PT),a
    jr .nx
.dg:
    sub '0'
    push bc
    push hl
    push af
    ld hl,C_N
    call q_mul10
    pop af
    ld hl,C_N
    call q_addb
    pop hl
    pop bc
    ld a,(C_PT)
    or a
    jr z,.nx
    ld a,(C_FD)
    inc a
    ld (C_FD),a
.nx:
    djnz .l
    call c_norm
    ld de,C_Y
    jp c_store

; c_arith: X = X OP Y, or ERR.
c_arith:
    ld a,(C_Y+NS)
    ld c,a
    ld a,(C_X+NS)
    xor c
    ld (C_S),a                  ; the sign of a product or a quotient
    ld a,(C_OP)
    cp '*'
    jp z,.mul
    cp '/'
    jp z,.div
    cp '-'                      ; + or -: Y's sign, flipped for -
    ld a,c
    jr nz,.s2
    xor 1
.s2:
    ld (C_SY),a
    ld a,(C_X+ND)               ; dm = max(d1, d2)
    ld b,a
    ld a,(C_Y+ND)
    cp b
    jr nc,.dm
    ld a,b
.dm:
    ld (C_DM),a
    ld hl,C_X
    ld de,C_N
    call c_ldm
    ld a,(C_X+ND)
    ld b,a
    ld a,(C_DM)
    sub b
    ld hl,C_N
    call q_p10                  ; N = M1 10^(dm - d1)
    ld hl,C_Y
    ld de,C_B
    call c_ldm
    ld a,(C_Y+ND)
    ld b,a
    ld a,(C_DM)
    sub b
    ld hl,C_B
    call q_p10                  ; B = M2 10^(dm - d2)
    ld a,(C_DM)
    ld (C_FD),a                 ; the exact result is N / 10^dm
    ld a,(C_X+NS)
    ld c,a
    ld a,(C_SY)
    cp c
    jr nz,.diff
    ld (C_S),a
    ld de,C_N
    ld hl,C_B
    call q_add
    jp c_scale
.diff:
    ld de,C_N
    ld hl,C_B
    call q_cmp
    jr c,.less
    ld a,(C_X+NS)
    ld (C_S),a
    ld de,C_N
    ld hl,C_B
    call q_sub
    jp c_scale
.less:
    ld a,(C_SY)
    ld (C_S),a
    ld de,C_B
    ld hl,C_N
    call q_sub
    ld hl,C_B
    ld de,C_N
    call q_copy
    jp c_scale
.mul:
    call c_mul                  ; N = M1 M2: the exact result is N / 10^(d1 + d2)
    ld a,(C_X+ND)
    ld b,a
    ld a,(C_Y+ND)
    add a,b
    ld (C_FD),a
    jp c_scale

.div:
    ld hl,C_Y+NM
    call c_isz32
    jr nz,.d1
    ld a,1
    ld (C_ERR),a
    ret
.d1:
    ld hl,C_X
    ld de,C_N
    call c_ldm
    ld a,(C_Y+ND)
    ld hl,C_N
    call q_p10                  ; N = M1 10^d2
    ld hl,C_Y
    ld de,C_D
    call c_ldm
    ld a,(C_X+ND)
    ld hl,C_D
    call q_p10                  ; D = M2 10^d1
    jp c_round

; c_round: X = round(N / D) with sign C_S (section 6), or ERR.
c_round:
    call q_divmod               ; N = q0, R = the remainder
    ld de,C_N
    ld hl,C_P8
    call q_cmp
    jr c,.ok
    jp c_err
.ok:
    ld hl,C_P                   ; k = q0's digits
    call q_one
    xor a
    ld (C_K),a
.k:
    ld de,C_N
    ld hl,C_P
    call q_cmp
    jr c,.kd
    ld hl,C_K
    inc (hl)
    ld hl,C_P
    call q_mul10
    jr .k
.kd:
    ld a,(C_K)                  ; f = 7 when q0 = 0, else 8 - k
    or a
    ld a,7
    jr z,.f
    ld a,(C_K)
    ld b,a
    ld a,8
    sub b
.f:
    ld (C_FD),a
    or a
    jr z,.rnd
    ld (C_CNT2),a
.g:                             ; the next digit: R = 10 R, digit = R / D
    ld hl,C_R
    call q_mul10
    ld c,0
.s:
    push bc
    ld de,C_R
    ld hl,C_D
    call q_cmp
    pop bc
    jr c,.sd
    push bc
    ld de,C_R
    ld hl,C_D
    call q_sub
    pop bc
    inc c
    jr .s
.sd:
    push bc
    ld hl,C_N
    call q_mul10
    pop bc
    ld a,c
    ld hl,C_N
    call q_addb
    ld hl,C_CNT2
    dec (hl)
    jr nz,.g
.rnd:                           ; 2 R >= D: round up
    ld hl,C_R
    call q_shl
    ld de,C_R
    ld hl,C_D
    call q_cmp
    jr c,.nr
    ld a,1
    ld hl,C_N
    call q_addb
.nr:
    ld de,C_N                   ; M = 10^8: one digit fewer, or ERR
    ld hl,C_P8
    call q_cmp
    jr nz,.store
    ld a,(C_FD)
    or a
    jp z,c_err
    dec a
    ld (C_FD),a
    ld hl,C_N
    call q_div10
.store:
    call c_norm
    ld de,C_X
    jp c_store

; c_scale: X = the exact N / 10^C_FD (C_FD <= 14) rounded (section 6), sign C_S, or ERR.  Digits are dropped from the right
; until d <= 7 and N < 10^8; the last digit dropped (the most significant one) rounds half away from zero.
c_scale:
    xor a
    ld (C_K),a                  ; the last digit dropped
.l:
    ld a,(C_FD)
    cp 8
    jr nc,.cut                  ; d > 7
    ld de,C_N
    ld hl,C_P8
    call q_cmp
    jr c,.fit                   ; N < 10^8
    ld a,(C_FD)
    or a
    jp z,c_err
.cut:
    ld hl,C_N
    call q_div10
    ld (C_K),a
    ld hl,C_FD
    dec (hl)
    jr .l
.fit:
    ld a,(C_K)
    cp 5
    jp c,c_round.store
    ld a,1
    ld hl,C_N
    call q_addb
    jp c_round.nr

c_err:                          ; ERR set
    ld a,1
    ld (C_ERR),a
    ret

; c_norm: N, C_FD, C_S in normal form (no trailing zeros after the point; 0 is +).
c_norm:
    ld a,(C_FD)
    or a
    jr z,.z
    ld hl,C_N
    ld de,C_Q
    call q_copy
    ld hl,C_Q
    call q_div10
    or a
    jr nz,.z
    ld hl,C_Q
    ld de,C_N
    call q_copy
    ld hl,C_FD
    dec (hl)
    jr c_norm
.z:
    ld hl,C_N
    call q_isz
    ret nz
    xor a
    ld (C_S),a
    ret

; c_store: DE = a record <- C_S, C_FD, N's low 32 bits.
c_store:
    ld a,(C_S)
    ld (de),a
    inc de
    ld a,(C_FD)
    ld (de),a
    inc de
    ld hl,C_N
    ld bc,4
    ldir
    ret

; c_ldm: HL = a record -> DE = its M as 64 bits.
c_ldm:
    inc hl
    inc hl
    ld bc,4
    ldir
    xor a
    ld b,4
.z:
    ld (de),a
    inc de
    djnz .z
    ret

; c_mul: N = X's M times Y's M (shift and add; A = the multiplicand, W = the multiplier).
c_mul:
    ld hl,C_X
    ld de,C_A
    call c_ldm
    ld hl,C_Y+NM
    ld de,C_W
    ld bc,4
    ldir
    ld hl,C_N
    call q_zero
.l:
    ld hl,C_W                   ; done when W is 0
    call c_isz32
    ret z
    ld hl,C_W+3                 ; W >>= 1, carry = the bit
    ld b,4
    or a
.r:
    rr (hl)
    dec hl
    djnz .r
    jr nc,.n
    ld de,C_N
    ld hl,C_A
    call q_add
.n:
    ld hl,C_A
    call q_shl
    jr .l

; c_fmt: C_DSTR = the format of X (section 6).
c_fmt:
    ld hl,C_X
    ld de,C_Q
    call c_ldm
    ld de,C_DIG                 ; 8 digits, the lowest first
    ld b,8
.d:
    push bc
    push de
    ld hl,C_Q+3
    ld b,4
    call q_div10t
    pop de
    ld (de),a
    inc de
    pop bc
    djnz .d
    ld b,8                      ; n = the significant digits (at least 1)
    ld hl,C_DIG+7
.n:
    ld a,(hl)
    or a
    jr nz,.nd
    dec hl
    djnz .n
    ld b,1
.nd:
    ld a,(C_X+ND)               ; total = max(n, d + 1)
    inc a
    cp b
    jr c,.t
    ld b,a
.t:
    ld de,C_DSTR+1
    ld c,0
    ld a,(C_X+NS)
    or a
    jr z,.p
    ld a,'-'
    ld (de),a
    inc de
    inc c
.p:
    ld a,b
    dec a
.o:
    ld (C_I),a
    ld a,(C_X+ND)               ; the point before digit d - 1
    or a
    jr z,.nopt
    dec a
    ld hl,C_I
    cp (hl)
    jr nz,.nopt
    ld a,'.'
    ld (de),a
    inc de
    inc c
.nopt:
    ld a,(C_I)
    ld hl,C_DIG
    add a,l
    ld l,a
    adc a,h
    sub l
    ld h,a
    ld a,(hl)
    add a,'0'
    ld (de),a
    inc de
    inc c
    ld a,(C_I)
    or a
    jr z,.e
    dec a
    jr .o
.e:
    ld a,c
    ld (C_DSTR),a
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; 64-bit helpers (8-byte little-endian buffers in the image).  All clobber AF, BC, DE, HL unless stated.
q_zero:                         ; (HL) = 0
    ld b,8
    xor a
.l:
    ld (hl),a
    inc hl
    djnz .l
    ret
q_one:                          ; (HL) = 1
    push hl
    call q_zero
    pop hl
    ld (hl),1
    ret
q_copy:                         ; (DE) = (HL)
    ld bc,8
    ldir
    ret
q_add:                          ; (DE) += (HL)
    ld b,8
    or a
.l:
    ld a,(de)
    adc a,(hl)
    ld (de),a
    inc de
    inc hl
    djnz .l
    ret
q_sub:                          ; (DE) -= (HL), carry = borrow
    ld b,8
    or a
.l:
    ld a,(de)
    sbc a,(hl)
    ld (de),a
    inc de
    inc hl
    djnz .l
    ret
q_cmp:                          ; (DE) - (HL): carry when (DE) < (HL), Z when equal
    ld bc,7
    add hl,bc
    ex de,hl
    add hl,bc
    ex de,hl
    ld b,8
.l:
    ld a,(de)
    cp (hl)
    ret nz
    dec de
    dec hl
    djnz .l
    ret
q_shl:                          ; (HL) <<= 1, carry = the bit out
    or a
q_rl:                           ; the same, carry in at bit 0
    ld b,8
.l:
    rl (hl)
    inc hl
    djnz .l
    ret
q_addb:                         ; (HL) += A
    add a,(hl)
    ld (hl),a
    ret nc
    ld b,7
.l:
    inc hl
    inc (hl)
    ret nz
    djnz .l
    ret
q_isz:                          ; Z when (HL) = 0
    ld b,8
    xor a
.l:
    or (hl)
    inc hl
    djnz .l
    ret
q_mul10:                        ; (HL) *= 10 (C_T is scratch)
    push hl
    ld de,C_T
    call q_copy
    pop hl
    push hl
    call q_shl
    pop hl
    push hl
    call q_shl
    pop hl
    push hl
    ex de,hl
    ld hl,C_T
    call q_add
    pop hl
    jp q_shl
q_p10:                          ; (HL) *= 10^A
    or a
    ret z
.l:
    push af
    push hl
    call q_mul10
    pop hl
    pop af
    dec a
    jr nz,.l
    ret
q_div10:                        ; (HL) /= 10, A = the remainder.  Clobbers F, BC, HL
    ld bc,7
    add hl,bc
    ld b,8
q_div10t:                       ; HL -> the top byte, B = the bytes
    xor a
.byte:
    ld c,(hl)
    or a
    jr nz,.go
    or c                        ; remainder 0 and byte 0: the quotient byte is 0
    jr z,.next
    xor a
.go:
    push bc
    ld b,8
.bit:
    sla c
    rla
    cp 10
    jr c,.n
    sub 10
    inc c
.n:
    djnz .bit
    ld (hl),c
    pop bc
.next:
    dec hl
    djnz .byte
    ret
q_divmod:                       ; N = N / D, R = the remainder (D != 0)
    ld hl,C_R
    call q_zero
    ld a,64
    ld (C_CNT),a
.skip:                          ; whole zero bytes at N's top: a byte shift each, 8 bits fewer
    ld a,(C_N+7)
    or a
    jr nz,.l
    ld hl,C_N+6
    ld de,C_N+7
    ld bc,7
    lddr
    xor a
    ld (C_N),a
    ld a,(C_CNT)
    sub 8
    ld (C_CNT),a
    ret z                       ; N was 0
    jr .skip
.l:
    ld hl,C_N
    call q_shl
    ld hl,C_R
    call q_rl
    ld de,C_R
    ld hl,C_D
    call q_cmp
    jr c,.n
    ld de,C_R
    ld hl,C_D
    call q_sub
    ld hl,C_N
    set 0,(hl)
.n:
    ld hl,C_CNT
    dec (hl)
    jr nz,.l
    ret

C_P8:                           ; 10^8
    DD 100000000, 0

; ---------------------------------------------------------------------------------------------------------------------------
; The RAM image (section 2), assembled for C_IMG_ADDR.
C_IMG:
    DISP C_IMG_ADDR
    DW CL_View
    DB 202, 6, View_SIZE, 8
CL_CDisp:                       ; CDisp: a View whose Draw is banked
    DW view_destroy, C_THDRAW, k_nop, view_hittest, k_nop, k_nop
C_THDRAW:
    KTHUNK cd_draw
C_TITLE:    DB 10, "Calculator"
C_SC:       DB 1, "C"
C_SCE:      DB 2, "CE"
C_SNEG:     DB 3, "+/-"
C_SDIV:     DB 1, "/"
C_SMUL:     DB 1, "*"
C_SSUB:     DB 1, "-"
C_SADD:     DB 1, "+"
C_SEQ:      DB 1, "="
C_SPT:      DB 1, "."
C_SDEL:     DB 3, "Del"
C_S0:       DB 1, "0"
C_S1:       DB 1, "1"
C_S2:       DB 1, "2"
C_S3:       DB 1, "3"
C_S4:       DB 1, "4"
C_S5:       DB 1, "5"
C_S6:       DB 1, "6"
C_S7:       DB 1, "7"
C_S8:       DB 1, "8"
C_S9:       DB 1, "9"
; Variables (C_KEY "C" sets the state; the rest is scratch).
C_WIN:      DW 0                ; the window
C_DISP:     DW 0                ; the display view
C_X:        DS 6                ; X: sign, d, M
C_Y:        DS 6                ; Y, the operand
C_OP:       DB 0                ; 0 or '+', '-', '*', '/'
C_ENT:      DB 0
C_ERR:      DB 0
C_KC:       DB 0                ; the key being handled
C_E:        DS 11               ; E: length, then up to 10 characters
C_DSTR:     DS 11               ; the display: length, then up to 10 characters
C_S:        DB 0                ; the result's sign
C_SY:       DB 0                ; Y's sign as added (flipped for -)
C_FD:       DB 0                ; the result's d
C_DM:       DB 0
C_PT:       DB 0
C_K:        DB 0
C_I:        DB 0
C_CNT:      DB 0
C_CNT2:     DB 0
C_DIG:      DS 8
C_W:        DS 4
C_N:        DS 8
C_D:        DS 8
C_R:        DS 8
C_B:        DS 8
C_T:        DS 8
C_Q:        DS 8
C_P:        DS 8
C_A:        DS 8
    ENT
C_IMG_LEN   EQU $ - C_IMG
    ASSERT C_IMG_LEN <= 512 && (CL_CDisp >> 8) == ((CL_CDisp + 11) >> 8)
C_END:
    ASSERT $ <= $8000           ; chunks 2-3
