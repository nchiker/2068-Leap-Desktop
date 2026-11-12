"use strict";
// calc-model.mjs -- reference model of Calculator (docs/CALCULATOR.md sections 5 and 6), exact, with BigInt rationals.
// Written from the contract only; the Z80 code (src/apps/calc.asm) was never read.
//
//   node tests/calc-model.mjs --self-test      hand-worked cases of the model itself
//
// The model:  class Calc { key(k) -> the display string }.  State: X, OP, E, ENT, ERR (section 5).
//
// Representation: a value s x M / 10^d (section 6) is held as the BigInt N = s x M x 10^(7 - d): the value times 10^7, an integer because
// d <= 7.  `fmt(N)` and `norm` recover (s, M, d) in normal form (d as small as it can be; 0 has s = +1, which an integer N = 0 gives).
//
// Readings of the contract (the same ones the tests use; none changes a number the contract fixes):
//  R1. Key codes are ASCII: the digits 48..57, '.', '+', '-', '*', '/', '=', ENTER 13 (as '='), DELETE 12, ESC 27, BREAK 3, 'c' (clear all),
//      'e' (clear entry), 'n' (change sign).  Any other code is not a Calculator key: nothing changes (not even while ERR).
//  R2. "A digit ... E of "0" or "-0" has its 0 replaced": the digit replaces the 0 only when E is exactly "0" or "-0"; E = "0." and
//      "-0." keep their 0 ("0.5").  An E of 8 digits (a leading 0 before '.' counts as one) takes no further digit; '.' is still taken
//      while E has no '.'.
//  R3. An operation that sets ERR leaves X unspecified (nothing can read it: only C or CE act while ERR, and both clear X).  The model
//      stores X = 0.  The operator key that caused ERR still sets OP = o (section 5 says "in both cases"); '=' sets OP = none.  Both are
//      unobservable for the same reason.
//  R4. The operators work on a pending OP only when ENT = 1 (section 5): with ENT = 0 a second operator only replaces the first.
//  R5. "Back space ... only while ENT": with ENT = 0 (or ERR) nothing happens.
//  R6. CE while not ERR: E = "0", ENT = 1 (even when ENT was 0: the display then shows "0" and the next digit replaces it).
import { fileURLToPath } from 'node:url';

export const SCALE = 10_000_000n;            // 10^7
export const LIM = 100_000_000n;             // 10^8
const P10 = [1n, 10n, 100n, 1000n, 10_000n, 100_000n, 1_000_000n, 10_000_000n];
const OPS = '+-*/';
export const OPCODES = [43, 45, 42, 47];

export const isDigit = (k) => k >= 48 && k <= 57;
/** The whole key set of section 5 (codes). */
export const KEYSET = [...Array.from({ length: 10 }, (_, i) => 48 + i), 46, 43, 45, 42, 47, 61, 13, 12, 27, 3, 99, 101, 110];
export const isKey = (k) => KEYSET.includes(k);

/** round half away from zero of p / q (q > 0), p >= 0 */
const roundDiv = (p, q) => (2n * p + q) / (2n * q);

/**
 * Section 6: the representable value nearest to the exact rational v = p / q (q > 0, p any sign): the largest d <= 7 with
 * round(|v| 10^d) < 10^8, in normal form.  Returns the scaled integer N, or null for ERR.
 */
export function roundRat(p, q) {
  const s = p < 0n ? -1n : 1n, ap = p < 0n ? -p : p;
  for (let d = 7; d >= 0; d--) {
    const M = roundDiv(ap * P10[d], q);
    if (M < LIM) return M === 0n ? 0n : s * M * P10[7 - d];
  }
  return null;
}

/** An operation X OP y on scaled integers; null = ERR.  op is one of '+', '-', '*', '/'. */
export function operate(nx, op, ny) {
  switch (op) {
    case '+': return roundRat(nx + ny, SCALE);
    case '-': return roundRat(nx - ny, SCALE);
    case '*': return roundRat(nx * ny, SCALE * SCALE);
    case '/': return ny === 0n ? null : divRound(nx, ny);
    default: throw new Error(`operate: ${op}`);
  }
}
// v = nx / ny exactly (both scaled by 10^7, so the scales cancel); q must be positive
function divRound(nx, ny) { return ny < 0n ? roundRat(-nx, -ny) : roundRat(nx, ny); }

/** (s, M, d) of a scaled integer in normal form. */
export function parts(n) {
  const s = n < 0n ? -1 : 1;
  let M = n < 0n ? -n : n, d = 7;
  while (d > 0 && M % 10n === 0n) { M /= 10n; d--; }
  if (M === 0n) return { s: 1, M: 0n, d: 0 };
  return { s, M, d };
}
/** Section 6's format. */
export function fmt(n) {
  const { s, M, d } = parts(n);
  const sign = s < 0 ? '-' : '';
  if (d === 0) return sign + M.toString();
  const t = P10[d], ip = M / t, fp = (M % t).toString().padStart(d, '0');
  return `${sign}${ip}.${fp}`;
}
/** The scaled integer of a value s x M / 10^d. */
export const scaled = (s, M, d) => BigInt(s) * BigInt(M) * P10[7 - d];

/** The value of the entry string E (section 6): exact. */
export function valueOfE(E) {
  let s = 1n, t = E;
  if (t.startsWith('-')) { s = -1n; t = t.slice(1); }
  const dot = t.indexOf('.');
  const d = dot < 0 ? 0 : t.length - dot - 1;
  const digits = t.replace('.', '');
  const M = digits === '' ? 0n : BigInt(digits);
  return s * M * P10[7 - d];
}

export class Calc {
  constructor() { this.clearAll(); }
  clearAll() { this.X = 0n; this.OP = null; this.E = ''; this.ENT = 0; this.ERR = 0; }
  display() { return this.ERR ? 'Error' : this.ENT ? this.E : fmt(this.X); }
  nDigits() { return (this.E.match(/[0-9]/g) || []).length; }
  /** Feed one key code; returns the display string. */
  key(k) {
    const ch = String.fromCharCode(k);
    if (k === 99 || k === 27 || k === 3) { this.clearAll(); return this.display(); }               // C
    if (!isKey(k)) return this.display();
    if (this.ERR) { if (k === 101) this.clearAll(); return this.display(); }                       // only C and CE, both as C
    if (isDigit(k)) {
      if (!this.ENT) { this.E = ''; this.ENT = 1; }
      if (this.nDigits() < 8) { if (this.E === '0' || this.E === '-0') this.E = this.E.slice(0, -1) + ch; else this.E += ch; }
    } else if (k === 46) {
      if (!this.ENT) { this.E = '0.'; this.ENT = 1; } else if (!this.E.includes('.')) this.E += '.';
    } else if (k === 12) {
      if (this.ENT) { this.E = this.E.slice(0, -1); if (this.E === '' || this.E === '-') this.E = '0'; }
    } else if (k === 110) {
      if (this.ENT) this.E = this.E.startsWith('-') ? this.E.slice(1) : '-' + this.E;
      else this.X = -this.X;
    } else if (k === 101) {
      this.E = '0'; this.ENT = 1;
    } else if (OPS.includes(ch)) {
      if (this.ENT) {
        const y = valueOfE(this.E);
        if (this.OP) { const r = operate(this.X, this.OP, y); if (r === null) { this.ERR = 1; this.X = 0n; } else this.X = r; }
        else this.X = y;
        this.ENT = 0;
      }
      this.OP = ch;
    } else if (k === 61 || k === 13) {
      if (this.OP) {
        const y = this.ENT ? valueOfE(this.E) : this.X;
        const r = operate(this.X, this.OP, y);
        if (r === null) { this.ERR = 1; this.X = 0n; } else this.X = r;
        this.OP = null; this.ENT = 0;
      } else if (this.ENT) { this.X = valueOfE(this.E); this.ENT = 0; }
    }
    return this.display();
  }
  /** Feed a key string (characters; 'D' = DELETE 12, 'R' = ENTER 13, 'S' = ESC 27, 'B' = BREAK 3); returns the display after the last key. */
  keys(str) { let d = this.display(); for (const k of keyCodes(str)) d = this.key(k); return d; }
}

/** A key string as codes: the characters themselves, except 'D' = 12 (DELETE), 'R' = 13 (ENTER), 'S' = 27 (ESC), 'B' = 3 (BREAK). */
export function keyCodes(str) {
  const SP = { D: 12, R: 13, S: 27, B: 3 };
  return Array.from(str, (c) => SP[c] ?? c.charCodeAt(0));
}

/**
 * The key string that types the value s x M / 10^d into a cleared / pending state: the digits with the point in place, then 'n' for a minus.
 * `extra` extra zeros after the point are typed when the digit count allows (so that E is not in normal form: "1.50").
 */
export function typeValue(s, M, d) {
  let digits = BigInt(M).toString();
  if (d > 0) {
    digits = digits.padStart(d + 1, '0');
    digits = digits.slice(0, digits.length - d) + '.' + digits.slice(digits.length - d);
  }
  return digits + (s < 0 ? 'n' : '');
}

// ===========================================================================================================================
function selfTest() {
  let n = 0, fails = 0;
  const eq = (name, got, want) => { n++; if (got !== want) { fails++; console.log(`FAIL: ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); } };
  const run = (s) => new Calc().keys(s);
  // each value worked by hand from section 6
  eq('1/3 = 0.3333333 (d = 7: round(3333333.33) = 3333333)', run('1/3='), '0.3333333');
  eq('2/3 = 0.6666667', run('2/3='), '0.6666667');
  eq('-1/3 = -0.3333333', run('1n/3='), '-0.3333333');
  eq('100/3 = 33.333333 (d = 7 gives 333333333 >= 10^8, d = 6 gives 33333333)', run('100/3='), '33.333333');
  eq('7/2 = 3.5', run('7/2='), '3.5');
  eq('1/0 is an error', run('1/0='), 'Error');
  eq('0/0 is an error', run('0/0='), 'Error');
  eq('99999999+1 is an error (10^8 has no d >= 0)', run('99999999+1='), 'Error');
  eq('99999999+0.5 is an error (round(100000000.5) = 100000001)', run('99999999+0.5='), 'Error');
  eq('99999999-0.5 = 99999999 (round(99999998.5) = 99999999, halves away from zero)', run('99999999-0.5='), '99999999');
  eq('9999999.9+0.05 = 10000000 (d = 1 rounds up to 10^8, so d = 0: round(9999999.95) = 10000000)', run('9999999.9+0.05='), '10000000');
  eq('0.0000001*0.5 = 0.0000001 (round(0.5) = 1)', run('0.0000001*0.5='), '0.0000001');
  eq('0.0000001*0.4 = 0 (round(0.4) = 0)', run('0.0000001*0.4='), '0');
  eq('-0.0000001*0.4 = 0, not -0', run('0.0000001n*0.4='), '0');
  eq('0.0000001 shows as typed in E', run('0.0000001'), '0.0000001');
  eq('0.0000001n shows -0.0000001', run('0.0000001n'), '-0.0000001');
  eq('123456789 takes 8 digits only', run('123456789'), '12345678');
  eq('0.12345678: the leading 0 counts, so 0.1234567', run('0.12345678'), '0.1234567');
  eq('007 -> 7 (a leading 0 is replaced)', run('007'), '7');
  eq('. alone -> 0.', run('.'), '0.');
  eq('1.2.3 -> 1.23', run('1.2.3'), '1.23');
  eq('back space: 12 -> 1', run('12D'), '1');
  eq('back space of the last digit -> 0', run('1D'), '0');
  eq('back space of -5 -> 0', run('5nD'), '0');
  eq('1.50 stays "1.50" while typed; = gives 1.5', [run('1.50'), run('1.50=')].join(','), '1.50,1.5');
  eq('n twice is the identity: 5n n -> 5', run('5nn'), '5');
  eq('+/- on X after =: 2+3= n -> -5', run('2+3=n'), '-5');
  eq('+/- on a zero X stays 0', run('0+0=n'), '0');
  eq('2+3*4= is immediate execution: (2+3)*4 = 20', run('2+3*4='), '20');
  eq('a second operator replaces the first: 6+*2= -> 12', run('6+*2='), '12');
  eq('= repeats with y = X: 6*= -> 36', run('6*='), '36');
  eq('3+= -> 6', run('3+='), '6');
  eq('5= -> 5 (OP none, ENT: X = value of E)', run('5='), '5');
  eq('= alone does nothing -> 0', run('='), '0');
  eq('ENTER works as =', run('2+2R'), '4');
  eq('while ERR digits do nothing', run('1/0=5'), 'Error');
  eq('CE while ERR clears all', run('1/0=e'), '0');
  eq('C after ERR', run('1/0=c'), '0');
  eq('CE then 5 -> 5 (the 0 is replaced)', run('7+e5='), '12');
  eq('ESC clears', run('7+3S'), '0');
  eq('BREAK clears', run('7+3B'), '0');
  eq('after 7+3 the display is 3 (E) and after + it is 10 (X)', [run('7+3'), run('7+3+')].join(','), '3,10');
  eq('non-keys change nothing', run('12qx 3'), '123');
  eq('-0 then 5 -> -5 (the 0 is replaced)', run('0n5'), '-5');
  eq('0.5n -> -0.5', run('0.5n'), '-0.5');
  eq('0.1+0.2= -> 0.3', run('0.1+0.2='), '0.3');
  eq('-5/2 -> -2.5', run('5n/2='), '-2.5');
  eq('1/8 -> 0.125', run('1/8='), '0.125');
  eq('99999999*99999999 -> Error', run('99999999*99999999='), 'Error');
  eq('1/7 -> 0.1428571', run('1/7='), '0.1428571');
  eq('0.5+0.5 -> 1', run('0.5+0.5='), '1');
  eq('3-5 -> -2', run('3-5='), '-2');
  eq('1.5*1.5 -> 2.25', run('1.5*1.5='), '2.25');
  eq('1234.5678*100 -> 123456.78 (d=2: round(12345678.00) = 12345678 < 10^8, d=3 -> 123456780 too large)', run('1234.5678*100='), '123456.78');
  eq('typeValue(-1, 5, 3) = "0.005n"', typeValue(-1, 5, 3), '0.005n');
  eq('format of 0 / -1 / 0.0000001', [fmt(0n), fmt(-SCALE), fmt(1n)].join(','), '0,-1,0.0000001');
  console.log(`calc-model self-test: ${n - fails} of ${n} passed`);
  process.exitCode = fails ? 1 : 0;
}
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--self-test')) selfTest();
