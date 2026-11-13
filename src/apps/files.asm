; files.asm -- the desktop's file calls (docs/FILES.md 2) and their browser backend, the emulator's host bridge (FILES 4.1).
; Code in DOCK 2-3: banked programs call it with CALL under mapping A, interrupts on.  Names and buffers are in RAM that A sees
; ($C000-$FFFF).  Every call returns carry clear and A = 1 (OK), or carry set and A = a status (FILES 2.1); IX, IY and the
; alternate set are preserved.  One byte per IN / OUT (no INIR / OTIR: TS-Pico's rule).  No DI.

FS_PCMD     EQU $6F             ; OUT: a command; IN: bit 7 busy, bits 0-6 the last status ($FF: no host)
FS_PDAT     EQU $6D             ; OUT: a byte for the host; IN: the host's next byte
FS_OK       EQU 1
FS_BADNAME  EQU 3
FS_CANCEL   EQU 12

FS_BEGIN:

; FS_PICK: HL -> a 32-byte name buffer.  The user picks a file to read: waits (HALT) until it is chosen or cancelled; BREAK or
; ESC cancels (abort).  Other events are discarded meanwhile.  OK: the buffer holds the name (a length byte, the codes).
FS_PICK:
    push hl
    ld a,1
    out (FS_PCMD),a
.wait:
    in a,(FS_PCMD)
    inc a
    jr z,fs_none                ; $FF: no host
    dec a
    jp p,.done                  ; not busy
.drain:
    call K_GETEV                ; clobbers AF, BC, DE, HL
    jr c,.halt
    cp E_REDRAW
    jr z,.halt                  ; made, not taken: it comes back until drawn
    dec a                       ; E_KEY?
    jr nz,.drain
    ld a,(K_EV+1)
    cp KC_ESC
    jr z,.abort
    cp KC_BREAK
    jr nz,.drain
.abort:
    xor a
    out (FS_PCMD),a
    jr .wait                    ; the host answers 12 at once
.halt:
    halt
    jr .wait
.done:
    pop hl
    call fs_st
    ret c
    in a,(FS_PDAT)
    cp 31
    ld b,a
    ld a,FS_BADNAME
    ccf
    ret c                       ; a name longer than 30: refused
    ld (hl),b
    inc b
    jr .next
.name:
    in a,(FS_PDAT)
    ld (hl),a
.next:
    inc hl
    djnz .name
    ld a,FS_OK
    ret
fs_none:
    pop hl
    xor a
    scf
    ret

; FS_OPEN: HL -> a name (a length byte, the codes), A = the mode (bit 0: 1 write, 0 read; bit 1: 1 binary, 0 text).
; OK: BC = the file's length (reading; 0 writing).
FS_OPEN:
    ld c,a
    ld a,2
    out (FS_PCMD),a
    ld a,c
    out (FS_PDAT),a
    ld b,(hl)
    ld a,b
    out (FS_PDAT),a
    inc b
    jr .next
.name:
    inc hl
    ld a,(hl)
    out (FS_PDAT),a
.next:
    djnz .name
; fs_bc: the status; OK: BC = two bytes from the host, low first.
fs_bc:
    call fs_st
    ret c
fs_in2:
    in a,(FS_PDAT)
    ld c,a
    in a,(FS_PDAT)
    ld b,a
    ld a,FS_OK
    ret

; FS_READ: DE -> a buffer, BC = bytes wanted (1-65,535).  OK: BC = bytes read (fewer only at the end).  Status 7: none left.
FS_READ:
    ld a,3
    call fs_cmd2
    call fs_bc
    ret c
    ld a,b
    or c
    ret z                       ; (a host that sends 0: nothing read; A = 1, carry clear)
    push bc
.rd:
    in a,(FS_PDAT)
    ld (de),a
    inc de
    dec bc
    ld a,b
    or c
    jr nz,.rd
    pop bc
    ld a,FS_OK
    ret

; FS_WRITE: HL -> bytes, BC = how many (1-65,535).
FS_WRITE:
    ld a,4
    call fs_cmd2
.wr:
    ld a,(hl)
    out (FS_PDAT),a
    inc hl
    dec bc
    ld a,b
    or c
    jr nz,.wr
    jr fs_st

; FS_CLOSE: writing, the file is finished.  Harmless when none is open.
FS_CLOSE:
    ld a,5
    out (FS_PCMD),a
; fs_st: carry clear and A = 1 when the last status is OK; else carry set, A = the status (0 when no host answers).
fs_st:
    in a,(FS_PCMD)
    cp $FF
    jr z,.none
    and $7F
    cp FS_OK
    ret z                       ; carry clear
    scf
    ret
.none:
    xor a
    scf
    ret

; fs_cmd2: OUT command A, then BC low, high.
fs_cmd2:
    out (FS_PCMD),a
    ld a,c
    out (FS_PDAT),a
    ld a,b
    out (FS_PDAT),a
    ret

FS_END:
