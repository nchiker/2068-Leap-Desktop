; events.asm -- the event queues and the input part of the frame ISR (docs/OBJECTS_EVENTS.md sections 6, 7 and 14).  Included
; by kernel.asm.  The ring has one producer (K_POLL, in the ISR) and one consumer (K_GETEV): each writes only its own index, so
; neither needs DI.  The posted queue belongs to the main program alone.

E_KEY       EQU 1
E_MOVE      EQU 2
E_DOWN      EQU 3
E_UP        EQU 4
E_TIMER     EQU 5
E_REDRAW    EQU 6
E_MENU      EQU 7
E_QUIT      EQU 8
E_MODE      EQU 9

K_RING      EQU $F000           ; 16 records of 4 bytes (page aligned: the index's low 6 bits address a record)
K_POSTQ     EQU $F040           ; 4 records
K_RHEAD     EQU $F080           ; byte: the ring's head (free running, steps of 4), written only by K_GETEV
K_RTAIL     EQU $F081           ; byte: the ring's tail, written only by the ISR (K_RHEAD + 1: one LD HL reads both)
K_PHEAD     EQU $F082
K_PN        EQU $F083
K_LOST      EQU $F084
K_AYREG     EQU $F085           ; the AY register latch's shadow
K_EV        EQU $F086           ; 4 bytes
K_PX        EQU $F08A           ; word
K_PY        EQU $F08C
K_BTN       EQU $F08D
K_KPMODE    EQU $F08E
K_CAPS      EQU $F08F
; K_POLL's internal state (14.1: not part of the interface).  All 0 is the idle state.
K_NOW       EQU $F090           ; 8 bytes: the half-rows as last read (bit set = down)
K_KANY      EQU $F098           ; non-zero when any key was down last time
K_HOLD      EQU $F099           ; acceleration: frames a direction has been held (0..30)
K_RKEY      EQU $F09A           ; the repeating key's index (0 = none: key 0 is CAPS SHIFT, which never repeats)
K_RCODE     EQU $F09B
K_RMODS     EQU $F09C
K_RCNT      EQU $F09D
K_RROW      EQU $F09E           ; low byte of its half-row in K_NOW
K_RMASK     EQU $F09F           ; its bit
K_PEND      EQU $F0A0           ; non-zero while the pointer has not taken K_PX / K_PY
K_WREQ      EQU $F0A1           ; non-zero while a K_WARP is pending
K_WX        EQU $F0A2           ; word
K_WY        EQU $F0A4
K_NEWK      EQU $F0A5           ; a non-modifier key went down this frame
K_MODS      EQU $F0A6           ; bit 0 CS, bit 1 SS (this frame)
K_PLANE     EQU $F0A7           ; 0, 40 or 80
K_OLDM      EQU $F0A8           ; CS / SS (bits 0, 1) last time
K_KPD       EQU $F0A9           ; keyboard-pointer mode's u d l r f this frame (0 outside the mode)
K_TMPK      EQU $F0AA           ; the key being decoded, its half-row and bit
K_TROW      EQU $F0AB
K_TMASK     EQU $F0AC
K_DIRS      EQU $F0AD           ; this frame's u d l r f (bits 0-4)
K_CHG       EQU $F0AE           ; non-zero once a half-row has changed this frame

    ASSERT (K_RING & $FF) == 0 && K_RTAIL == K_RHEAD + 1
    ASSERT (K_NOW >> 8) == ((K_NOW + 7) >> 8)

PORT_AYR    EQU $F5
PORT_AYD    EQU $F6

; ---------------------------------------------------------------------------------------------------------------------------
; K_GETEV: carry set when there is no event.  Else the next event (posted first, then the ring) is copied to K_EV, A = its type,
; carry clear.  Clobbers AF, BC, DE, HL.
K_GETEV:
    ld a,(K_PN)
    or a
    jr nz,.posted
    ld hl,(K_RHEAD)             ; L = head, H = tail, read in one instruction
    ld a,l
    cp h
    scf
    ret z
    and $3F
    ld l,a
    ld h,K_RING >> 8
    ld de,K_EV
    ldi
    ldi
    ldi
    ldi
    ld hl,K_RHEAD
    ld a,(hl)
    add a,4
    ld (hl),a                   ; the record is copied: the ISR may now reuse it
    ld a,(K_EV)
    or a                        ; types are never 0: carry clear
    ret
.posted:
    dec a
    ld (K_PN),a
    ld a,(K_PHEAD)
    ld c,a
    add a,a
    add a,a
    add a,K_POSTQ & $FF
    ld l,a
    ld h,K_POSTQ >> 8
    ld de,K_EV
    ldi
    ldi
    ldi
    ldi
    ld a,c
    inc a
    and 3
    ld (K_PHEAD),a
    ld a,(K_EV)
    or a
    ret

; K_POST: A = type, C, E, D = data 1-3.  Appended to the posted queue; carry set (dropped) when it holds 4.  Clobbers AF, HL.
K_POST:
    ld h,a
    ld a,(K_PN)
    cp 4
    ccf
    ret c
    ld l,a
    ld a,(K_PHEAD)
    add a,l
    and 3
    add a,a
    add a,a
    add a,K_POSTQ & $FF
    ld l,a
    ld a,h
    ld h,K_POSTQ >> 8
    ld (hl),a
    inc l
    ld (hl),c
    inc l
    ld (hl),e
    inc l
    ld (hl),d
    ld hl,K_PN
    inc (hl)
    or a
    ret

; K_WARP: HL = x, DE = y (signed words) -> clamped; the next K_POLL moves the input's pointer there.  Clobbers AF, HL.
K_WARP:
    xor a
    ld (K_WREQ),a               ; the ISR ignores K_WX / K_WY while they change
    bit 7,h
    jr z,.xpos
    ld hl,0
    jr .xok
.xpos:
    ld a,h
    cp 2
    jr c,.xok
    ld hl,511
.xok:
    ld (K_WX),hl
    bit 7,d
    jr z,.ypos
    xor a
    jr .yok
.ypos:
    ld a,d
    or a
    ld a,191
    jr nz,.yok
    ld a,e
    cp 192
    jr c,.yok
    ld a,191
.yok:
    ld (K_WY),a
    ld a,1
    ld (K_WREQ),a
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; k_enq (ISR only): B = type, C, E, D = data 1-3 -> appended to the ring, or counted in K_LOST when it is full.  Clobbers AF, HL.
k_enq:
    ld hl,(K_RHEAD)
    ld a,h
    sub l
    cp 64
    jr nc,.lost
    ld a,h
    and $3F
    ld l,a
    ld h,K_RING >> 8
    ld (hl),b
    inc l
    ld (hl),c
    inc l
    ld (hl),e
    inc l
    ld (hl),d
    ld hl,K_RTAIL
    ld a,(hl)
    add a,4
    ld (hl),a                   ; the record is complete before the tail moves
    ret
.lost:
    ld hl,K_LOST
    inc (hl)
    ret nz
    dec (hl)                    ; saturate at 255
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; K_POLL: the input part of the frame ISR (14.3).  Called by the ISR after P_ISR, display mapped.  Clobbers AF, BC, DE, HL.
K_POLL:
    ld a,(K_WREQ)               ; 1. warp
    or a
    jr z,.keys
    xor a
    ld (K_WREQ),a
    ld hl,(K_WX)
    ld (K_PX),hl
    ld a,(K_WY)
    ld (K_PY),a
    ld a,1
    ld (K_PEND),a
.keys:
    xor a                       ; 2. keyboard: all half-rows at once
    in a,($FE)
    cpl
    and $1F
    ld hl,K_KANY
    ld b,(hl)
    ld (hl),a
    or b
    call nz,k_keys              ; something is or was down
    ld a,14                     ; 3. joystick
    out (PORT_AYR),a
    ld bc,$0100 + PORT_AYD
    in a,(c)
    inc a
    jr z,.joy                   ; $FF: nothing (A = 0)
    dec a
    cpl
    ld b,a
    and $0F
    cp $0F
    ld a,0
    jr z,.joy                   ; all four: nothing, fire included
    ld a,b
    and $0F
    bit 7,b
    jr z,.joy
    or $10
.joy:
    ld hl,K_KPD                 ; 4. OR keyboard-pointer mode's keys
    or (hl)
    ld b,a                      ; B = u d l r f
    ld (K_DIRS),a
    and $0F                     ; 5. move
    jr nz,k_dir
    ld (K_HOLD),a
k_button:
    xor a                       ; 6. button
    bit 4,b
    jr z,.b
    inc a
.b:
    ld hl,K_BTN
    cp (hl)
    jr z,.pointer
    ld (hl),a
    ld b,E_UP
    or a
    jr z,.ud
    ld b,E_DOWN
.ud:
    call k_pdata
    call k_enq
.pointer:
    ld a,(K_PEND)               ; 7. hand the position to the pointer
    or a
    ret z
    ld hl,(K_PX)
    ld a,(K_PY)
    ld e,a
    call P_ISRMOVE
    ret c                       ; locked: again next frame
    xor a
    ld (K_PEND),a
    ret

k_dir:                          ; 5. with a direction: B = u d l r f
    ld a,(K_HOLD)
    ld e,a
    ld d,0
    ld hl,K_STEP
    add hl,de
    ld c,(hl)                   ; C = s
    cp 30
    jr nc,.cap
    inc a
    ld (K_HOLD),a
.cap:
    ld hl,(K_PX)
    ld e,c
    sla e                       ; DE = 2 s
    bit 3,b
    jr z,.nr
    add hl,de
.nr:
    bit 2,b
    jr z,.nl
    or a
    sbc hl,de
.nl:
    bit 7,h
    jr z,.xp
    ld hl,0
    jr .xok
.xp:
    ld a,h
    cp 2
    jr c,.xok
    ld hl,511
.xok:
    ld a,b
    and 3
    cp 3
    ld a,(K_PY)
    jr z,.nu                    ; up and down cancel
    bit 1,b
    jr z,.nd
    add a,c                     ; <= 197: no overflow
    cp 192
    jr c,.nd
    ld a,191
.nd:
    bit 0,b
    jr z,.nu
    sub c
    jr nc,.nu
    xor a
.nu:
    ld e,a                      ; HL, E = the new position
    ld a,(K_PY)
    cp e
    jr nz,.moved
    ld a,(K_PX)
    cp l
    jr nz,.moved
    ld a,(K_PX+1)
    cp h
    jp z,k_button
.moved:
    ld (K_PX),hl
    ld a,e
    ld (K_PY),a
    ld a,1
    ld (K_PEND),a
    call k_pdata                ; C, E, D = the position and the new button
    ld hl,(K_RHEAD)             ; coalesce with the last record when it is a move and not the head
    ld a,h
    sub l
    cp 8
    jr c,.append
    ld a,h
    sub 4
    and $3F
    ld l,a
    ld h,K_RING >> 8
    ld a,(hl)
    cp E_MOVE
    jr nz,.append
    inc l
    ld (hl),c
    inc l
    ld (hl),e
    inc l
    ld (hl),d
    jp k_button
.append:
    ld b,E_MOVE
    call k_enq
    ld a,(K_DIRS)
    ld b,a
    jp k_button

; k_pdata: C, E, D = data 1-3 of a pointer event: K_PX low, K_PY, bit 0 K_PX bit 8 + bit 1 the button after step 6.  Clobbers AF.
k_pdata:
    ld a,(K_PX)
    ld c,a
    ld a,(K_PY)
    ld e,a
    ld a,(K_DIRS)
    and $10
    rrca
    rrca
    rrca                        ; bit 1
    ld d,a
    ld a,(K_PX+1)
    and 1
    or d
    ld d,a
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; k_keys: the keyboard part of K_POLL when a key is or was down (14.3 step 2).  Clobbers AF, BC, DE, HL.
KROW MACRO sel
    ld a,sel
    in a,($FE)
    cpl
    and $1F
    cp (hl)
    call nz,k_rowchg
    inc l
    ENDM

k_keys:
    xor a
    ld (K_CHG),a
    ld hl,K_NOW                 ; each half-row: when it differs from last time, store it and decode its new keys
    KROW $FE
    KROW $FD
    KROW $FB
    KROW $F7
    KROW $EF
    KROW $DF
    KROW $BF
    KROW $7F
    ld a,(K_CHG)
    or a
    jp z,.repeat                ; nothing changed: only the repeat runs
    ld a,(K_NOW)                ; the toggle: only CS and SS down, one of them new
    cp 1
    jr nz,.notog
    ld a,(K_NOW+7)
    cp 2
    jr nz,.notog
    ld hl,K_NOW+1
    xor a
    ld b,6
.others:
    or (hl)
    inc l
    djnz .others
    or a
    jr nz,.notog
    ld a,(K_OLDM)
    cp 3
    jr z,.notog
    ld a,(K_KPMODE)
    xor 1
    ld (K_KPMODE),a
    ld c,a
    ld b,E_MODE
    ld de,0
    call k_enq
    xor a
    ld (K_RKEY),a               ; the repeat is cancelled
.notog:
    xor a                       ; keyboard-pointer mode's keys
    ld b,a
    ld a,(K_KPMODE)
    or a
    jr z,.kpd
    ld a,(K_NOW+2)              ; Q
    rra
    rl b                        ; b0 = Q (later u)
    ld a,(K_NOW+1)              ; A
    rra
    jr nc,.k1
    set 1,b
.k1:
    ld a,(K_NOW+5)              ; P (bit 0) r, O (bit 1) l
    rra
    jr nc,.k2
    set 3,b
.k2:
    rra
    jr nc,.k3
    set 2,b
.k3:
    ld a,(K_NOW+7)              ; SPACE
    rra
    jr nc,.kpd
    set 4,b
.kpd:
    ld a,b
    ld (K_KPD),a
    ld a,(K_NEWK)               ; the repeat, unless a key went down this frame
    or a
    ret nz
.repeat:
    ld a,(K_RKEY)
    or a
    ret z
    ld a,(K_RROW)
    ld l,a
    ld h,K_NOW >> 8
    ld a,(K_RMASK)
    and (hl)
    jr nz,.held
    ld (K_RKEY),a               ; released: cancelled
    ret
.held:
    ld hl,K_RCNT
    dec (hl)
    ret nz
    ld (hl),4
    ld a,(K_RCODE)
    ld c,a
    ld a,(K_RMODS)
    or $80
    ld e,a
    ld d,0
    ld b,E_KEY
    jp k_enq

; k_rowchg: A = a half-row now (bits set = down), HL -> its byte in K_NOW, which differs.  Stores it and decodes the keys newly
; down in it.  Preserves HL.  Clobbers AF, BC, DE.
k_rowchg:
    ld d,a
    ld a,(K_CHG)
    or a
    call z,k_prep               ; the first change this frame
    ld a,(hl)
    ld (hl),d
    cpl
    and d                       ; newly down
    ret z
    ld b,a
    ld a,l
    sub K_NOW & $FF
    ld e,a
    add a,a
    add a,a
    add a,e
    ld e,a                      ; E = the key index of bit 0 (5 r)
    ld a,b
    jr k_row

; k_prep: once per frame with a change, before any half-row is stored: CS / SS last time (for the toggle), CS / SS now, the
; plane; no key new yet.  Preserves D, HL.  Clobbers AF, BC, E.
k_prep:
    ld a,1
    ld (K_CHG),a
    ld a,(K_NOW)
    and 1
    ld e,a
    ld a,(K_NOW+7)
    and 2
    or e
    ld (K_OLDM),a
    ld a,$7F
    in a,($FE)
    cpl
    and 2
    ld e,a
    ld a,$FE
    in a,($FE)
    cpl
    and 1
    or e
    ld (K_MODS),a
    ld c,80
    bit 1,a
    jr nz,.plane
    ld c,40
    rra
    jr c,.plane
    ld c,0
.plane:
    ld a,c
    ld (K_PLANE),a
    xor a
    ld (K_NEWK),a
    ret

; k_row: A = the keys newly down in a half-row (bits 0-4), E = the key index of bit 0, L = the half-row's low byte in K_NOW.
; Decodes each, in order.  Preserves BC, E, HL.  Clobbers AF, D.
k_row:
    push bc
    push hl
    ld b,a
    ld d,1                      ; D = the bit
    ld c,e
.bit:
    srl b
    jr nc,.nb
    push bc
    push de
    call k_press
    pop de
    pop bc
    pop hl
    push hl
.nb:
    inc e
    sla d
    ld a,b
    or a
    jr nz,.bit
    ld e,c
    pop hl
    pop bc
    ret

; k_press: E = key index k, newly down; D = its bit, L = its half-row's low byte.  Decodes it (14.3) and appends its E_KEY.
; Clobbers all.
k_press:
    ld a,e
    or a
    ret z                       ; CAPS SHIFT
    cp 36
    ret z                       ; SYMBOL SHIFT
    ld a,1
    ld (K_NEWK),a
    ld a,(K_KPMODE)
    or a
    ret nz                      ; keyboard-pointer mode: no keys
    ld a,e
    ld (K_TMPK),a
    ld a,l
    ld (K_TROW),a
    ld a,d
    ld (K_TMASK),a
    ld a,(K_PLANE)
    add a,e
    ld e,a
    ld d,0
    ld hl,KEYMAP
    add hl,de
    ld a,(hl)
    or a
    ret z                       ; no code
    cp 1
    jr nz,.code
    ld a,(K_CAPS)               ; caps lock
    xor 1
    ld (K_CAPS),a
    xor a
    ld (K_RKEY),a
    ret
.code:
    ld c,a
    ld a,(K_PLANE)
    or a
    jr nz,.case
    ld a,(K_CAPS)
    or a
    jr z,.case
    ld a,c
    cp 'a'
    jr c,.case
    cp 'z' + 1
    jr nc,.case
    sub 32
    ld c,a
.case:
    ld a,(K_CAPS)
    add a,a
    add a,a
    ld e,a
    ld a,(K_MODS)
    or e
    ld e,a                      ; E = data 2
    ld (K_RMODS),a
    ld a,c
    ld (K_RCODE),a
    ld a,30
    ld (K_RCNT),a
    ld hl,(K_TMPK)              ; L = k, H = its half-row (K_TROW follows K_TMPK)
    ld a,l
    ld (K_RKEY),a
    ld a,c
    ld (K_RCODE),a
    ld a,h
    ld (K_RROW),a
    ld a,(K_TMASK)
    ld (K_RMASK),a
    ld d,0
    ld b,E_KEY
    jp k_enq

; K_STEP[hold] = min(1 + floor(hold / 6), 6), hold = 0..30 (spike6 17.5)
K_STEP:
    DB 1,1,1,1,1,1, 2,2,2,2,2,2, 3,3,3,3,3,3, 4,4,4,4,4,4, 5,5,5,5,5,5, 6
