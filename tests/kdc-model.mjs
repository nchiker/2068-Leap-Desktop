"use strict";
// kdc-model.mjs -- reference model of the kernel's double-click flag (docs/WRITE.md 14.9 item 1; docs/OBJECTS_EVENTS.md section 6, data 3 bit 2 of E_DOWN).  Written from the contract only.
//
// Every E_DOWN the ISR queues carries data 3 bit 2 = 1 when it is a double-click:
//   * the previous E_DOWN (anywhere on the screen) was at most 20 frames earlier: presses in frames f1 and f2 with f2 - f1 <= 20;
//   * it was at most 8 pixels across (9-bit x) and 4 down: |x2 - x1| <= 8, |y2 - y1| <= 4;
//   * and that previous press was not itself a double-click.
// The machine's three variables (K_DCN at $F0B5, K_DCX word at $F0B6, K_DCY at $F0B8), as 14.9 gives them:
//   * K_DCN holds the frames left: at the start of each frame's K_POLL it drops by 1 when it is not 0;
//   * at a press: K_DCN != 0 and the press near -> the flag is set and K_DCN = 0; otherwise K_DCN = 21;
//   * the press's position is always kept in K_DCX / K_DCY.  Boot clears all three.
export const KDC_FRAMES = 20, KDC_DX = 8, KDC_DY = 4, KDC_LOAD = 21;
export class KDc {
  constructor() { this.n = 0; this.x = 0; this.y = 0; }
  /** The start of a frame's K_POLL. */
  frame() { if (this.n !== 0) this.n--; }
  /** A press at (x, y) (x 0..511, y 0..191) polled in this frame (after this frame's `frame()`): the flag. */
  press(x, y) {
    const near = Math.abs(x - this.x) <= KDC_DX && Math.abs(y - this.y) <= KDC_DY;
    let flag = false;
    if (this.n !== 0 && near) { flag = true; this.n = 0; } else this.n = KDC_LOAD;
    this.x = x; this.y = y;
    return flag;
  }
}
/**
 * The same rule with absolute frame numbers (for the tests that inject records: no ISR runs, so no K_POLL counts frames): press(f, x, y) with f the frame in which the press is polled.
 * Equivalent to KDc: a press is a double when the previous press was <= 20 frames earlier, near, and was not itself a double.
 */
export class KDcAbs {
  constructor() { this.armed = false; this.f = 0; this.x = 0; this.y = 0; }
  press(f, x, y) {
    const near = Math.abs(x - this.x) <= KDC_DX && Math.abs(y - this.y) <= KDC_DY;
    const flag = this.armed && near && (((f - this.f) & 0xFFFF) <= KDC_FRAMES);
    this.armed = !flag; this.f = f; this.x = x; this.y = y;
    return flag;
  }
}
