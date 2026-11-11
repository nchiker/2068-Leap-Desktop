; hello.asm -- Leap Desktop step 1 smoke cartridge: boots from the DOCK, switches to mode 6 (512x192, black ink on white),
; draws 8x8 text and a frame, counts frame interrupts.  Its only job is to prove the build, the headless test and the web page.
;
; Mode 6 layout (TS2068 Technical Manual 5.2.3 p.88): byte column c (0..63) of a pixel row lives in display file c AND 1
; ($4000 for even c, $6000 for odd c) at offset c >> 1 of that file's normal Spectrum row address.
; Result record at RESULT: +0/+1 the marker $A5, $5A (written last, so a test can tell it from power-on RAM, which TSRun fills
; with random bytes), +2 state (1 = pass, 2 = fail).  Tests read it; the border follows the paper in mode 6, so it cannot signal.

    DEVICE NOSLOT64K

PORT_HSR    EQU $F4
PORT_SCLD   EQU $FF
PORT_AY_REG EQU $F5
PORT_AY_DAT EQU $F6

F4_RUN      EQU $33             ; DOCK chunks 0,1,4,5 mapped; RAM chunks 2,3 (display), 6,7 (working RAM, stack)
SCLD_MODE6  EQU %00000110       ; bits 0-2 = 6 (64-column mode), bits 3-5 = 0 (black ink, white paper), bit 6 = 0 (frame
                                ;   interrupt on), bit 7 = 0 (DOCK for the chunks $F4 maps)
DFILE0      EQU $4000
DFILE1      EQU $6000
STACK_TOP   EQU $FF00
VARS        EQU $E000
V_FRAMES    EQU VARS+0          ; word: frame interrupts counted
V_SHADOW_FF EQU VARS+2          ; byte: last value written to $FF (never read the port back)
V_SHADOW_F4 EQU VARS+3          ; byte: last value written to $F4
RESULT      EQU $FF00           ; above the stack top: a push can never reach it
R_STATE     EQU RESULT+2

    ORG $0000
    DB $00, $01                 ; LROS header: cartridge present, ROM-type marker
    DW ENTRY                    ; cold start
    DB $BC                      ; chunk spec (low-active): 0, 1, 6 at hand-off; as Leap's and Arcade's cartridges

    ORG $0038
ISR:                            ; IM 1 frame interrupt: count it
    push af
    push hl
    ld hl,(V_FRAMES)
    inc hl
    ld (V_FRAMES),hl
    pop hl
    pop af
    ei
    ret

    ORG $0066
    retn                        ; NMI: nothing raises it on a stock TS2068

    ORG $0100
ENTRY:
    di                          ; the stock ROM hands over with interrupts on and SP in chunk 3
    ld sp,STACK_TOP
    xor a
    out (PORT_SCLD),a           ; DOCK selected, mode 0, while the mapping changes
    ld a,F4_RUN
    out (PORT_HSR),a
    im 1
    ld b,16                     ; AY silent
.ay:
    ld a,b
    dec a
    out (PORT_AY_REG),a
    xor a
    out (PORT_AY_DAT),a
    djnz .ay

    ld hl,VARS                  ; variables and the result record cleared
    ld de,VARS+1
    ld bc,$FFFF-VARS
    ld (hl),0
    ldir

    ld hl,DFILE0                ; both display files to paper (pixel 0), including the unused tails
    ld de,DFILE0+1
    ld bc,$4000-1
    ld (hl),0
    ldir

    ld a,SCLD_MODE6
    ld (V_SHADOW_FF),a
    out (PORT_SCLD),a
    ld a,F4_RUN
    ld (V_SHADOW_F4),a

    ld bc,0                     ; B = row, C = column
    ld hl,MSG_TITLE
    call print_at
    ld bc,2*256+0
    ld hl,MSG_RULER
    call print_at
    ld bc,4*256+1               ; an odd start column: text begins in file 2
    ld hl,MSG_ODD
    call print_at
    call draw_frame

    ld a,1
    ld (R_STATE),a              ; pass: everything drawn
    ld hl,$5AA5
    ld (RESULT),hl              ; marker last: bytes $A5, $5A
    ei
.idle:
    halt
    jr .idle

; ---------------------------------------------------------------------------------------------------------------------
; row_addr: B = character row (0..23) -> HL = address of that row's first pixel line in display file 1.  Clobbers AF.
; Spectrum layout: 010T TSSS RRRC CCCC with T = third (row >> 3), R = row AND 7, S = pixel line.
row_addr:
    ld a,b
    and $18
    or $40
    ld h,a
    ld a,b
    and 7
    rrca
    rrca
    rrca
    ld l,a
    ret

; char_addr: B = row, C = column (0..63) -> HL = first pixel line of that 8x8 cell in mode 6.  Clobbers AF.
char_addr:
    call row_addr
    ld a,c
    srl a                       ; offset c >> 1 in the file, carry = c AND 1
    jr nc,.even
    set 5,h                     ; odd column: second display file ($6000 = $4000 + $2000)
.even:
    or l
    ld l,a
    ret

; print_at: B = row, C = column, HL = zero-terminated string; draws 8x8 glyphs left to right (no wrap).  Clobbers all.
print_at:
.next:
    ld a,(hl)
    or a
    ret z
    push hl
    push bc
    sub 32                      ; FONT_GLYPHS holds codes 32..127
    ld l,a
    ld h,0
    add hl,hl
    add hl,hl
    add hl,hl
    ld de,FONT_GLYPHS
    add hl,de
    ex de,hl                    ; DE = glyph
    call char_addr              ; HL = screen
    ld b,8
.row:
    ld a,(de)
    ld (hl),a
    inc de
    inc h                       ; next pixel line inside the cell
    djnz .row
    pop bc
    pop hl
    inc hl
    inc c
    jr .next

; draw_frame: a box around pixel rows 176..191, the full 512 pixels wide: lines at y = 176 and y = 191, and the
; outermost pixel of each row at x = 0 (file 1, offset 0, bit 7) and x = 511 (file 2, offset 31, bit 0).  Clobbers all.
FRAME_TOP   EQU 176
FRAME_BOT   EQU 191
draw_frame:
    ld a,FRAME_TOP
    call hline
    ld a,FRAME_BOT
    call hline
    ld a,FRAME_TOP+1
.side:
    push af
    call line_addr              ; HL = pixel line A in file 1, column 0
    set 7,(hl)                  ; x = 0
    ld a,l
    or 31
    ld l,a
    set 5,h                     ; file 2, offset 31 = byte column 63
    set 0,(hl)                  ; x = 511
    pop af
    inc a
    cp FRAME_BOT
    jr nz,.side
    ret

; hline: A = pixel line -> every byte of that line set in both files (512 pixels).  Clobbers AF, BC, HL.
hline:
    call line_addr
    ld b,32
.h:
    ld (hl),$FF
    set 5,h
    ld (hl),$FF
    res 5,h
    inc l
    djnz .h
    ret

; line_addr: A = pixel line y (0..191) -> HL = its first byte in display file 1.  Clobbers AF.
; H = 010 y7 y6 y2 y1 y0, L = y5 y4 y3 0 0 0 0 0.
line_addr:
    push bc
    ld b,a
    and 7
    ld h,a
    ld a,b
    and $C0
    rrca
    rrca
    rrca
    or h
    or $40
    ld h,a
    ld a,b
    and $38
    rlca
    rlca
    ld l,a
    pop bc
    ret

MSG_TITLE:  DB "LEAP DESKTOP  mode 6, 512x192, 64 columns of 8x8 text", 0
MSG_RULER:  DB "0123456789012345678901234567890123456789012345678901234567890123", 0
MSG_ODD:    DB "odd column start: file 2 first", 0

    INCLUDE "font.inc"

    SAVEBIN "mem.bin", 0, 65536
