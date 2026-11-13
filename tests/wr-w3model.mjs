"use strict";
// wr-w3model.mjs -- reference model of Write W3 (docs/WRITE.md 13, with the as-built clarifications of the main model, 2026-11-12) and of the file calls' text mode (docs/FILES.md 2), beside tests/wr-model.mjs.
// Written from the contract and the as-built list only; src/apps/write.asm and src/apps/files.asm were not used for any expectation.
//   * `textIn` / `textOut` / `nameOk`: FILES 2 (written here again from the contract, NOT imported from web/fshost.js, so that the host's own code is judged too);
//   * `W3`: the document (a wr-model Doc), its name, the dialog state, and the effects of Save and Open (13.1-13.4, clarifications 1-8);
//   * the looks of the Save dialog and of the alert (13.2, 13.4, clarification 1 and 2) as gfx6-model drawing: `saveDraw`, `alertDraw`.
import * as WM from './wr-model.mjs';
import { dialogLook, labelLook, buttonLook } from './wm-model2.mjs';
import { fieldLook, fieldKey, fieldSetText } from './tk-model2.mjs';

export const { Doc, codesOf, textOf, CAP, MAXLINES } = WM;
export let GLH = 9;
export const setGlh = (v) => { GLH = v; };
export const MAXNAME = 30, UNTITLED = 'Untitled';

