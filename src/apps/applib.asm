; applib.asm -- the app library (docs/APPLIB.md): the view-table builder, the alert, the ask, the name dialog, the title and the
; extension rule, shared by the banked programs.  Code in DOCK 2-3: programs CALL it under mapping A, interrupts on.  It keeps
; no state between calls: each call takes the program's own words.  The strings the kernel draws are in RAM, at AL_RAM
; (written by AL_INIT); its tables are read here, under A, and stay in DOCK 2-3.  IY and the alternate set are kept.

AL_RAM      EQU $C3C0           ; 64 bytes: the top of the program-image area (APPLIB 1)

AL_BEGIN:
; AL_INIT: AL_RAM written.  Clobbers AF, BC, DE, HL.
AL_INIT:
    ld hl,AL_STRS
    ld de,AL_SOK
    ld bc,AL_STRS_LEN
    ldir
    ret

; AL_DIALOG: HL -> a word (0 until made), DE -> a dialog table (the Dialog's 8 bytes, then a view table): IX = the dialog,
; made with its views the first time and kept in the word.  Clobbers AF, BC, DE, HL.
AL_DIALOG:
    ld a,(hl)
    inc hl
    or (hl)
    jr z,.make
    ld a,(hl)
    dec hl
    ld l,(hl)
    ld h,a
    push hl
    pop ix
    ret
.make:
    push hl
    push de
    ld hl,CL_Dialog
    call K_NEW
    pop hl
    call al_rect
    call AL_VIEWS
    pop hl
    push ix
    pop de
    ld (hl),d
    dec hl
    ld (hl),e
    ret

; AL_VIEWS: IX = a parent view, HL -> a view table (APPLIB 3): AL_VIEW for each entry, up to a class of 0.  IX = the parent.
; Clobbers AF, BC, DE, HL.
AL_VIEWS:
    ld a,(hl)
    inc hl
    or (hl)
    dec hl
    ret z
    call AL_VIEW
    jr AL_VIEWS

; AL_VIEW: IX = a parent view, HL -> a view-table entry: the view made (AL_NEW) and added as the parent's last child; a Dialog
; parent's default and cancel set by the roles.  DE = the view, HL past the entry, IX = the parent.  Clobbers AF, BC.
AL_VIEW:
    push ix                     ; the parent
    call AL_NEW
    push ix
    pop de                      ; DE = the view
    pop ix
    bit 0,c
    jr z,.nd
    ld (ix+Dialog_default),e
    ld (ix+Dialog_default+1),d
.nd:
    bit 1,c
    jr z,.nc
    ld (ix+Dialog_cancel),e
    ld (ix+Dialog_cancel+1),d
.nc:
    push hl
    push de
    push ix
    KFAR K_ADDCHILD
    pop ix
    pop de
    pop hl
    ret

; AL_NEW: HL -> a view-table entry (APPLIB 3): IX = a new view of its class, its rectangle, flags and id set, its word at offset 16
; (at 17 with role bit 3: a Window's title, an Icon's name), a Field's cap 30 with role bit 2.  C = the role, HL past the entry.
; Clobbers AF, B, DE.
AL_NEW:
    ld e,(hl)
    inc hl
    ld d,(hl)
    inc hl
    push hl
    ex de,hl
    call K_NEW
    pop hl
    call al_rect
    ld c,(hl)                   ; the role
    inc hl
    push ix
    pop de
    ld a,16
    bit 3,c
    jr z,.w
    inc a
.w:
    add a,e
    ld e,a
    adc a,d
    sub e
    ld d,a
    ld a,(hl)
    ld (de),a
    inc hl
    inc de
    ld a,(hl)
    ld (de),a
    inc hl
    bit 2,c
    ret z
    ld (ix+Field_cap),30
    ret

; AL_ADD: IX = a view, HL -> the word holding its parent: the view added as the parent's last child.  IX kept.  Clobbers AF, BC,
; DE, HL.
AL_ADD:
    push ix
    pop de
    push ix
    ld a,(hl)
    inc hl
    ld h,(hl)
    ld l,a
    push hl
    pop ix
    KFAR K_ADDCHILD
    pop ix
    ret

; al_rect: 8 bytes from HL to IX + 8 (x, y, w, h, flags, id); HL past them.  Clobbers AF, BC, DE.
al_rect:
    push ix
    pop de
    ld a,8
    add a,e
    ld e,a
    adc a,d
    sub e
    ld d,a
    ld bc,8
    ldir
    ret

; AL_ALERT: HL -> the program's alert word, DE -> a message (in RAM; a 13 breaks it into two lines): the alert (APPLIB 4), made
; the first time, its Label holding the message, opened.  Clobbers AF, BC, DE, HL, IX.
AL_ALERT:
    push de
    ld de,AL_TALR
    call AL_DIALOG
    pop de
    ld l,(ix+View_child)        ; its Label
    ld h,(ix+View_child+1)
    ld bc,Label_text
    add hl,bc
    ld (hl),e
    inc hl
    ld (hl),d
    jr al_open

; AL_ASK: HL -> the program's ask word: "Discard the document?" (APPLIB 4), made the first time, opened.  Clobbers AF, BC, DE,
; HL, IX.
AL_ASK:
    ld de,AL_TASK
    call AL_DIALOG
al_open:
    KFAR W_OPEN
    ret

; AL_NAMEDLG: HL -> the program's name-dialog word, DE -> 4 words: the Label's text, the Field's buffer, the Button's text, the
; Field's text.  The dialog (APPLIB 4), made the first time, takes the first three words (at offset 16 of its first three
; views), the Field the text (caret at the end); it is opened with the Field focused.  IX = the Field.  Clobbers AF, BC, DE, HL.
AL_NAMEDLG:
    push de
    ld de,AL_TNAME
    call AL_DIALOG
    pop hl
    push ix
    ld e,(ix+View_child)
    ld d,(ix+View_child+1)
    ld b,3
.v:
    push de
    pop ix
    ld a,(hl)
    ld (ix+16),a
    inc hl
    ld a,(hl)
    ld (ix+17),a
    inc hl
    ld a,b
    cp 2
    jr nz,.nf
    ld (AL_FLD),ix
.nf:
    ld e,(ix+View_next)
    ld d,(ix+View_next+1)
    djnz .v
    ld a,(hl)
    inc hl
    ld h,(hl)
    ld l,a
    ld ix,(AL_FLD)
    KFAR TK_SETTEXT             ; (the window is closed: nothing drawn)
    pop ix
    KFAR W_OPEN
    ld de,(AL_FLD)
    KFAR K_SETFOCUS
    ld ix,(AL_FLD)
    ret

; AL_TITLE: IX = a window, HL -> a prefix, DE -> a name (either may be empty), BC -> a 40-byte buffer: the buffer
; = the prefix and the name (a length byte, at most 39 codes), the window's title word -> it.  With carry set on entry, the
; title row (x, y, w, 8) is also made dirty (W_INVAL).  Clobbers AF, BC, DE, HL.
AL_TITLE:
    push af
    ld (ix+Window_title),c
    ld (ix+Window_title+1),b
    push de
    ld a,(de)
    ld e,c
    ld d,b
    add a,(hl)
    ld (de),a
    inc de
    ld c,(hl)
    ld b,0
    inc hl
    call al_ldir                ; the prefix's codes
    pop hl
    ld c,(hl)
    inc hl
    call al_ldir                ; the name's codes
    pop af
    ret nc
    ld l,(ix+View_x)
    ld h,(ix+View_x+1)
    ld (GA),hl
    ld l,(ix+View_y)
    ld h,b                      ; (B = 0)
    ld (GA+2),hl
    ld l,(ix+View_w)
    ld h,(ix+View_w+1)
    ld (GA+4),hl
    ld l,8
    ld h,b
    ld (GA+6),hl
    KFAR W_INVAL
    ret

; al_ldir: LDIR of C codes (B = 0); none when C = 0.
al_ldir:
    inc c
    dec c
    ret z
    ldir
    ret

; AL_EXTNAME: HL -> a name (a length byte, at most 30 codes), DE -> an extension (4 codes): added when the name has no "." and
; the result fits in 30 codes (WRITE 13.2).  An empty name is left.  Clobbers AF, BC, DE, HL.
AL_EXTNAME:
    ld a,(hl)
    or a
    ret z
    ld c,a
    ld b,a
    push hl
.dot:
    inc hl
    ld a,(hl)
    cp '.'
    jr z,.x
    djnz .dot
    ld a,c
    cp 27
    jr nc,.x                    ; it does not fit
    ex (sp),hl
    add a,4
    ld (hl),a
    pop hl
    inc hl
    ex de,hl
    ld bc,4
    ldir
    ret
.x:
    pop hl
    ret

; The standard dialogs (APPLIB 4): the alert, the ask, the name dialog.
AL_TALR:
    DW 128
    DB 64
    DW 256
    DB 64, 0, 0
    DW CL_Label, 144
    DB 76
    DW 224
    DB 18, 0, 0, 0              ; two lines (a message's 13)
    DW 0
    DW CL_Button, 304
    DB 100
    DW 64
    DB 16, $11, 1, 3
    DW AL_SOK
    DW 0
AL_TASK:
    DW 128
    DB 64
    DW 256
    DB 64, 0, 0
    DW CL_Label, 144
    DB 76
    DW 200
    DB 9, 0, 0, 0
    DW AL_SASK
    DW CL_Button, 224
    DB 100
    DW 64
    DB 16, $11, 1, 1
    DW AL_SDISC
    DW CL_Button, 304
    DB 100
    DW 64
    DB 16, 1, 2, 2
    DW AL_SCANC
    DW 0
AL_TNAME:
    DW 128
    DB 56
    DW 256
    DB 80, 0, 0
    DW CL_Label, 144
    DB 68
    DW 200
    DB 9, 0, 0, 0
    DW 0
    DW CL_Field, 144
    DB 84
    DW 224
    DB 12, 1, 1, 4
    DW 0
    DW CL_Button, 224
    DB 108
    DW 64
    DB 16, $11, 1, 1
    DW 0
    DW CL_Button, 304
    DB 108
    DW 64
    DB 16, 1, 2, 2
    DW AL_SCANC
    DW 0

; AL_RAM: a word (the name dialog's Field, AL_NAMEDLG), then the strings (AL_INIT copies them).
AL_FLD      EQU AL_RAM
AL_STRS:
    DISP AL_RAM + 2
AL_SOK:     DB 2, "OK"
AL_SCANC:   DB 6, "Cancel"
AL_SDISC:   DB 7, "Discard"
AL_SASK:    DB 21, "Discard the document?"
    ENT
AL_STRS_LEN EQU $ - AL_STRS
    ASSERT AL_RAM + 2 + AL_STRS_LEN <= AL_RAM + 64 && AL_RAM + 64 == AARENA_BASE
AL_END:
