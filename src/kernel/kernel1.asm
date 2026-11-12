; kernel1.asm -- the kernel's second part, assembled by each cartridge in DOCK chunk 1 after the gfx6 tables (docs/WINDOWS.md 2,
; 16.4): chunk 5 holds the rest of the kernel and is full.  Always mapped, like chunk 5.  Its bytes count with K_CODE's.
K1_CODE:
    INCLUDE "kernel/menu.asm"
K1_CODE_END:
