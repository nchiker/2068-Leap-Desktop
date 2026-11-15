; sound.asm -- UI sounds on the AY chip (docs/SOUND.md).  Pool code (K), assembled by desk5 (SOUND) in chunk 5 after the launcher.  One voice (channel A), tone only; a sound is a
; row of SND_TAB (period word, volume, frames, next): when its frames run out the ISR's tick starts the row named by `next`, or silences channel A.  Every AY write stores K_AYREG
; (the latch's shadow, which the ISR puts back) BEFORE its OUT, so an interrupt between the register select and the data write selects the same register again.
;   K_BEEP     A = a sound id (1-9): starts it.  Nothing when sound is off.  Keeps every register but AF; callable by `call` under K and by KFAR.
;   K_SNDSET   A = 1 sound on, 0 off (silences channel A at once).
;   K_SNDTICK  the ISR's frame work (about 45 T when idle).
K_SOUND     EQU $E084           ; byte: 1 = sound on
K_SNDN      EQU $E085           ; byte: frames left of the sound playing (0 = none)
K_SNDX      EQU $E086           ; byte: the sound that follows it (0 = none)

K_BEEP:
    push hl
    push bc
    push de
    ld c,a
    ld a,(K_SOUND)
    or a
    ld a,c
    call nz,snd_play
    pop de
    pop bc
    pop hl
    ret

; snd_play: A = a sound id: its row's period, the mixer (tone A only), the volume, then K_SNDX and K_SNDN (the tick starts counting last).  Clobbers AF, BC, DE, HL.
snd_play:
    ld l,a
    ld h,0
    ld d,h
    ld e,l
    add hl,hl
    add hl,hl
    add hl,de                   ; 5 x id
    ld de,SND_TAB - 5
    add hl,de
    xor a
    ld (K_SNDN),a               ; the tick stops while the registers change
    ld e,(hl)
    inc hl
    ld d,(hl)                   ; DE = the period
    inc hl
    ld b,(hl)                   ; the volume
    inc hl
    ld c,(hl)                   ; the frames
    inc hl
    ld a,(hl)
    ld (K_SNDX),a
    push bc
    ld b,7
    ld c,$3E                    ; tone A only (noise off, tones B and C off; the I/O bits stay inputs)
    call snd_w
    ld b,0
    ld c,e
    call snd_w
    ld b,1
    ld c,d
    call snd_w
    pop de                      ; D = the volume, E = the frames
    ld b,8
    ld c,d
    call snd_w
    ld a,e
    ld (K_SNDN),a
    ret

; snd_w: AY register B = C.  Clobbers A.
snd_w:
    ld a,b
    ld (K_AYREG),a              ; the shadow before the OUT
    out (PORT_AY_REG),a
    ld a,c
    out (PORT_AY_DAT),a
    ret

K_SNDSET:
    ld (K_SOUND),a
    or a
    ret nz
    ld (K_SNDN),a               ; off: no sound playing, channel A's volume 0
    ld b,8
    ld c,0
    jp snd_w

; K_SNDTICK: in the frame ISR (the registers are the ISR's to use).
K_SNDTICK:
    ld a,(K_SNDN)
    or a
    ret z
    dec a
    ld (K_SNDN),a
    ret nz
    ld a,(K_SNDX)               ; the sound ended: the next, or silence
    or a
    jp nz,snd_play
    ld b,8
    ld c,0
    jp snd_w

; The sounds (AY clock 1.7634 MHz: tone = 1763400 / (16 x period)): period word, volume, frames, next.
SND_TAB:
    DW 60                       ; 1 click: about 1.8 kHz
    DB 8, 2, 0
    DW 90                       ; 2 select: about 1.2 kHz
    DB 8, 3, 0
    DW 125                      ; 3 alert: 880 Hz, then sound 6
    DB 8, 6, 6
    DW 500                      ; 4 error: 220 Hz
    DB 8, 12, 0
    DW 125                      ; 5 win: a rising run, sounds 5, 7, 8, 9
    DB 8, 3, 7
    DW 165                      ; 6 the alert's second tone: 667 Hz
    DB 8, 6, 0
    DW 94
    DB 8, 3, 8                  ; 7
    DW 74
    DB 8, 3, 9                  ; 8
    DW 62
    DB 8, 10, 0                 ; 9
