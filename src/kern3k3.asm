; kern3k3.asm -- kern3's K3 parts (docs/OBJECTS_EVENTS.md 15.4): the self-test, the tree builder, T_EVONE and, with DEMO, the
; demo loop.  Included by kern3.asm in chunk 5.

T_EXPECT    EQU 7550            ; the self-test's sum (15.4), from the model in tests/kern-model3.mjs
T_VIEWS     EQU $E0A0           ; 8 words: the views T_BUILD made, in table order
T_TP        EQU $E0B0           ; word: T_BUILD's table pointer
T_VP        EQU $E0B2           ; word: T_BUILD's view pointer
D_OLDF      EQU $E0B4           ; word: the demo's focus before an event
D_HEX       EQU $E0C0           ; 48 bytes: the demo's status line
D_STATLEN   EQU 35              ; its length: title 12, sum 4, verdict 6, event 12, mode 1

; T_EVONE (15.5): one event, fetched and dispatched.
T_EVONE:
    call K_GETEV
    call K_DISPATCH
    ret

; ---------------------------------------------------------------------------------------------------------------------------
; T_SELFTEST (15.4): builds the tree, runs the script, writes the record (+3 log count, +4 log sum, +6 focused id, state 3).
T_SELFTEST:
    ld hl,K_AARENA
    call K_ARESET
    ld hl,K_AARENA
    call K_ARENA
    ld hl,0
    ld (T_LOGN),hl
    call T_BUILD
    ld hl,ST_SCRIPT
.next:
    ld a,(hl)
    or a
    jr z,.done
    inc hl
    ld c,(hl)
    inc hl
    ld e,(hl)
    inc hl
    ld d,(hl)
    inc hl
    push hl
    cp $FE
    jr z,.destroy
    cp $FD
    jr z,.prev
    call K_POST
.drain:
    call K_GETEV
    jr c,.ok
    call K_DISPATCH
    jr .drain
.destroy:
    ld ix,(T_VIEWS + 2 * 5)     ; G
    ld a,M_DESTROY
    rst $08
    jr .ok
.prev:
    call K_FOCUSPREV
.ok:
    pop hl
    jr .next
.done:
    ld a,(T_LOGN)
    ld (RESULT+3),a
    ld b,a
    ld hl,T_LOG
    ld de,0
    or a
    jr z,.summed
.rec:                           ; bytes +0, +1, +2 (code, IX) and +7 (tag)
    ld c,3
.byte:
    call .add
    dec c
    jr nz,.byte
    inc hl
    inc hl
    inc hl
    inc hl
    call .add
    djnz .rec
.summed:
    ld (RESULT+4),de
    ld a,$FF
    ld hl,(K_FOCUS)
    ld e,a
    ld a,h
    or l
    ld a,e
    jr z,.nofocus
    ld de,View_id
    add hl,de
    ld a,(hl)
.nofocus:
    ld (RESULT+6),a
    ld a,3
    ld (R_STATE),a
    ret
.add:                           ; DE += (HL), HL += 1
    ld a,(hl)
    add a,e
    ld e,a
    jr nc,.nc
    inc d
.nc:
    inc hl
    ret

; The script (15.4): type, data 1-3.  $FE = M_DESTROY to G, $FD = K_FOCUSPREV, 0 = end.
ST_SCRIPT:
    DB E_KEY, K_TAB, 0, 0
    DB E_KEY, K_TAB, 0, 0
    DB E_KEY, K_TAB, 0, 0
    DB E_KEY, K_TAB, 0, 0
    DB E_DOWN, 356 - 256, 92, 3
    DB E_MOVE, 360 - 256, 95, 3
    DB E_UP, 360 - 256, 95, 1
    DB E_KEY, K_BACKTAB, 0, 0
    DB E_DOWN, 100, 92, 2
    DB E_MOVE, 40, 30, 2
    DB E_UP, 40, 30, 0
    DB E_MOVE, 40, 30, 0
    DB E_KEY, 'x', 0, 0
    DB 16, 1, 2, 3
    DB $FE, 0, 0, 0
    DB E_KEY, K_TAB, 0, 0
    DB $FD, 0, 0, 0
    DB 0

