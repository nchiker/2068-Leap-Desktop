; launch.asm -- the launcher (docs/SHELL.md 3, 10.3): one program at a time.  Pool code (K), assembled by step 5 cartridges in
; chunk 5 after the toolkit.  The cartridge defines K_PROGS (a word per program: its start in DOCK 2-3) and STACK_TOP.

K_PROG      EQU $F0E9           ; byte: the running program
K_LSTUB     EQU $F0EA           ; 3 bytes: rst $28 / DW the program's start

; K_LAUNCH: A = a program number -> its windows closed, the menus removed, the app arena reset, the desk repainted, and the
; program started (KFAR to K_PROGS[A]).  Never returns: the stack starts again at its top.
K_LAUNCH:
    ld sp,STACK_TOP
    ld (K_PROG),a
    ld a,F4_K
    ld (V_SHADOW_F4),a
    out (PORT_HSR),a
.close:
    call W_FRONT
    ld a,h
    or l
    jr z,.closed
    push hl
    pop ix
    call W_CLOSE
    jr .close
.closed:
    ld hl,0
    call MB_SET
    ld hl,K_AARENA
    call K_ARESET               ; K_FOCUS, K_CAPTURE cleared with it (W_CLOSE cleared W_MODAL)
    xor a
    ld (K_PN),a                 ; the posted queue empty
    call W_UPDATE
    ld a,(K_PROG)
    add a,a
    ld l,a
    ld h,0
    ld de,K_PROGS
    add hl,de
    ld e,(hl)
    inc hl
    ld d,(hl)
    ld hl,K_LSTUB
    ld (hl),$EF                 ; rst $28
    inc hl
    ld (hl),e
    inc hl
    ld (hl),d
    jp K_LSTUB

; K_QUIT: back to the shell (program 0).
K_QUIT:
    xor a
    jr K_LAUNCH