/** FILES 2: text mode, reading: CR LF, LF and CR each become 13; TAB a space; other codes below 32 dropped; codes above 126 become '?' (63). */
export function textIn(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 13) { out.push(13); if (i + 1 < bytes.length && bytes[i + 1] === 10) i++; }
    else if (b === 10) out.push(13);
    else if (b === 9) out.push(32);
    else if (b < 32) { /* dropped */ }
    else if (b > 126) out.push(63);
    else out.push(b);
  }
  return out;
}
/** FILES 2: text mode, writing: each 13 becomes the host's line end (LF). */
export const textOut = (codes) => codes.map((c) => (c === 13 ? 10 : c));
/** FILES 2: 1-30 codes from 32-126, none of / \ : * ? " < > |. */
export function nameOk(codes) {
  if (codes.length < 1 || codes.length > MAXNAME) return false;
  return codes.every((c) => c >= 32 && c <= 126 && !'/\\:*?"<>|'.includes(String.fromCharCode(c)));
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The alert (13.4, clarification 1)
export const MSG = {
  saveFail: 'The file could not be saved.',
  openFail: 'The file could not be opened.',
  tooLong: 'The file is too long for Notepad\r(5,120 characters).',            // \r = code 13: a line break
  tooMany: 'The file has too many lines\rfor Notepad (1,024).',
};
export const ALERT = { dlg: { x: 128, y: 64, w: 256, h: 64 }, label: { x: 144, y: 76, w: 224, h: 18 }, ok: { x: 304, y: 100, w: 64, h: 16, text: 'OK' } };
export const SAVE = {
  dlg: { x: 128, y: 56, w: 256, h: 80 }, label: { x: 144, y: 68, w: 200, h: 9, text: 'Save as:' }, field: { x: 144, y: 84, w: 224, h: 12, cap: 30, flags: 1, id: 1 },
  save: { x: 224, y: 108, w: 64, h: 16, text: 'Save' }, cancel: { x: 304, y: 108, w: 64, h: 16, text: 'Cancel' },
};
const stub = { draw() {}, post() {}, noteFull() {} };

/** The alert as drawn: Dialog, Label (two lines when the message holds a 13: 9 rows apart), the default button "OK" (focused when `focused`). */
export function alertDraw(g, msg, focused = true) {
  const a = ALERT;
  dialogLook(g, a.dlg);
  g.setGlh?.(GLH);
  labelLook(g, { ...a.label, flags: 0, text: { codes: codesOf(msg) } });
  g.setGlh?.(8);
  buttonLook(g, { x: a.ok.x, y: a.ok.y, w: a.ok.w, h: a.ok.h, flags: 0x11, text: { codes: codesOf(a.ok.text) } }, focused);
}
/** The Field of the Save dialog: { buf (codes), caret, first } as TK_SETTEXT leaves it (caret at the end), then edited by keys (tk-model2's Field model). */
export function newSaveField(nameCodes) {
  const f = { ...SAVE.field, buf: [], caret: 0, first: 0 };
  fieldSetText(stub, f, nameCodes);
  return f;
}
export const fieldTyped = (f, code) => fieldKey(stub, f, code);
/** The Save dialog as drawn; the Field focused (caret) unless `focus` says another (1 Save button, 2 Cancel button). */
export function saveDraw(g, f, focus = 0) {
  const s = SAVE;
  dialogLook(g, s.dlg);
  labelLook(g, { ...s.label, flags: 0, text: { codes: codesOf(s.label.text) } });
  fieldLook(g, f, focus === 0);
  buttonLook(g, { x: s.save.x, y: s.save.y, w: s.save.w, h: s.save.h, flags: 0x11, text: { codes: codesOf(s.save.text) } }, focus === 1);
  buttonLook(g, { x: s.cancel.x, y: s.cancel.y, w: s.cancel.w, h: s.cancel.h, flags: 1, text: { codes: codesOf(s.cancel.text) } }, focus === 2);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
/** What Save does to the name typed in the Field (13.2 steps 1-2): null for an empty name (nothing saved), else the name used (".txt" added when it has no "." and fits in 30). */
export function saveName(typed) {
  if (typed.length === 0) return null;
  if (!typed.includes(46) && typed.length + 4 <= MAXNAME) return [...typed, ...codesOf('.txt')];
  return typed.slice();
}

/**
 * The document and its name.  Methods apply 13.2 / 13.3 given what the host does; each returns what the Z80 should have shown:
 *   save(typed, host)  host: { open: bool (FS_OPEN of the write succeeds), write: bool (every FS_WRITE succeeds) } -> { saved: codes | null, alert: message | null }
 *   open(picked, file, opts) file: the host's bytes; opts { pickOk, openOk, readOk (the read gives all its codes) } -> { alert: message | null }
 */
export class W3 {
  constructor() { this.doc = new Doc(); this.name = codesOf(UNTITLED); }
  get title() { return 'Notepad: ' + textOf(this.name); }
  clone() { const w = new W3(); w.doc = this.doc.clone(); w.name = this.name.slice(); return w; }
  /** "New" (13.1, clarification 6): an empty document, the name "Untitled" (the clipboard is kept: 12.1). */
  newDoc() { this.doc.reset(); this.name = codesOf(UNTITLED); }
  save(typed, host = {}) {
    const n = saveName(typed);
    if (n === null) return { saved: null, alert: null, name: null };
    const ok = (host.open ?? true) && (host.write ?? true) && (host.close ?? true) && nameOk(n);
    if (!ok) return { saved: null, alert: MSG.saveFail, name: n };
    this.name = n; this.doc.changed = false;
    return { saved: textOut(this.doc.codes), alert: null, name: n };
  }
  /** Open of a picked file (13.3 after the discard dialog): `file` the host's bytes (before text conversion); `picked` the name the pick gave. */
  open(picked, file, opts = {}) {
    if (!(opts.pickOk ?? true) || !(opts.openOk ?? true) || !nameOk(picked)) return { alert: MSG.openFail };
    const codes = textIn(file);
    if (codes.length > CAP) return { alert: MSG.tooLong };
    if (!(opts.readOk ?? true)) { const clip = this.doc.clip; this.doc = new Doc(); this.doc.clip = clip; this.name = codesOf(UNTITLED); return { alert: MSG.openFail }; }
    const d = new Doc(codes);
    d.clip = this.doc.clip;
    if (d.nl > MAXLINES) { const clip = this.doc.clip; this.doc = new Doc(); this.doc.clip = clip; this.name = codesOf(UNTITLED); return { alert: MSG.tooMany }; }
    this.doc = d; this.name = picked.slice();
    return { alert: null };
  }
}