; ---------------------------------------------------------------------------------------------------------------------------
; T_BUILD: the tree of 15.4 in the current arena, K_ROOT = R.  Clobbers all but IY.
T_BUILD:
    ld hl,ST_TREE
    ld (T_TP),hl
    ld hl,T_VIEWS
    ld (T_VP),hl
.view:
    ld hl,(T_TP)
    ld e,(hl)
    inc hl
    ld d,(hl)
    inc hl
    ld a,d
    or e
    ret z
    ld (T_TP),hl
    ex de,hl
    call K_NEW
    ld hl,(T_VP)
    push ix
    pop de
    ld (hl),e
    inc hl
    ld (hl),d
    inc hl
    ld (T_VP),hl
    ld hl,(T_TP)
    ld a,(hl)                   ; parent index ($FF: the root)
    inc hl
    push af
    ld bc,View_x
    ex de,hl
    add hl,bc
    ex de,hl                    ; DE = IX + View_x
    ld bc,8
    ldir                        ; x, y, w, h, flags, id
    ld a,(hl)                   ; tag ($FF: none)
    inc hl
    ld (T_TP),hl
    cp $FF
    jr z,.notag
    ld (ix+TBox_tag),a
.notag:
    pop af
    cp $FF
    jr nz,.child
    push ix
    pop de
    call K_SETROOT
    jr .view
.child:
    add a,a
    ld e,a
    ld d,0
    ld hl,T_VIEWS
    add hl,de
    ld e,(hl)
    inc hl
    ld d,(hl)                   ; DE = the parent
    push ix
    pop hl
    push de
    pop ix
    ex de,hl                    ; IX = parent, DE = child
    call K_ADDCHILD
    jr .view

; class, parent index, x (word), y, w (word), h, flags, id, tag
ST_TREE:
    DW CL_Group
    DB $FF
    DW 0
    DB 16
    DW 512
    DB 176, 0, 0, $FF
    DW CL_TBox
    DB 0
    DW 16
    DB 24
    DW 112
    DB 24, 1, 1, 0
    DW CL_TBox
    DB 0
    DW 144
    DB 24
    DW 112
    DB 24, 1, 2, 0
    DW CL_TBox
    DB 0
    DW 272
    DB 24
    DW 112
    DB 24, 3, 3, 0
    DW CL_TBox
    DB 0
    DW 400
    DB 24
    DW 96
    DB 24, 5, 4, 0
    DW CL_Group
    DB 0
    DW 16
    DB 64
    DW 480
    DB 112, 0, 5, $FF
    DW CL_TBox
    DB 5
    DW 32
    DB 80
    DW 200
    DB 24, 1, 6, 1
    DW CL_TBox
    DB 5
    DW 256
    DB 80
    DW 200
    DB 24, 1, 7, 0
    DW 0

    IFDEF DEMO
; ---------------------------------------------------------------------------------------------------------------------------
; The demo (15.4): after the self-test, the tree again, drawn; then events are dispatched and shown.
D_MAIN:
    call T_SELFTEST
    ld a,1
    call K_MSET                 ; the Kempston mouse on (docs/WINDOWS.md 15.4; no mouse: the ports read $FF, nothing moves)
    ld hl,K_AARENA
    call K_ARESET
    call T_BUILD
    ld ix,(T_VIEWS + 2 * 6)     ; E keeps no keys in the demo, so TAB goes round
    ld (ix+TBox_tag),0
    call D_SCENE
    xor a
    ld (D_HEX+1),a
D_LOOP:
    call K_GETEV
    jr c,.idle
    ld hl,(K_FOCUS)
    ld (D_OLDF),hl
    call K_DISPATCH
    call D_STATUS
    ld hl,(K_FOCUS)
    ld de,(D_OLDF)
    or a
    sbc hl,de
    jr z,D_LOOP
    ld hl,(D_OLDF)
    call D_RING
    ld hl,(K_FOCUS)
    call D_RING
    jr D_LOOP
.idle:
    halt
    jr D_LOOP

; D_SCENE: clears the screen, frames every view that is not hidden, labels it with its id, and the status line.
D_SCENE:
    call D_SHIELDALL
    call G_CLS
    call P_UNSHIELD
    ld b,8
    ld hl,T_VIEWS
