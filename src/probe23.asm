; probe23.asm -- probe (a): application code executing in place from DOCK chunks 2-3, a kernel trampoline that draws for it,
; and a frame interrupt that draws while the window is mapped.  Contract and record layout: docs/PROBE_DOCK23.md.

    DEVICE NOSLOT64K

PORT_HSR    EQU $F4
PORT_SCLD   EQU $FF
PORT_ULA    EQU $FE
PORT_AY_REG EQU $F5
PORT_AY_DAT EQU $F6

F4_RUN      EQU $33             ; DOCK 0,1,4,5: display files visible
F4_APP      EQU $3F             ; + DOCK 2,3 over the display RAM: application code mapped
N_ITER      EQU 2000

STACK_TOP   EQU $FF00
VARS        EQU $E000
V_FRAMES    EQU VARS+0          ; word
V_IRQAPP    EQU VARS+2          ; word: interrupts whose shadow said F4_APP
V_SHADOW_F4 EQU VARS+4
V_FAILK     EQU VARS+5          ; first failure kind (0 none)
V_FAILA     EQU VARS+6          ; word: its address
V_ITER      EQU VARS+8          ; word

RESULT      EQU $FF00
R_STATE     EQU RESULT+2
R_KIND      EQU RESULT+3
R_ITER      EQU RESULT+4
R_FRAMES    EQU RESULT+6
R_IRQAPP    EQU RESULT+8
R_ADDR      EQU RESULT+10

ISR_BYTE    EQU $57FF           ; last byte of display file 1: the ISR's frame stamp
TAB2        EQU $4800           ; in DOCK chunk 2
TAB3        EQU $6800           ; in DOCK chunk 3
K2          EQU 63
K3          EQU 94

; ===================================================================== DOCK chunk 0: kernel
    ORG $0000
    DB $00, $01
    DW ENTRY
    DB $BC

    ORG $0038
ISR:
    push af
    push hl
    ld hl,(V_FRAMES)
    inc hl
    ld (V_FRAMES),hl
    ld a,(V_SHADOW_F4)
    cp F4_APP
    jr nz,.draw
    ld hl,(V_IRQAPP)
    inc hl
    ld (V_IRQAPP),hl
.draw:
    ld a,F4_RUN                 ; always: display visible, whatever the port holds right now
    out (PORT_HSR),a
    ld a,(V_FRAMES)
    ld (ISR_BYTE),a
    ld a,(V_SHADOW_F4)          ; the port follows the shadow again (safe in either order of the main code's store / OUT)
    out (PORT_HSR),a
    pop hl
    pop af
    ei
    ret

    ORG $0066
    retn

; K_PLOT: the trampoline.  Called from application code with F4_APP mapped.  HL = display address, A = value.  Clobbers AF.
K_PLOT:
    push bc
    ld b,a
    ld a,F4_RUN
    ld (V_SHADOW_F4),a
    out (PORT_HSR),a
    ld (hl),b
    ld a,(hl)                   ; must read back the RAM we wrote, not DOCK
    cp b
    jr z,.ok
    ld a,3
    call k_fail
.ok:
    ld a,F4_APP
    ld (V_SHADOW_F4),a
    out (PORT_HSR),a
    pop bc
    ret                         ; into DOCK chunk 3

; k_fail: A = kind, HL = address; keeps the first failure only.  Lives in chunk 0, writes chunk 7: callable mapped or not.
k_fail:
    push af
    ld a,(V_FAILK)
    or a
    jr nz,.keep
    pop af
    ld (V_FAILK),a
    ld (V_FAILA),hl
    ret
.keep:
    pop af
    ret

    ORG $0100
ENTRY:
    di
    ld sp,STACK_TOP
    xor a
    out (PORT_SCLD),a           ; mode 0, DOCK selected
    ld a,F4_RUN
    out (PORT_HSR),a
    im 1
    ld b,16
.ay:
    ld a,b
    dec a
    out (PORT_AY_REG),a
    xor a
    out (PORT_AY_DAT),a
    djnz .ay
    ld a,1
    out (PORT_ULA),a            ; border blue

    ld hl,VARS                  ; chunk 7 cleared, the result record included
    ld de,VARS+1
    ld bc,$FFFF-VARS
    ld (hl),0
    ldir
    ld hl,$4000                 ; display file 1 bitmap 0, attributes $38
    ld de,$4001
    ld bc,$17FF
    ld (hl),0
    ldir
    ld hl,$5800
    ld de,$5801
    ld bc,$02FF
    ld (hl),$38
    ldir
    ld hl,$6000                 ; display file 2 all 0
    ld de,$6001
    ld bc,$1AFF
    ld (hl),0
    ldir
    ld hl,$5B00                 ; poison the holes
    call poison
    ld hl,$7B00
    call poison

    ld a,F4_RUN
    ld (V_SHADOW_F4),a          ; ISR variables last
MAINC:
    ei
    ld de,0
.loop:
    push de
    ld a,F4_APP
    ld (V_SHADOW_F4),a
    out (PORT_HSR),a
    call APP_A                  ; executes in DOCK chunk 2
    ld a,F4_RUN
    ld (V_SHADOW_F4),a
    out (PORT_HSR),a
    pop de
    inc de
    ld (V_ITER),de
    ld hl,N_ITER
    or a
    sbc hl,de
    jr nz,.loop

FINDI:
    ; display file 1, $4000-$57FE: byte 3i = 7i+1 for i < N, others 0.  B = position in the triple, C = next expected value.
    ld hl,$4000
    ld de,N_ITER                ; triples still holding a value
    ld bc,$0001                 ; B = 0 (first of a triple), C = 7*0+1
.f1:
    ld a,h
    cp HIGH ISR_BYTE
    jr nz,.f1go
    ld a,l
    cp LOW ISR_BYTE
    jr z,.f1done
.f1go:
    ld a,b
    or a
    jr nz,.zero
    ld a,d
    or e
    jr z,.zero                  ; past the last written triple
    ld a,(hl)
    cp c
    jr nz,.f1bad
    ld a,c
    add a,7
    ld c,a
    dec de
    jr .adv
.zero:
    ld a,(hl)
    or a
    jr nz,.f1bad
.adv:
    inc b
    ld a,b
    cp 3
    jr nz,.f1n
    ld b,0
.f1n:
    inc hl
    jr .f1
.f1bad:
    ld a,4
    call k_fail
.f1done:
    ld hl,$6000                 ; display file 2: all 0
    ld bc,$1B00
.f2:
    ld a,(hl)
    or a
    jr z,.f2n
    ld a,5
    call k_fail
    jr .f2done
.f2n:
    inc hl
    dec bc
    ld a,b
    or c
    jr nz,.f2
.f2done:
    ld hl,$5800                 ; attributes: all $38
    ld bc,$0300
.at:
    ld a,(hl)
    cp $38
    jr z,.atn
    ld a,6
    call k_fail
    jr .atdone
.atn:
    inc hl
    dec bc
    ld a,b
    or c
    jr nz,.at
.atdone:
    ld hl,$5B00
    call holes
    ld hl,$7B00
    call holes
    ld hl,(V_IRQAPP)
    ld a,h
    or l
    jr nz,.irqok
    ld a,8
    call k_fail
.irqok:
    ; verdict: attributes green (pass) or red (fail), then the record, marker last
    ld a,(V_FAILK)
    or a
    ld a,$20
    ld b,1
    jr z,.paint
    ld a,$10
    ld b,2
.paint:
    ld hl,$5800
    ld de,$5801
    ld (hl),a
    push bc
    ld bc,$02FF
    ldir
    pop bc
    ld a,b
    ld (R_STATE),a
    ld a,(V_FAILK)
    ld (R_KIND),a
    ld hl,(V_ITER)
    ld (R_ITER),hl
FRCAP:                          ; the frame count is captured here (ZEsarUX's T-state breakpoint ends here)
    ld hl,(V_FRAMES)
    ld (R_FRAMES),hl
    ld hl,(V_IRQAPP)
    ld (R_IRQAPP),hl
    ld hl,(V_FAILA)
    ld (R_ADDR),hl
    ld hl,$5AA5
    ld (RESULT),hl
.idle:
    halt
    jr .idle

; poison: HL = start of a 1,280-byte hole; each byte = low byte of its address XOR $A5.  Clobbers AF, BC, HL.
poison:
    ld bc,1280
.p:
    ld a,l
    xor $A5
    ld (hl),a
    inc hl
    dec bc
    ld a,b
    or c
    jr nz,.p
    ret

; holes: HL = start of a hole; checks the poison, notes kind 7 at the first difference.  Clobbers AF, BC, HL.
holes:
    ld bc,1280
.h:
    ld a,l
    xor $A5
    cp (hl)
    jr z,.hn
    ld a,7
    jp k_fail
.hn:
    inc hl
    dec bc
    ld a,b
    or c
    jr nz,.h
    ret

; ===================================================================== DOCK chunk 2: application, part A
    ORG $4000
; APP_A: DE = iteration.  Reads TAB2 (own chunk) and TAB3 (chunk 3) in place, then calls APP_B in chunk 3.  Clobbers all.
APP_A:
    ld hl,TAB2
    ld c,K2
    ld a,1
    call app_check
    ld hl,TAB3
    ld c,K3
    ld a,2
    call app_check
    call APP_B                  ; a call into chunk 3; APP_B returns here, into chunk 2
    ret

; app_check: HL = table (256 bytes, page aligned), C = first value, A = failure kind.  Each next value is +7.
app_check:
    ld b,0
    push af
.c:
    ld a,(hl)
    cp c
    jr nz,.bad
    ld a,c
    add a,7
    ld c,a
    inc l
    djnz .c
    pop af
    ret
.bad:
    pop af
    jp k_fail                   ; chunk 0, writes chunk 7 only

    ORG TAB2
TK  DEFL 0
    DUP 256
    DB (7 * TK + 63) & 255
TK  DEFL TK + 1
    EDUP

; ===================================================================== DOCK chunk 3: application, part B
    ORG $6000
; APP_B: DE = iteration -> K_PLOT(HL = $4000 + 3 DE, A = 7 E + 1).
APP_B:
    ld h,d
    ld l,e
    add hl,hl
    add hl,de
    ld bc,$4000
    add hl,bc
    ld a,e
    ld b,a
    add a,a
    add a,a
    add a,a
    sub b
    inc a
    call K_PLOT                 ; the trampoline returns here, into chunk 3, with F4_APP mapped again
    ret

    ORG TAB3
TK  DEFL 0
    DUP 256
    DB (7 * TK + 94) & 255
TK  DEFL TK + 1
    EDUP

    SAVEBIN "mem.bin", 0, 65536