.v:
    push bc
    ld e,(hl)
    inc hl
    ld d,(hl)
    inc hl
    push hl
    push de
    pop ix
    bit 1,(ix+View_flags)
    jr nz,.skip
    call D_GETRECT
    call P_SHIELD
    xor a
    call G_SETOP
    call G_FRAME
    call D_GETRECT              ; the label: cell (x / 8 + 1, y / 8 + 1)
    ld hl,(GA_X)
    srl h
    rr l
    srl h
    rr l
    srl h
    rr l
    inc hl
    ld (GA_X),hl
    ld a,(ix+View_y)
    rrca
    rrca
    rrca
    and $1F
    inc a
    ld l,a
    ld h,0
    ld (GA+2),hl
    ld a,(ix+View_id)
    add a,'0'
    ld (D_HEX),a
    ld hl,D_HEX
    ld (GA+4),hl
    ld hl,1
    ld (GA+6),hl
    call G_TEXT8
    call P_UNSHIELD
.skip:
    pop hl
    pop bc
    djnz .v
    jp D_STATUS

; D_GETRECT: GA = IX's rectangle.  Clobbers AF, HL.
D_GETRECT:
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    ld (GA_X),hl
    ld l,(ix+View_y)
    ld h,0
    ld (GA+2),hl
    ld l,(ix+View_w)
    ld h,(ix+View_w+1)
    ld (GA_W),hl
    ld l,(ix+View_h)
    ld h,0
    ld (GA+6),hl
    ret

; D_RING: HL = view or 0: XOR its inner frame (1 pixel inside), so the focused view's frame is twice as thick.
D_RING:
    ld a,h
    or l
    ret z
    push hl
    pop ix
    call D_GETRECT
    ld hl,(GA_X)
    inc hl
    ld (GA_X),hl
    ld hl,(GA+2)
    inc hl
    ld (GA+2),hl
    ld hl,(GA_W)
    dec hl
    dec hl
    ld (GA_W),hl
    ld hl,(GA+6)
    dec hl
    dec hl
    ld (GA+6),hl
    call P_SHIELD
    ld a,2
    call G_SETOP
    call G_FRAME
    jp P_UNSHIELD

; D_STATUS: row 0: "LEAP K3 SUM ssss PASS|FAIL EV tt 11 22 33 KP m".
D_STATUS:
    ld de,D_HEX
    ld hl,D_TITLE
    ld bc,D_TITLE_END - D_TITLE
    ldir
    ld hl,(RESULT+4)
    ld a,h
    call D_HEX2
    ld a,l
    call D_HEX2
    ld hl,(RESULT+4)
    ld bc,T_EXPECT
    or a
    sbc hl,bc
    ld hl,D_PASS
    jr z,.p
    ld hl,D_FAIL
.p:
    ld bc,6
    ldir
    ld hl,K_EV
    ld b,4
.ev:
    ld a,(hl)
    call D_HEX2
    inc hl
    ld a,' '
    ld (de),a
    inc de
    djnz .ev
    ld a,(K_KPMODE)
    add a,'0'
    ld (de),a
    ld hl,0
    ld (GA_X),hl
    ld (GA+2),hl
    ld hl,8 * D_STATLEN
    ld (GA_W),hl
    ld hl,8
    ld (GA+6),hl
    call P_SHIELD
    ld hl,D_HEX
    ld (GA+4),hl
    ld hl,D_STATLEN
    ld (GA+6),hl
    xor a
    call G_SETOP
    call G_TEXT8
    jp P_UNSHIELD

; D_HEX2: A -> two hex digits at DE.  Preserves HL, BC.
D_HEX2:
    push af
    rrca
    rrca
    rrca
    rrca
    call .dig
    pop af
.dig:
    and $0F
    add a,'0'
    cp '9' + 1
    jr c,.d
    add a,7
.d:
    ld (de),a
    inc de
    ret

D_SHIELDALL:
    ld hl,0
    ld (GA_X),hl
    ld (GA+2),hl
    ld hl,512
    ld (GA_W),hl
    ld hl,192
    ld (GA+6),hl
    jp P_SHIELD

D_TITLE:
    DB "LEAP K3 SUM "
D_TITLE_END:
D_PASS:
    DB " PASS "
D_FAIL:
    DB " FAIL "
    ENDIF
