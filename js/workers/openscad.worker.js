/**
 * Board2CAD — Full OpenSCAD AST & CSG Compiler Web Worker (js/workers/openscad.worker.js)
 *
 * Compiles ANY parametric OpenSCAD (.scad) script into:
 *   1. Colored 3D Mesh Buffers for instant Three.js rendering (preserving all color() calls)
 *   2. Binary .STL (100% Manifold / Watertight for Fusion 360)
 *   3. Multicolor .3MF v1.2 Archive (for Bambu Studio / PrusaSlicer / OrcaSlicer)
 *
 * Also parses uploaded external .STL (Binary/ASCII) and .3MF files into viewerParts.
 */

// ============================================================================
// 1. TOKENIZER (LEXER) FOR OPENSCAD
// ============================================================================

const CSS_NAMED_COLORS = {
  black: '#111111',
  white: '#f8fafc',
  red: '#ef4444',
  green: '#15803d',
  blue: '#1d4ed8',
  yellow: '#eab308',
  cyan: '#06b6d4',
  magenta: '#d946ef',
  silver: '#cbd5e1',
  gray: '#64748b',
  grey: '#64748b',
  gold: '#d4af37',
  orange: '#f97316',
  purple: '#9333ea',
  brown: '#8c6239',
  dimgray: '#475569',
  darkslategray: '#1e293b',
  darkgreen: '#14532d',
  darkblue: '#1e3a8a'
};

function tokenizeScad(code) {
  const tokens = [];
  let i = 0;
  let line = 1;
  const len = code.length;

  while (i < len) {
    const ch = code[i];

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      line++;
      i++;
      continue;
    }

    // Single-line comment //
    if (ch === '/' && code[i + 1] === '/') {
      i += 2;
      while (i < len && code[i] !== '\n') i++;
      continue;
    }

    // Block comment /* ... */
    if (ch === '/' && code[i + 1] === '*') {
      i += 2;
      while (i < len && !(code[i] === '*' && code[i + 1] === '/')) {
        if (code[i] === '\n') line++;
        i++;
      }
      i += 2;
      continue;
    }

    // String literal "..." (supports \" escaped quotes)
    if (ch === '"') {
      let str = '';
      i++;
      while (i < len && code[i] !== '"') {
        if (code[i] === '\\' && i + 1 < len) {
          const next = code[i + 1];
          if (next === 'n') str += '\n';
          else if (next === 't') str += '\t';
          else str += next;
          i += 2;
        } else {
          if (code[i] === '\n') line++;
          str += code[i++];
        }
      }
      i++; // closing "
      tokens.push({ type: 'STRING', value: str, line });
      continue;
    }

    // Number literal
    if (
      (ch >= '0' && ch <= '9') ||
      (ch === '.' && code[i + 1] >= '0' && code[i + 1] <= '9')
    ) {
      let numStr = '';
      while (i < len && ((code[i] >= '0' && code[i] <= '9') || code[i] === '.')) {
        numStr += code[i++];
      }
      if (i < len && (code[i] === 'e' || code[i] === 'E')) {
        numStr += code[i++];
        if (i < len && (code[i] === '+' || code[i] === '-')) numStr += code[i++];
        while (i < len && code[i] >= '0' && code[i] <= '9') numStr += code[i++];
      }
      tokens.push({ type: 'NUMBER', value: parseFloat(numStr), line });
      continue;
    }

    // Identifier / Keyword (including $fn, $fa, $fs)
    if (
      (ch >= 'a' && ch <= 'z') ||
      (ch >= 'A' && ch <= 'Z') ||
      ch === '_' ||
      ch === '$'
    ) {
      let id = '';
      while (
        i < len &&
        ((code[i] >= 'a' && code[i] <= 'z') ||
          (code[i] >= 'A' && code[i] <= 'Z') ||
          (code[i] >= '0' && code[i] <= '9') ||
          code[i] === '_' ||
          code[i] === '$')
      ) {
        id += code[i++];
      }
      tokens.push({ type: 'IDENT', value: id, line });
      continue;
    }

    // Two-character operators
    const two = code.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) {
      tokens.push({ type: 'OP', value: two, line });
      i += 2;
      continue;
    }

    // Single-character punctuation & operators
    if ('{}()[];,:=+-*/%^<>!?#*.'.includes(ch)) {
      tokens.push({ type: 'PUNCT', value: ch, line });
      i++;
      continue;
    }

    // Unknown char: skip safely
    i++;
  }

  // Token-level brace balance check (after all // comments, /* */ comments, and "..." strings are stripped)
  let braceDelta = 0;
  const cleanedTokens = [];
  for (const tk of tokens) {
    if (tk.type === 'PUNCT' && tk.value === '{') {
      braceDelta++;
      cleanedTokens.push(tk);
    } else if (tk.type === 'PUNCT' && tk.value === '}') {
      if (braceDelta > 0) {
        braceDelta--;
        cleanedTokens.push(tk);
      }
    } else {
      cleanedTokens.push(tk);
    }
  }
  while (braceDelta > 0) {
    cleanedTokens.push({ type: 'PUNCT', value: '}', line });
    braceDelta--;
  }

  cleanedTokens.push({ type: 'EOF', value: '', line });
  return cleanedTokens;
}

// ============================================================================
// 2. RECURSIVE-DESCENT PARSER FOR OPENSCAD
// ============================================================================

class ScadParser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek(offset = 0) {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  next() {
    return this.tokens[this.pos++];
  }

  match(type, value = null) {
    const t = this.peek();
    if (t.type === type && (value === null || t.value === value)) {
      this.pos++;
      return t;
    }
    return null;
  }

  expect(type, value = null) {
    const t = this.peek();
    if (t.type === type && (value === null || t.value === value)) {
      return this.next();
    }
    throw new Error(
      `Errore di sintassi OpenSCAD alla riga ${t.line}: atteso "${value || type}", trovato "${t.value}"`
    );
  }

  parseProgram() {
    const statements = [];
    while (this.peek().type !== 'EOF') {
      const stmt = this.parseStatement();
      if (stmt) statements.push(stmt);
    }
    return { type: 'Block', statements };
  }

  parseStatement() {
    const t = this.peek();

    if (t.type === 'EOF') return null;

    // Empty semicolon
    if (this.match('PUNCT', ';')) return null;

    // Ignore OpenSCAD modifiers ! # % *
    if (t.type === 'PUNCT' && ['!', '#', '%', '*'].includes(t.value)) {
      const mod = this.next().value;
      const inner = this.parseStatement();
      if (mod === '*') return null; // * disables subtree in OpenSCAD
      return inner;
    }

    // include <...> or use <...>
    if (t.type === 'IDENT' && (t.value === 'include' || t.value === 'use')) {
      this.next();
      if (this.match('PUNCT', '<')) {
        while (this.peek().type !== 'EOF' && !this.match('PUNCT', '>')) {
          this.next();
        }
      }
      this.match('PUNCT', ';');
      return null;
    }

    // Module definition: module name(params) stmt
    if (t.type === 'IDENT' && t.value === 'module') {
      this.next();
      const name = this.expect('IDENT').value;
      const params = this.parseParamDefList();
      const body = this.parseStatement();
      return { type: 'ModuleDef', name, params, body };
    }

    // Function definition: function name(params) = expr;
    if (t.type === 'IDENT' && t.value === 'function') {
      this.next();
      const name = this.expect('IDENT').value;
      const params = this.parseParamDefList();
      this.expect('PUNCT', '=');
      const expr = this.parseExpression();
      this.match('PUNCT', ';');
      return { type: 'FunctionDef', name, params, expr };
    }

    // If / else statement
    if (t.type === 'IDENT' && t.value === 'if') {
      this.next();
      this.expect('PUNCT', '(');
      const cond = this.parseExpression();
      this.expect('PUNCT', ')');
      const thenBranch = this.parseStatement();
      let elseBranch = null;
      if (this.peek().type === 'IDENT' && this.peek().value === 'else') {
        this.next();
        elseBranch = this.parseStatement();
      }
      return { type: 'IfStmt', cond, thenBranch, elseBranch };
    }

    // For loop: for (v1 = expr1, v2 = expr2, ...) stmt
    if (t.type === 'IDENT' && (t.value === 'for' || t.value === 'intersection_for')) {
      this.next();
      this.expect('PUNCT', '(');
      const bindings = [];
      while (this.peek().type !== 'EOF' && !this.match('PUNCT', ')')) {
        if (this.peek().type === 'IDENT') {
          const varName = this.next().value;
          this.expect('PUNCT', '=');
          const rangeExpr = this.parseExpression();
          bindings.push({ varName, rangeExpr });
        } else {
          this.next();
        }
        this.match('PUNCT', ',');
      }
      const body = this.parseStatement();
      return { type: 'ForStmt', bindings, body };
    }

    // Let statement: let (a = 1, b = 2) stmt
    if (t.type === 'IDENT' && t.value === 'let') {
      this.next();
      const args = this.parseCallArgs();
      const body = this.parseStatement();
      return { type: 'LetStmt', args, body };
    }

    // Block { ... }
    if (this.match('PUNCT', '{')) {
      const statements = [];
      while (this.peek().type !== 'EOF' && !this.match('PUNCT', '}')) {
        const s = this.parseStatement();
        if (s) statements.push(s);
      }
      return { type: 'Block', statements };
    }

    // Assignment: ident = expr;
    if (t.type === 'IDENT' && this.peek(1).type === 'PUNCT' && this.peek(1).value === '=') {
      const name = this.next().value;
      this.next(); // '='
      const expr = this.parseExpression();
      this.match('PUNCT', ';');
      return { type: 'Assign', name, expr };
    }

    // Module instantiation / Call: name(args) child_stmt;
    if (t.type === 'IDENT') {
      const name = this.next().value;
      const args = this.peek().value === '(' ? this.parseCallArgs() : [];
      let child = null;
      if (this.match('PUNCT', ';')) {
        child = null;
      } else {
        child = this.parseStatement();
      }
      return { type: 'ModuleCall', name, args, child };
    }

    // Fallback: advance token to avoid infinite loop
    this.next();
    return null;
  }

  parseParamDefList() {
    const params = [];
    this.expect('PUNCT', '(');
    while (this.peek().type !== 'EOF' && !this.match('PUNCT', ')')) {
      if (this.peek().type === 'IDENT') {
        const name = this.next().value;
        let defaultExpr = null;
        if (this.match('PUNCT', '=')) {
          defaultExpr = this.parseExpression();
        }
        params.push({ name, defaultExpr });
      } else {
        this.next();
      }
      this.match('PUNCT', ',');
    }
    return params;
  }

  parseCallArgs() {
    const args = [];
    this.expect('PUNCT', '(');
    while (this.peek().type !== 'EOF' && !this.match('PUNCT', ')')) {
      if (
        this.peek().type === 'IDENT' &&
        this.peek(1).type === 'PUNCT' &&
        this.peek(1).value === '='
      ) {
        const name = this.next().value;
        this.next(); // '='
        const expr = this.parseExpression();
        args.push({ name, expr });
      } else {
        const expr = this.parseExpression();
        args.push({ name: null, expr });
      }
      this.match('PUNCT', ',');
    }
    return args;
  }

  parseExpression() {
    return this.parseTernary();
  }

  parseTernary() {
    let expr = this.parseLogicalOr();
    if (this.match('PUNCT', '?')) {
      const trueExpr = this.parseExpression();
      this.expect('PUNCT', ':');
      const falseExpr = this.parseExpression();
      return { type: 'Ternary', cond: expr, trueExpr, falseExpr };
    }
    return expr;
  }

  parseLogicalOr() {
    let left = this.parseLogicalAnd();
    while (this.match('OP', '||')) {
      const right = this.parseLogicalAnd();
      left = { type: 'Binary', op: '||', left, right };
    }
    return left;
  }

  parseLogicalAnd() {
    let left = this.parseEquality();
    while (this.match('OP', '&&')) {
      const right = this.parseEquality();
      left = { type: 'Binary', op: '&&', left, right };
    }
    return left;
  }

  parseEquality() {
    let left = this.parseComparison();
    while (true) {
      const t = this.peek();
      if (t.type === 'OP' && (t.value === '==' || t.value === '!=')) {
        const op = this.next().value;
        const right = this.parseComparison();
        left = { type: 'Binary', op, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  parseComparison() {
    let left = this.parseAdditive();
    while (true) {
      const t = this.peek();
      if (
        (t.type === 'OP' && (t.value === '<=' || t.value === '>=')) ||
        (t.type === 'PUNCT' && (t.value === '<' || t.value === '>'))
      ) {
        const op = this.next().value;
        const right = this.parseAdditive();
        left = { type: 'Binary', op, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  parseAdditive() {
    let left = this.parseMultiplicative();
    while (true) {
      const t = this.peek();
      if (t.type === 'PUNCT' && (t.value === '+' || t.value === '-')) {
        const op = this.next().value;
        const right = this.parseMultiplicative();
        left = { type: 'Binary', op, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  parseMultiplicative() {
    let left = this.parsePower();
    while (true) {
      const t = this.peek();
      if (t.type === 'PUNCT' && (t.value === '*' || t.value === '/' || t.value === '%')) {
        const op = this.next().value;
        const right = this.parsePower();
        left = { type: 'Binary', op, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  parsePower() {
    let left = this.parseUnary();
    if (this.match('PUNCT', '^')) {
      const right = this.parseUnary();
      left = { type: 'Binary', op: '^', left, right };
    }
    return left;
  }

  parseUnary() {
    const t = this.peek();
    if (t.type === 'PUNCT' && (t.value === '-' || t.value === '+' || t.value === '!')) {
      const op = this.next().value;
      const arg = this.parseUnary();
      return { type: 'Unary', op, arg };
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    let expr = this.parsePrimary();
    while (true) {
      if (this.match('PUNCT', '[')) {
        const idx = this.parseExpression();
        this.expect('PUNCT', ']');
        expr = { type: 'Index', target: expr, index: idx };
      } else if (this.match('PUNCT', '.')) {
        const prop = this.expect('IDENT').value;
        const mapIdx = prop === 'x' ? 0 : prop === 'y' ? 1 : prop === 'z' ? 2 : 0;
        expr = { type: 'Index', target: expr, index: { type: 'Literal', value: mapIdx } };
      } else {
        break;
      }
    }
    return expr;
  }

  parsePrimary() {
    const t = this.peek();

    if (t.type === 'NUMBER') {
      this.next();
      return { type: 'Literal', value: t.value };
    }

    if (t.type === 'STRING') {
      this.next();
      return { type: 'Literal', value: t.value };
    }

    if (this.match('PUNCT', '(')) {
      const expr = this.parseExpression();
      this.expect('PUNCT', ')');
      return expr;
    }

    // Vector [a, b, c] or Range [start:end] / [start:step:end] or list comprehension [for (...) ...]
    if (this.match('PUNCT', '[')) {
      if (this.match('PUNCT', ']')) {
        return { type: 'Vector', elements: [] };
      }

      // Check simple list comprehension [for (x = ...) expr]
      if (this.peek().type === 'IDENT' && this.peek().value === 'for') {
        this.next();
        this.expect('PUNCT', '(');
        const varName = this.expect('IDENT').value;
        this.expect('PUNCT', '=');
        const rangeExpr = this.parseExpression();
        this.expect('PUNCT', ')');
        const bodyExpr = this.parseExpression();
        this.expect('PUNCT', ']');
        return { type: 'ListComp', varName, rangeExpr, bodyExpr };
      }

      const first = this.parseExpression();
      if (this.match('PUNCT', ':')) {
        const second = this.parseExpression();
        if (this.match('PUNCT', ':')) {
          const third = this.parseExpression();
          this.expect('PUNCT', ']');
          return { type: 'Range', start: first, step: second, end: third };
        }
        this.expect('PUNCT', ']');
        return { type: 'Range', start: first, step: null, end: second };
      }

      const elements = [first];
      while (this.match('PUNCT', ',')) {
        if (this.peek().type === 'PUNCT' && this.peek().value === ']') break;
        elements.push(this.parseExpression());
      }
      this.expect('PUNCT', ']');
      return { type: 'Vector', elements };
    }

    if (t.type === 'IDENT') {
      this.next();
      if (t.value === 'true') return { type: 'Literal', value: true };
      if (t.value === 'false') return { type: 'Literal', value: false };
      if (t.value === 'undef') return { type: 'Literal', value: undefined };

      // Function call
      if (this.peek().type === 'PUNCT' && this.peek().value === '(') {
        const args = this.parseCallArgs();
        return { type: 'FuncCall', name: t.value, args };
      }

      return { type: 'Var', name: t.value };
    }

    // Fallback literal
    this.next();
    return { type: 'Literal', value: 0 };
  }
}

// ============================================================================
// 3. 3D VECTOR STROKE/POLYGON FONT FOR OPENSCAD text()
// ============================================================================

// Clean 5x7 Hershey-style stroke glyph segments for printable ASCII characters
const GLYPH_STROKES = {
  'A': [[0,0, 0.5,1], [0.5,1, 1,0], [0.2,0.4, 0.8,0.4]],
  'B': [[0,0, 0,1], [0,1, 0.7,1], [0.7,1, 0.9,0.75], [0.9,0.75, 0.7,0.5], [0,0.5, 0.7,0.5], [0.7,0.5, 0.95,0.25], [0.95,0.25, 0.7,0], [0.7,0, 0,0]],
  'C': [[0.9,0.85, 0.6,1], [0.6,1, 0.2,1], [0.2,1, 0,0.7], [0,0.7, 0,0.3], [0,0.3, 0.2,0], [0.2,0, 0.6,0], [0.6,0, 0.9,0.15]],
  'D': [[0,0, 0,1], [0,1, 0.6,1], [0.6,1, 0.95,0.7], [0.95,0.7, 0.95,0.3], [0.95,0.3, 0.6,0], [0.6,0, 0,0]],
  'E': [[0,0, 0,1], [0,1, 0.9,1], [0,0.5, 0.75,0.5], [0,0, 0.9,0]],
  'F': [[0,0, 0,1], [0,1, 0.9,1], [0,0.5, 0.75,0.5]],
  'G': [[0.9,0.85, 0.6,1], [0.6,1, 0.15,1], [0.15,1, 0,0.5], [0,0.5, 0.15,0], [0.15,0, 0.85,0], [0.85,0, 0.85,0.45], [0.5,0.45, 0.9,0.45]],
  'H': [[0,0, 0,1], [0.9,0, 0.9,1], [0,0.5, 0.9,0.5]],
  'I': [[0.2,1, 0.8,1], [0.5,0, 0.5,1], [0.2,0, 0.8,0]],
  'J': [[0.8,1, 0.8,0.2], [0.8,0.2, 0.5,0], [0.5,0, 0.1,0.2]],
  'K': [[0,0, 0,1], [0.9,1, 0,0.45], [0.3,0.6, 0.9,0]],
  'L': [[0,1, 0,0], [0,0, 0.9,0]],
  'M': [[0,0, 0,1], [0,1, 0.5,0.4], [0.5,0.4, 1,1], [1,1, 1,0]],
  'N': [[0,0, 0,1], [0,1, 0.9,0], [0.9,0, 0.9,1]],
  'O': [[0.2,0, 0.8,0], [0.8,0, 1,0.3], [1,0.3, 1,0.7], [1,0.7, 0.8,1], [0.8,1, 0.2,1], [0.2,1, 0,0.7], [0,0.7, 0,0.3], [0,0.3, 0.2,0]],
  'P': [[0,0, 0,1], [0,1, 0.75,1], [0.75,1, 0.95,0.75], [0.95,0.75, 0.75,0.5], [0.75,0.5, 0,0.5]],
  'Q': [[0.2,0, 0.8,0], [0.8,0, 1,0.3], [1,0.3, 1,0.7], [1,0.7, 0.8,1], [0.8,1, 0.2,1], [0.2,1, 0,0.7], [0,0.7, 0,0.3], [0,0.3, 0.2,0], [0.6,0.3, 1,0]],
  'R': [[0,0, 0,1], [0,1, 0.75,1], [0.75,1, 0.95,0.75], [0.95,0.75, 0.75,0.5], [0.75,0.5, 0,0.5], [0.45,0.5, 0.95,0]],
  'S': [[0.9,0.85, 0.6,1], [0.6,1, 0.15,1], [0.15,1, 0,0.75], [0,0.75, 0.9,0.35], [0.9,0.35, 0.75,0], [0.75,0, 0.1,0], [0.1,0, 0,0.15]],
  'T': [[0,1, 1,1], [0.5,0, 0.5,1]],
  'U': [[0,1, 0,0.2], [0,0.2, 0.25,0], [0.25,0, 0.75,0], [0.75,0, 0.95,0.2], [0.95,0.2, 0.95,1]],
  'V': [[0,1, 0.5,0], [0.5,0, 1,1]],
  'W': [[0,1, 0.25,0], [0.25,0, 0.5,0.6], [0.5,0.6, 0.75,0], [0.75,0, 1,1]],
  'X': [[0,0, 0.95,1], [0,1, 0.95,0]],
  'Y': [[0,1, 0.5,0.5], [0.95,1, 0.5,0.5], [0.5,0.5, 0.5,0]],
  'Z': [[0,1, 0.95,1], [0.95,1, 0,0], [0,0, 0.95,0]],
  '0': [[0.2,0, 0.8,0], [0.8,0, 0.95,0.3], [0.95,0.3, 0.95,0.7], [0.95,0.7, 0.8,1], [0.8,1, 0.2,1], [0.2,1, 0,0.7], [0,0.7, 0,0.3], [0,0.3, 0.2,0], [0.15,0.15, 0.8,0.85]],
  '1': [[0.2,0.8, 0.5,1], [0.5,1, 0.5,0], [0.2,0, 0.8,0]],
  '2': [[0.05,0.75, 0.3,1], [0.3,1, 0.75,1], [0.75,1, 0.95,0.7], [0.95,0.7, 0,0], [0,0, 0.95,0]],
  '3': [[0.1,0.85, 0.35,1], [0.35,1, 0.8,1], [0.8,1, 0.9,0.7], [0.9,0.7, 0.4,0.5], [0.4,0.5, 0.95,0.3], [0.95,0.3, 0.75,0], [0.75,0, 0.1,0]],
  '4': [[0.7,0, 0.7,1], [0.7,1, 0,0.35], [0,0.35, 0.95,0.35]],
  '5': [[0.9,1, 0.1,1], [0.1,1, 0.05,0.55], [0.05,0.55, 0.75,0.55], [0.75,0.55, 0.95,0.25], [0.95,0.25, 0.7,0], [0.7,0, 0.1,0]],
  '6': [[0.8,1, 0.2,1], [0.2,1, 0,0.5], [0,0.5, 0.15,0], [0.15,0, 0.8,0], [0.8,0, 0.95,0.3], [0.95,0.3, 0.8,0.55], [0.8,0.55, 0.05,0.55]],
  '7': [[0,1, 0.95,1], [0.95,1, 0.35,0]],
  '8': [[0.2,0.5, 0.75,0.5], [0.2,0.5, 0.05,0.75], [0.05,0.75, 0.25,1], [0.25,1, 0.75,1], [0.75,1, 0.9,0.75], [0.9,0.75, 0.75,0.5], [0.2,0.5, 0,0.25], [0,0.25, 0.2,0], [0.2,0, 0.75,0], [0.75,0, 0.95,0.25], [0.95,0.25, 0.75,0.5]],
  '9': [[0.9,0.45, 0.15,0.45], [0.15,0.45, 0,0.7], [0,0.7, 0.2,1], [0.2,1, 0.75,1], [0.75,1, 0.95,0.7], [0.95,0.7, 0.9,0.2], [0.9,0.2, 0.65,0], [0.65,0, 0.15,0]],
  '.': [[0.35,0, 0.55,0], [0.45,0, 0.45,0.18]],
  ',': [[0.45,0.18, 0.3,-0.1]],
  '-': [[0.15,0.5, 0.85,0.5]],
  '_': [[0,0, 0.95,0]],
  '+': [[0.15,0.5, 0.85,0.5], [0.5,0.15, 0.5,0.85]],
  '/': [[0.1,0, 0.85,1]],
  ':': [[0.45,0.2, 0.45,0.32], [0.45,0.68, 0.45,0.8]],
  '"': [[0.3,0.7, 0.3,1], [0.65,0.7, 0.65,1]],
  '\'': [[0.45,0.7, 0.45,1]],
  '(': [[0.65,0, 0.35,0.5], [0.35,0.5, 0.65,1]],
  ')': [[0.35,0, 0.65,0.5], [0.65,0.5, 0.35,1]]
};

/**
 * Generates 2D rectangular stroke polygons for a text string
 */
function buildText2DPolygons(str, size = 2.0, halign = 'left', valign = 'baseline') {
  const text = String(str || '');
  if (!text) return [];

  const charW = size * 0.68;
  const charGap = size * 0.24;
  const stepX = charW + charGap;
  const totalW = Math.max(0, text.length * stepX - charGap);
  const strokeHalf = Math.max(0.07, size * 0.095);

  let offsetX = 0;
  if (halign === 'center') offsetX = -totalW * 0.5;
  else if (halign === 'right') offsetX = -totalW;

  let offsetY = 0;
  if (valign === 'center') offsetY = -size * 0.5;
  else if (valign === 'top') offsetY = -size;

  const polygons = [];

  for (let idx = 0; idx < text.length; idx++) {
    const rawCh = text[idx];
    if (rawCh === ' ') continue;
    const upper = rawCh.toUpperCase();
    const isLower = rawCh >= 'a' && rawCh <= 'z';
    const scaleY = isLower ? 0.76 : 1.0;

    const strokes = GLYPH_STROKES[upper] || [[0.1, 0.1, 0.85, 0.1], [0.85, 0.1, 0.85, 0.85], [0.85, 0.85, 0.1, 0.85], [0.1, 0.85, 0.1, 0.1]];
    const baseX = offsetX + idx * stepX;

    for (const seg of strokes) {
      const x0 = baseX + seg[0] * charW;
      const y0 = offsetY + seg[1] * size * scaleY;
      const x1 = baseX + seg[2] * charW;
      const y1 = offsetY + seg[3] * size * scaleY;

      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      if (len < 1e-4) continue;

      const ux = (dx / len) * strokeHalf;
      const uy = (dy / len) * strokeHalf;
      const nx = -uy;
      const ny = ux;

      polygons.push([
        [x0 - ux - nx, y0 - uy - ny],
        [x1 + ux - nx, y1 + uy - ny],
        [x1 + ux + nx, y1 + uy + ny],
        [x0 - ux + nx, y0 - uy + ny]
      ]);
    }
  }

  return polygons;
}

// ============================================================================
// 4. 4x4 MATRIX & 2D/3D GEOMETRY ENGINE
// ============================================================================

function mat4Identity() {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ];
}

function mat4Multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[r * 4 + c] =
        a[r * 4 + 0] * b[0 * 4 + c] +
        a[r * 4 + 1] * b[1 * 4 + c] +
        a[r * 4 + 2] * b[2 * 4 + c] +
        a[r * 4 + 3] * b[3 * 4 + c];
    }
  }
  return out;
}

function mat4Translate(tx, ty, tz) {
  return [
    1, 0, 0, tx,
    0, 1, 0, ty,
    0, 0, 1, tz,
    0, 0, 0, 1
  ];
}

function mat4Scale(sx, sy, sz) {
  return [
    sx, 0, 0, 0,
    0, sy, 0, 0,
    0, 0, sz, 0,
    0, 0, 0, 1
  ];
}

function mat4RotateX(deg) {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  return [
    1, 0, 0, 0,
    0, c, -s, 0,
    0, s, c, 0,
    0, 0, 0, 1
  ];
}

function mat4RotateY(deg) {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  return [
    c, 0, s, 0,
    0, 1, 0, 0,
    -s, 0, c, 0,
    0, 0, 0, 1
  ];
}

function mat4RotateZ(deg) {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  return [
    c, -s, 0, 0,
    s, c, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ];
}

function mat4Det3x3(m) {
  const a = m[0], b = m[1], c = m[2];
  const d = m[4], e = m[5], f = m[6];
  const g = m[8], h = m[9], i = m[10];
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

function transformPoint(m, x, y, z) {
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3],
    m[4] * x + m[5] * y + m[6] * z + m[7],
    m[8] * x + m[9] * y + m[10] * z + m[11]
  ];
}

function transformTriangles(tris, m) {
  const flipWinding = mat4Det3x3(m) < 0;
  const out = [];
  for (const t of tris) {
    const p0 = transformPoint(m, t[0], t[1], t[2]);
    const p1 = transformPoint(m, t[3], t[4], t[5]);
    const p2 = transformPoint(m, t[6], t[7], t[8]);
    if (flipWinding) {
      out.push([p0[0], p0[1], p0[2], p2[0], p2[1], p2[2], p1[0], p1[1], p1[2]]);
    } else {
      out.push([p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]]);
    }
  }
  return out;
}

function transformPolygons2D(polys, m) {
  const out = [];
  for (const poly of polys) {
    const tPoly = poly.map((pt) => {
      const p3 = transformPoint(m, pt[0], pt[1], 0);
      return [p3[0], p3[1]];
    });
    out.push(tPoly);
  }
  return out;
}

/**
 * 2D Convex Hull (Monotone Chain)
 */
function convexHull2D(points) {
  if (points.length <= 2) return points.slice();
  const pts = points
    .slice()
    .sort((a, b) => (Math.abs(a[0] - b[0]) > 1e-6 ? a[0] - b[0] : a[1] - b[1]));

  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-7) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-7) {
      upper.pop();
    }
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/**
 * Ear-clipping / Fan triangulation of a 2D simple polygon (with optional inner hole polygons)
 */
function signedArea2D(poly) {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const p0 = poly[i];
    const p1 = poly[(i + 1) % poly.length];
    area += p0[0] * p1[1] - p1[0] * p0[1];
  }
  return area * 0.5;
}

function ensureCCW(poly) {
  const copy = poly.slice();
  if (signedArea2D(copy) < 0) copy.reverse();
  return copy;
}

function ensureCW(poly) {
  const copy = poly.slice();
  if (signedArea2D(copy) > 0) copy.reverse();
  return copy;
}

function pointInTriangle2D(px, py, ax, ay, bx, by, cx, cy) {
  const v0x = cx - ax, v0y = cy - ay;
  const v1x = bx - ax, v1y = by - ay;
  const v2x = px - ax, v2y = py - ay;

  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;

  const denom = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denom) < 1e-10) return false;
  const inv = 1 / denom;
  const u = (dot11 * dot02 - dot01 * dot12) * inv;
  const v = (dot00 * dot12 - dot01 * dot02) * inv;
  return u > 1e-6 && v > 1e-6 && u + v < 1 - 1e-6;
}

/**
 * Bridges inner hole polygons into outer CCW polygon using rightmost-vertex visibility bridge
 */
function mergeHolesIntoOuterPolygon(outerPoly, holes = []) {
  let merged = ensureCCW(outerPoly);
  if (!holes || holes.length === 0) return merged;

  // Sort holes from rightmost max X to leftmost
  const sortedHoles = holes
    .map((h) => ensureCW(h))
    .sort((a, b) => {
      const maxA = Math.max(...a.map((p) => p[0]));
      const maxB = Math.max(...b.map((p) => p[0]));
      return maxB - maxA;
    });

  for (const hole of sortedHoles) {
    if (hole.length < 3) continue;
    // Find rightmost vertex in hole
    let hIdx = 0;
    for (let i = 1; i < hole.length; i++) {
      if (hole[i][0] > hole[hIdx][0]) hIdx = i;
    }
    const hx = hole[hIdx][0];
    const hy = hole[hIdx][1];

    // Find closest visible vertex on merged outer polygon
    let bestOuterIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < merged.length; i++) {
      const ox = merged[i][0];
      const oy = merged[i][1];
      const d = Math.hypot(ox - hx, oy - hy);
      if (d < bestDist) {
        bestDist = d;
        bestOuterIdx = i;
      }
    }

    const reorderedHole = [];
    for (let i = 0; i < hole.length; i++) {
      reorderedHole.push(hole[(hIdx + i) % hole.length]);
    }
    reorderedHole.push(hole[hIdx]);

    const newMerged = [
      ...merged.slice(0, bestOuterIdx + 1),
      ...reorderedHole,
      merged[bestOuterIdx],
      ...merged.slice(bestOuterIdx + 1)
    ];
    merged = newMerged;
  }

  return merged;
}

function triangulatePolygon2D(poly) {
  const pts = ensureCCW(poly);
  if (pts.length < 3) return [];

  const indices = pts.map((_, idx) => idx);
  const tris = [];
  let guard = pts.length * 4;

  while (indices.length > 3 && guard-- > 0) {
    let earFound = false;
    const n = indices.length;

    for (let i = 0; i < n; i++) {
      const iPrev = indices[(i + n - 1) % n];
      const iCurr = indices[i];
      const iNext = indices[(i + 1) % n];

      const a = pts[iPrev];
      const b = pts[iCurr];
      const c = pts[iNext];

      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross <= 1e-7) continue;

      let hasPointInside = false;
      for (let j = 0; j < n; j++) {
        const idxJ = indices[j];
        if (idxJ === iPrev || idxJ === iCurr || idxJ === iNext) continue;
        const p = pts[idxJ];
        if (
          Math.hypot(p[0] - a[0], p[1] - a[1]) < 1e-5 ||
          Math.hypot(p[0] - b[0], p[1] - b[1]) < 1e-5 ||
          Math.hypot(p[0] - c[0], p[1] - c[1]) < 1e-5
        ) {
          continue;
        }
        if (pointInTriangle2D(p[0], p[1], a[0], a[1], b[0], b[1], c[0], c[1])) {
          hasPointInside = true;
          break;
        }
      }

      if (!hasPointInside) {
        tris.push([a, b, c]);
        indices.splice(i, 1);
        earFound = true;
        break;
      }
    }

    if (!earFound) {
      const iPrev = indices[0];
      const iCurr = indices[1];
      const iNext = indices[2];
      tris.push([pts[iPrev], pts[iCurr], pts[iNext]]);
      indices.splice(1, 1);
    }
  }

  if (indices.length === 3) {
    tris.push([pts[indices[0]], pts[indices[1]], pts[indices[2]]]);
  }

  return tris;
}

/**
 * Extrudes a 2D polygon (with optional inner holes) along Z from z0 to z1
 */
function extrudePolygonWithHoles(outerPoly, holes, z0, z1) {
  if (!outerPoly || outerPoly.length < 3) return [];
  const merged = mergeHolesIntoOuterPolygon(outerPoly, holes);
  const tris2d = triangulatePolygon2D(merged);
  const tris3d = [];

  for (const [a, b, c] of tris2d) {
    // Top cap (z1)
    tris3d.push([a[0], a[1], z1, b[0], b[1], z1, c[0], c[1], z1]);
    // Bottom cap (z0)
    tris3d.push([a[0], a[1], z0, c[0], c[1], z0, b[0], b[1], z0]);
  }

  // Outer perimeter side walls
  const outerCCW = ensureCCW(outerPoly);
  for (let i = 0; i < outerCCW.length; i++) {
    const p0 = outerCCW[i];
    const p1 = outerCCW[(i + 1) % outerCCW.length];
    tris3d.push([p0[0], p0[1], z0, p1[0], p1[1], z0, p1[0], p1[1], z1]);
    tris3d.push([p0[0], p0[1], z0, p1[0], p1[1], z1, p0[0], p0[1], z1]);
  }

  // Inner hole perimeter side walls
  for (const h of holes || []) {
    const holeCW = ensureCW(h);
    for (let i = 0; i < holeCW.length; i++) {
      const p0 = holeCW[i];
      const p1 = holeCW[(i + 1) % holeCW.length];
      tris3d.push([p0[0], p0[1], z0, p1[0], p1[1], z0, p1[0], p1[1], z1]);
      tris3d.push([p0[0], p0[1], z0, p1[0], p1[1], z1, p0[0], p0[1], z1]);
    }
  }

  return tris3d;
}

// ============================================================================
// 5. 3D PRIMITIVE GENERATORS & CSG DIFFERENCE SOLVER
// ============================================================================

function makeBoxTriangles(x0, y0, z0, x1, y1, z1) {
  return [
    [x0, y0, z0, x1, y1, z0, x1, y0, z0],
    [x0, y0, z0, x0, y1, z0, x1, y1, z0],
    [x0, y0, z1, x1, y0, z1, x1, y1, z1],
    [x0, y0, z1, x1, y1, z1, x0, y1, z1],
    [x0, y0, z0, x1, y0, z0, x1, y0, z1],
    [x0, y0, z0, x1, y0, z1, x0, y0, z1],
    [x0, y1, z0, x1, y1, z1, x1, y1, z0],
    [x0, y1, z0, x0, y1, z1, x1, y1, z1],
    [x0, y0, z0, x0, y0, z1, x0, y1, z1],
    [x0, y0, z0, x0, y1, z1, x0, y1, z0],
    [x1, y0, z0, x1, y1, z0, x1, y1, z1],
    [x1, y0, z0, x1, y1, z1, x1, y0, z1]
  ];
}

function makeCylinderTriangles(r1, r2, h, center, fn = 28) {
  const segs = Math.max(8, Math.min(96, Math.round(fn)));
  const z0 = center ? -h * 0.5 : 0;
  const z1 = center ? h * 0.5 : h;
  const tris = [];

  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0);
    const c1 = Math.cos(a1), s1 = Math.sin(a1);

    const x0b = r1 * c0, y0b = r1 * s0;
    const x1b = r1 * c1, y1b = r1 * s1;
    const x0t = r2 * c0, y0t = r2 * s0;
    const x1t = r2 * c1, y1t = r2 * s1;

    if (r2 > 1e-5) {
      tris.push([0, 0, z1, x0t, y0t, z1, x1t, y1t, z1]);
    }
    if (r1 > 1e-5) {
      tris.push([0, 0, z0, x1b, y1b, z0, x0b, y0b, z0]);
    }
    tris.push([x0b, y0b, z0, x1b, y1b, z0, x1t, y1t, z1]);
    tris.push([x0b, y0b, z0, x1t, y1t, z1, x0t, y0t, z1]);
  }
  return tris;
}

function makeSphereTriangles(r, fn = 24) {
  const rings = Math.max(8, Math.round(fn * 0.5));
  const sectors = Math.max(12, Math.round(fn));
  const tris = [];

  for (let i = 0; i < rings; i++) {
    const phi0 = Math.PI * (-0.5 + i / rings);
    const phi1 = Math.PI * (-0.5 + (i + 1) / rings);
    const z0 = r * Math.sin(phi0), zr0 = r * Math.cos(phi0);
    const z1 = r * Math.sin(phi1), zr1 = r * Math.cos(phi1);

    for (let j = 0; j < sectors; j++) {
      const th0 = (j / sectors) * Math.PI * 2;
      const th1 = ((j + 1) / sectors) * Math.PI * 2;
      const x00 = zr0 * Math.cos(th0), y00 = zr0 * Math.sin(th0);
      const x10 = zr0 * Math.cos(th1), y10 = zr0 * Math.sin(th1);
      const x01 = zr1 * Math.cos(th0), y01 = zr1 * Math.sin(th0);
      const x11 = zr1 * Math.cos(th1), y11 = zr1 * Math.sin(th1);

      tris.push([x00, y00, z0, x10, y10, z0, x11, y11, z1]);
      tris.push([x00, y00, z0, x11, y11, z1, x01, y01, z1]);
    }
  }
  return tris;
}

function computeBoundingBox(tris) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const t of tris) {
    for (let i = 0; i < 9; i += 3) {
      const x = t[i], y = t[i + 1], z = t[i + 2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

/**
 * 3D Convex Hull for OpenSCAD hull() on 3D primitives (e.g. rounded board via 4 corner cylinders!)
 * Many OpenSCAD scripts create rounded PCBs using:
 *   hull() { translate([r,r,0]) cylinder(...); translate([L-r,r,0]) cylinder(...); ... }
 */
function convexHull3D(allTris) {
  if (allTris.length === 0) return [];
  const bbox = computeBoundingBox(allTris);
  const z0 = bbox.minZ;
  const z1 = bbox.maxZ;

  // Collect all XY projection points and build 2D convex hull extruded from z0 to z1
  const xyPts = [];
  for (const t of allTris) {
    xyPts.push([t[0], t[1]], [t[3], t[4]], [t[6], t[7]]);
  }
  const hull2d = convexHull2D(xyPts);
  if (hull2d.length >= 3 && Math.abs(z1 - z0) > 1e-4) {
    return extrudePolygonWithHoles(hull2d, [], z0, z1);
  }
  return allTris;
}

/**
 * Handles OpenSCAD difference() { base; cutter1; cutter2; ... }
 * Supports:
 *   1. Extruded 2D / Hull plates with cylindrical or rectangular through-holes (carves actual holes into the 2D profile!)
 *   2. Box cavities (USB-C recess, JST cavity, MicroSD slot) with inverted inner cavity walls
 */
function evaluateDifference3D(baseItems, cutterItems) {
  if (baseItems.length === 0) return [];
  if (cutterItems.length === 0) return baseItems;

  const cutters = cutterItems.map((c) => ({
    ...c,
    bbox: computeBoundingBox(c.triangles)
  }));

  const resultItems = [];

  for (const base of baseItems) {
    const baseBox = computeBoundingBox(base.triangles);
    const holePolys2D = [];
    const remainingCutters = [];

    for (const cut of cutters) {
      const cb = cut.bbox;
      // Check if cutter is a Z through-hole piercing this base plate
      const piercesZ = cb.minZ <= baseBox.minZ + 0.05 && cb.maxZ >= baseBox.maxZ - 0.05;
      const insideXY =
        cb.maxX > baseBox.minX &&
        cb.minX < baseBox.maxX &&
        cb.maxY > baseBox.minY &&
        cb.minY < baseBox.maxY;

      if (piercesZ && insideXY && base.profile2D) {
        // Project cutter XY footprint as a 2D hole polygon
        const pts = [];
        for (const t of cut.triangles) {
          pts.push([t[0], t[1]], [t[3], t[4]], [t[6], t[7]]);
        }
        const h2d = convexHull2D(pts);
        if (h2d.length >= 3) {
          holePolys2D.push(h2d);
          continue;
        }
      }

      if (insideXY && cb.maxZ > baseBox.minZ && cb.minZ < baseBox.maxZ) {
        remainingCutters.push(cut);
      }
    }

    if (base.profile2D && holePolys2D.length > 0) {
      const existingHoles = base.holes2D || [];
      const allHoles = existingHoles.concat(holePolys2D);
      const reExtruded = extrudePolygonWithHoles(base.profile2D, allHoles, baseBox.minZ, baseBox.maxZ);
      resultItems.push({
        name: base.name,
        color: base.color,
        triangles: reExtruded,
        profile2D: base.profile2D,
        holes2D: allHoles
      });
    } else {
      resultItems.push(base);
    }

    // For non-through cavities (like USB-C / JST recess), add dark recessed inner cavity walls
    for (const cav of remainingCutters) {
      const cb = cav.bbox;
      const clX0 = Math.max(baseBox.minX - 0.02, cb.minX);
      const clY0 = Math.max(baseBox.minY - 0.02, cb.minY);
      const clZ0 = Math.max(baseBox.minZ - 0.02, cb.minZ);
      const clX1 = Math.min(baseBox.maxX + 0.02, cb.maxX);
      const clY1 = Math.min(baseBox.maxY + 0.02, cb.maxY);
      const clZ1 = Math.min(baseBox.maxZ + 0.02, cb.maxZ);
      if (clX1 > clX0 && clY1 > clY0 && clZ1 > clZ0) {
        resultItems.push({
          name: `${base.name}_Cavity`,
          color: '#0f172a',
          triangles: makeBoxTriangles(clX0, clY0, clZ0, clX1, clY1, clZ1)
        });
      }
    }
  }

  return resultItems;
}

// ============================================================================
// 6. OPENSCAD AST INTERPRETER / EVALUATOR
// ============================================================================

class ScadInterpreter {
  constructor(ast) {
    this.ast = ast;
    this.globalModules = new Map();
    this.globalFunctions = new Map();
    this.meshItems = [];
  }

  run() {
    const rootEnv = new Map();
    rootEnv.set('$fn', 32);
    rootEnv.set('PI', Math.PI);

    // Pre-register top-level modules and functions (OpenSCAD hoists modules & functions!)
    if (this.ast && this.ast.statements) {
      for (const stmt of this.ast.statements) {
        if (stmt.type === 'ModuleDef') {
          this.globalModules.set(stmt.name, stmt);
        } else if (stmt.type === 'FunctionDef') {
          this.globalFunctions.set(stmt.name, stmt);
        }
      }
    }

    const result = this.evalNode(this.ast, rootEnv, mat4Identity(), null, []);
    this.meshItems = result.items3D;
    return {
      items3D: this.meshItems,
      rootEnv
    };
  }

  cloneEnv(env) {
    return new Map(env);
  }

  /**
   * Evaluates an AST statement node and returns { items3D: [...], polys2D: [...] }
   */
  evalNode(node, env, matrix, activeColor, childrenStack) {
    if (!node) return { items3D: [], polys2D: [] };

    switch (node.type) {
      case 'Block': {
        // Hoist any local module/function definitions inside block
        for (const s of node.statements) {
          if (s.type === 'ModuleDef') this.globalModules.set(s.name, s);
          else if (s.type === 'FunctionDef') this.globalFunctions.set(s.name, s);
        }
        // In OpenSCAD, variable assignments in a block are hoisted/visible within that block
        for (const s of node.statements) {
          if (s.type === 'Assign') {
            env.set(s.name, this.evalExpr(s.expr, env));
          }
        }
        const items3D = [];
        const polys2D = [];
        for (const s of node.statements) {
          if (s.type === 'Assign' || s.type === 'ModuleDef' || s.type === 'FunctionDef') continue;
          const res = this.evalNode(s, env, matrix, activeColor, childrenStack);
          items3D.push(...res.items3D);
          polys2D.push(...res.polys2D);
        }
        return { items3D, polys2D };
      }

      case 'Assign': {
        env.set(node.name, this.evalExpr(node.expr, env));
        return { items3D: [], polys2D: [] };
      }

      case 'ModuleDef':
      case 'FunctionDef':
        return { items3D: [], polys2D: [] };

      case 'IfStmt': {
        const condVal = this.evalExpr(node.cond, env);
        if (this.isTruthy(condVal)) {
          return this.evalNode(node.thenBranch, this.cloneEnv(env), matrix, activeColor, childrenStack);
        } else if (node.elseBranch) {
          return this.evalNode(node.elseBranch, this.cloneEnv(env), matrix, activeColor, childrenStack);
        }
        return { items3D: [], polys2D: [] };
      }

      case 'ForStmt': {
        const items3D = [];
        const polys2D = [];
        const runLoop = (bindingIdx, currentEnv) => {
          if (bindingIdx >= node.bindings.length) {
            const res = this.evalNode(node.body, this.cloneEnv(currentEnv), matrix, activeColor, childrenStack);
            items3D.push(...res.items3D);
            polys2D.push(...res.polys2D);
            return;
          }
          const b = node.bindings[bindingIdx];
          const iterable = this.expandIterable(this.evalExpr(b.rangeExpr, currentEnv));
          for (const val of iterable) {
            const nextEnv = this.cloneEnv(currentEnv);
            nextEnv.set(b.varName, val);
            runLoop(bindingIdx + 1, nextEnv);
          }
        };
        runLoop(0, env);
        return { items3D, polys2D };
      }

      case 'LetStmt': {
        const letEnv = this.cloneEnv(env);
        for (const arg of node.args) {
          if (arg.name) {
            letEnv.set(arg.name, this.evalExpr(arg.expr, letEnv));
          }
        }
        return this.evalNode(node.body, letEnv, matrix, activeColor, childrenStack);
      }

      case 'ModuleCall': {
        return this.evalModuleCall(node, env, matrix, activeColor, childrenStack);
      }

      default:
        return { items3D: [], polys2D: [] };
    }
  }

  evalModuleCall(node, env, matrix, activeColor, childrenStack) {
    const name = node.name;
    const evaledArgs = node.args.map((a) => ({
      name: a.name,
      value: this.evalExpr(a.expr, env)
    }));

    const getArg = (idx, key, defVal = undefined) => {
      const byName = evaledArgs.find((a) => a.name === key);
      if (byName && byName.value !== undefined) return byName.value;
      if (idx !== null && idx < evaledArgs.length && evaledArgs[idx].name === null) {
        return evaledArgs[idx].value;
      }
      return defVal;
    };

    const fn = Number(getArg(null, '$fn', env.get('$fn') || 32)) || 32;

    // 1. TRANSFORMS
    if (name === 'translate') {
      const v = getArg(0, 'v', [0, 0, 0]);
      const tx = Number(v?.[0] || 0);
      const ty = Number(v?.[1] || 0);
      const tz = Number(v?.[2] || 0);
      const nextMat = mat4Multiply(matrix, mat4Translate(tx, ty, tz));
      return this.evalNode(node.child, env, nextMat, activeColor, childrenStack);
    }

    if (name === 'rotate') {
      const a = getArg(0, 'a', 0);
      const v = getArg(1, 'v', null);
      let rotMat = mat4Identity();
      if (Array.isArray(a)) {
        const rx = Number(a[0] || 0);
        const ry = Number(a[1] || 0);
        const rz = Number(a[2] || 0);
        rotMat = mat4Multiply(mat4RotateZ(rz), mat4Multiply(mat4RotateY(ry), mat4RotateX(rx)));
      } else if (Array.isArray(v)) {
        const deg = Number(a || 0);
        if (Math.abs(v[0]) > 0.5) rotMat = mat4RotateX(deg * Math.sign(v[0]));
        else if (Math.abs(v[1]) > 0.5) rotMat = mat4RotateY(deg * Math.sign(v[1]));
        else rotMat = mat4RotateZ(deg * Math.sign(v[2] || 1));
      } else {
        rotMat = mat4RotateZ(Number(a || 0));
      }
      const nextMat = mat4Multiply(matrix, rotMat);
      return this.evalNode(node.child, env, nextMat, activeColor, childrenStack);
    }

    if (name === 'scale') {
      const v = getArg(0, 'v', [1, 1, 1]);
      const sx = Array.isArray(v) ? Number(v[0] ?? 1) : Number(v || 1);
      const sy = Array.isArray(v) ? Number(v[1] ?? 1) : Number(v || 1);
      const sz = Array.isArray(v) ? Number(v[2] ?? 1) : Number(v || 1);
      const nextMat = mat4Multiply(matrix, mat4Scale(sx, sy, sz));
      return this.evalNode(node.child, env, nextMat, activeColor, childrenStack);
    }

    if (name === 'mirror') {
      const v = getArg(0, 'v', [1, 0, 0]);
      const mx = Math.abs(v?.[0] || 0) > 0.5 ? -1 : 1;
      const my = Math.abs(v?.[1] || 0) > 0.5 ? -1 : 1;
      const mz = Math.abs(v?.[2] || 0) > 0.5 ? -1 : 1;
      const nextMat = mat4Multiply(matrix, mat4Scale(mx, my, mz));
      return this.evalNode(node.child, env, nextMat, activeColor, childrenStack);
    }

    if (name === 'color') {
      const cArg = getArg(0, 'c', '#38bdf8');
      const hex = this.parseColorToHex(cArg);
      const res = this.evalNode(node.child, env, matrix, hex, childrenStack);
      // Apply this color to any child items that did not already get an inner override color
      for (const item of res.items3D) {
        if (!item._lockedColor) {
          item.color = hex;
          item._lockedColor = true;
        }
      }
      return res;
    }

    // 2. CSG OPERATIONS (union, difference, intersection, hull)
    if (name === 'union') {
      return this.evalNode(node.child, env, matrix, activeColor, childrenStack);
    }

    if (name === 'difference') {
      const childStmts = this.getChildStatements(node.child);
      if (childStmts.length === 0) return { items3D: [], polys2D: [] };

      const firstRes = this.evalNode(childStmts[0], this.cloneEnv(env), matrix, activeColor, childrenStack);
      const cutterItems3D = [];
      const cutterPolys2D = [];

      for (let i = 1; i < childStmts.length; i++) {
        const subRes = this.evalNode(childStmts[i], this.cloneEnv(env), matrix, activeColor, childrenStack);
        cutterItems3D.push(...subRes.items3D);
        cutterPolys2D.push(...subRes.polys2D);
      }

      // 2D difference (e.g. inside linear_extrude)
      const outPolys2D = firstRes.polys2D.map((p) => ({
        outer: p.outer || p,
        holes: [...(p.holes || []), ...cutterPolys2D.map((cp) => cp.outer || cp)]
      }));

      // 3D difference
      const outItems3D = evaluateDifference3D(firstRes.items3D, cutterItems3D);
      return { items3D: outItems3D, polys2D: outPolys2D };
    }

    if (name === 'intersection') {
      const childStmts = this.getChildStatements(node.child);
      if (childStmts.length === 0) return { items3D: [], polys2D: [] };
      return this.evalNode(childStmts[0], this.cloneEnv(env), matrix, activeColor, childrenStack);
    }

    if (name === 'hull') {
      const sub = this.evalNode(node.child, env, mat4Identity(), activeColor, childrenStack);
      const polys2D = [];
      if (sub.polys2D.length > 0) {
        const allPts = [];
        for (const p of sub.polys2D) {
          const ring = p.outer || p;
          allPts.push(...ring);
        }
        const h2d = convexHull2D(allPts);
        if (h2d.length >= 3) {
          const transformed = transformPolygons2D([h2d], matrix)[0];
          polys2D.push({ outer: transformed, holes: [] });
        }
      }

      const items3D = [];
      if (sub.items3D.length > 0) {
        const allTris = [];
        for (const it of sub.items3D) allTris.push(...it.triangles);
        const bbox = computeBoundingBox(allTris);
        const xyPts = [];
        for (const t of allTris) {
          xyPts.push([t[0], t[1]], [t[3], t[4]], [t[6], t[7]]);
        }
        const hull2d = convexHull2D(xyPts);
        const hullTris = extrudePolygonWithHoles(hull2d, [], bbox.minZ, bbox.maxZ);
        items3D.push({
          name: 'Hull_3D',
          color: activeColor || sub.items3D[0].color || '#38bdf8',
          triangles: transformTriangles(hullTris, matrix),
          profile2D: transformPolygons2D([hull2d], matrix)[0],
          holes2D: []
        });
      }
      return { items3D, polys2D };
    }

    if (name === 'minkowski') {
      const sub = this.evalNode(node.child, env, mat4Identity(), activeColor, childrenStack);
      if (sub.items3D.length >= 2) {
        const b0 = computeBoundingBox(sub.items3D[0].triangles);
        const b1 = computeBoundingBox(sub.items3D[1].triangles);
        const rx = (b1.maxX - b1.minX) * 0.5;
        const ry = (b1.maxY - b1.minY) * 0.5;
        const r = Math.max(0.1, Math.min(rx, ry));
        const L = (b0.maxX - b0.minX) + 2 * rx;
        const W = (b0.maxY - b0.minY) + 2 * ry;
        const z0 = b0.minZ + b1.minZ;
        const z1 = b0.maxZ + b1.maxZ;
        const x0 = b0.minX - rx;
        const y0 = b0.minY - ry;
        const corners = [
          { cx: x0 + L - r, cy: y0 + W - r, start: 0 },
          { cx: x0 + r, cy: y0 + W - r, start: Math.PI * 0.5 },
          { cx: x0 + r, cy: y0 + r, start: Math.PI },
          { cx: x0 + L - r, cy: y0 + r, start: Math.PI * 1.5 }
        ];
        const ring = [];
        for (const c of corners) {
          for (let i = 0; i <= 6; i++) {
            const ang = c.start + (i / 6) * (Math.PI * 0.5);
            ring.push([c.cx + r * Math.cos(ang), c.cy + r * Math.sin(ang)]);
          }
        }
        const mTris = extrudePolygonWithHoles(ring, [], z0, z1);
        return {
          items3D: [
            {
              name: 'Minkowski_3D',
              color: activeColor || sub.items3D[0].color || '#38bdf8',
              triangles: transformTriangles(mTris, matrix),
              profile2D: transformPolygons2D([ring], matrix)[0],
              holes2D: []
            }
          ],
          polys2D: []
        };
      }
      return this.evalNode(node.child, env, matrix, activeColor, childrenStack);
    }

    if (name === 'offset') {
      return this.evalNode(node.child, env, matrix, activeColor, childrenStack);
    }

    if (name === 'render' || name === 'echo' || name === 'assert') {
      if (node.child) {
        return this.evalNode(node.child, env, matrix, activeColor, childrenStack);
      }
      return { items3D: [], polys2D: [] };
    }

    // 3. 2D TO 3D EXTRUSION (linear_extrude, rotate_extrude)
    if (name === 'linear_extrude') {
      const h = Number(getArg(0, 'height', getArg(null, 'h', 1.0))) || 1.0;
      const center = this.isTruthy(getArg(null, 'center', false));
      const sub = this.evalNode(node.child, env, mat4Identity(), activeColor, childrenStack);

      const z0 = center ? -h * 0.5 : 0;
      const z1 = center ? h * 0.5 : h;
      const items3D = [];

      for (const polyObj of sub.polys2D) {
        const outer = polyObj.outer || polyObj;
        const holes = polyObj.holes || [];
        const localTris = extrudePolygonWithHoles(outer, holes, z0, z1);
        const worldTris = transformTriangles(localTris, matrix);
        const worldOuter = transformPolygons2D([outer], matrix)[0];
        const worldHoles = transformPolygons2D(holes, matrix);

        items3D.push({
          name: 'Extruded_Part',
          color: activeColor || '#38bdf8',
          triangles: worldTris,
          profile2D: worldOuter,
          holes2D: worldHoles
        });
      }
      return { items3D, polys2D: [] };
    }

    // 4. 3D PRIMITIVES (cube, cylinder, sphere, polyhedron)
    if (name === 'cube') {
      const sizeArg = getArg(0, 'size', [1, 1, 1]);
      const center = this.isTruthy(getArg(1, 'center', false));
      let dx = 1, dy = 1, dz = 1;
      if (Array.isArray(sizeArg)) {
        dx = Number(sizeArg[0] ?? 1);
        dy = Number(sizeArg[1] ?? 1);
        dz = Number(sizeArg[2] ?? 1);
      } else {
        dx = dy = dz = Number(sizeArg || 1);
      }
      if (dx <= 0 || dy <= 0 || dz <= 0) return { items3D: [], polys2D: [] };

      const x0 = center ? -dx * 0.5 : 0;
      const y0 = center ? -dy * 0.5 : 0;
      const z0 = center ? -dz * 0.5 : 0;
      const localTris = makeBoxTriangles(x0, y0, z0, x0 + dx, y0 + dy, z0 + dz);
      const worldTris = transformTriangles(localTris, matrix);

      const rect2D = [
        [x0, y0],
        [x0 + dx, y0],
        [x0 + dx, y0 + dy],
        [x0, y0 + dy]
      ];

      return {
        items3D: [
          {
            name: 'Cube_Part',
            color: activeColor || '#38bdf8',
            triangles: worldTris,
            profile2D: transformPolygons2D([rect2D], matrix)[0],
            holes2D: []
          }
        ],
        polys2D: []
      };
    }

    if (name === 'cylinder') {
      const h = Number(getArg(0, 'h', 1));
      const rArg = getArg(1, 'r', undefined);
      const dArg = getArg(null, 'd', undefined);
      const r1Arg = getArg(null, 'r1', undefined);
      const r2Arg = getArg(null, 'r2', undefined);
      const d1Arg = getArg(null, 'd1', undefined);
      const d2Arg = getArg(null, 'd2', undefined);
      const center = this.isTruthy(getArg(null, 'center', false));

      let rBase = 1;
      if (dArg !== undefined) rBase = Number(dArg) * 0.5;
      else if (rArg !== undefined) rBase = Number(rArg);

      let r1 = rBase;
      let r2 = rBase;
      if (d1Arg !== undefined) r1 = Number(d1Arg) * 0.5;
      else if (r1Arg !== undefined) r1 = Number(r1Arg);
      if (d2Arg !== undefined) r2 = Number(d2Arg) * 0.5;
      else if (r2Arg !== undefined) r2 = Number(r2Arg);

      if (h <= 0 || (r1 <= 0 && r2 <= 0)) return { items3D: [], polys2D: [] };

      const localTris = makeCylinderTriangles(r1, r2, h, center, fn);
      const worldTris = transformTriangles(localTris, matrix);

      // Build 2D circular profile so difference() on cylinders (annular rings/pads) carves real holes
      const segs = Math.max(8, Math.min(72, Math.round(fn)));
      const ring2D = [];
      for (let i = 0; i < segs; i++) {
        const ang = (i / segs) * Math.PI * 2;
        ring2D.push([r1 * Math.cos(ang), r1 * Math.sin(ang)]);
      }

      return {
        items3D: [
          {
            name: 'Cylinder_Part',
            color: activeColor || '#38bdf8',
            triangles: worldTris,
            profile2D: Math.abs(r1 - r2) < 1e-4 ? transformPolygons2D([ring2D], matrix)[0] : null,
            holes2D: []
          }
        ],
        polys2D: []
      };
    }

    if (name === 'sphere') {
      const rArg = getArg(0, 'r', undefined);
      const dArg = getArg(null, 'd', undefined);
      const r = dArg !== undefined ? Number(dArg) * 0.5 : Number(rArg ?? 1);
      if (r <= 0) return { items3D: [], polys2D: [] };
      const localTris = makeSphereTriangles(r, fn);
      return {
        items3D: [
          {
            name: 'Sphere_Part',
            color: activeColor || '#38bdf8',
            triangles: transformTriangles(localTris, matrix)
          }
        ],
        polys2D: []
      };
    }

    // 5. 2D PRIMITIVES (circle, square, polygon, text)
    if (name === 'circle') {
      const rArg = getArg(0, 'r', undefined);
      const dArg = getArg(null, 'd', undefined);
      const r = dArg !== undefined ? Number(dArg) * 0.5 : Number(rArg ?? 1);
      const segs = Math.max(8, Math.min(72, Math.round(fn)));
      const ring = [];
      for (let i = 0; i < segs; i++) {
        const ang = (i / segs) * Math.PI * 2;
        ring.push([r * Math.cos(ang), r * Math.sin(ang)]);
      }
      const transformed = transformPolygons2D([ring], matrix)[0];
      return { items3D: [], polys2D: [{ outer: transformed, holes: [] }] };
    }

    if (name === 'square') {
      const sizeArg = getArg(0, 'size', [1, 1]);
      const center = this.isTruthy(getArg(1, 'center', false));
      const w = Array.isArray(sizeArg) ? Number(sizeArg[0] ?? 1) : Number(sizeArg || 1);
      const h = Array.isArray(sizeArg) ? Number(sizeArg[1] ?? 1) : Number(sizeArg || 1);
      const x0 = center ? -w * 0.5 : 0;
      const y0 = center ? -h * 0.5 : 0;
      const ring = [
        [x0, y0],
        [x0 + w, y0],
        [x0 + w, y0 + h],
        [x0, y0 + h]
      ];
      const transformed = transformPolygons2D([ring], matrix)[0];
      return { items3D: [], polys2D: [{ outer: transformed, holes: [] }] };
    }

    if (name === 'polygon') {
      const pts = getArg(0, 'points', []);
      if (Array.isArray(pts) && pts.length >= 3) {
        const ring = pts.map((p) => [Number(p[0] || 0), Number(p[1] || 0)]);
        const transformed = transformPolygons2D([ring], matrix)[0];
        return { items3D: [], polys2D: [{ outer: transformed, holes: [] }] };
      }
      return { items3D: [], polys2D: [] };
    }

    if (name === 'text') {
      const txt = String(getArg(0, 'text', '') ?? '');
      const size = Number(getArg(1, 'size', 2.0)) || 2.0;
      const halign = String(getArg(null, 'halign', 'left'));
      const valign = String(getArg(null, 'valign', 'baseline'));
      const glyphPolys = buildText2DPolygons(txt, size, halign, valign);
      const transformedPolys = transformPolygons2D(glyphPolys, matrix).map((ring) => ({
        outer: ring,
        holes: []
      }));
      return { items3D: [], polys2D: transformedPolys };
    }

    // 6. children() CALL INSIDE USER MODULE
    if (name === 'children') {
      if (childrenStack.length === 0) return { items3D: [], polys2D: [] };
      const topCtx = childrenStack[childrenStack.length - 1];
      const nextStack = childrenStack.slice(0, -1);
      return this.evalNode(topCtx.childNode, topCtx.callerEnv, matrix, activeColor, nextStack);
    }

    // 7. USER-DEFINED MODULE CALL
    if (this.globalModules.has(name)) {
      const modDef = this.globalModules.get(name);
      const modEnv = this.cloneEnv(env);

      modDef.params.forEach((p, idx) => {
        const val = getArg(
          idx,
          p.name,
          p.defaultExpr ? this.evalExpr(p.defaultExpr, modEnv) : undefined
        );
        modEnv.set(p.name, val);
      });

      const nextChildrenStack = node.child
        ? [...childrenStack, { childNode: node.child, callerEnv: env }]
        : childrenStack;

      const res = this.evalNode(modDef.body, modEnv, matrix, activeColor, nextChildrenStack);
      for (const it of res.items3D) {
        if (it.name === 'Cube_Part' || it.name === 'Cylinder_Part' || it.name === 'Extruded_Part') {
          it.name = name;
        }
      }
      return res;
    }

    // Unknown module with child: still evaluate child
    if (node.child) {
      return this.evalNode(node.child, env, matrix, activeColor, childrenStack);
    }

    return { items3D: [], polys2D: [] };
  }

  getChildStatements(childNode) {
    if (!childNode) return [];
    if (childNode.type === 'Block') return childNode.statements;
    return [childNode];
  }

  evalExpr(expr, env) {
    if (!expr) return 0;

    switch (expr.type) {
      case 'Literal':
        return expr.value;

      case 'Var':
        return env.has(expr.name) ? env.get(expr.name) : 0;

      case 'Vector':
        return expr.elements.map((e) => this.evalExpr(e, env));

      case 'Range':
        return {
          _isRange: true,
          start: Number(this.evalExpr(expr.start, env) || 0),
          step: expr.step ? Number(this.evalExpr(expr.step, env) || 1) : null,
          end: Number(this.evalExpr(expr.end, env) || 0)
        };

      case 'ListComp': {
        const iter = this.expandIterable(this.evalExpr(expr.rangeExpr, env));
        const out = [];
        for (const v of iter) {
          const subEnv = this.cloneEnv(env);
          subEnv.set(expr.varName, v);
          out.push(this.evalExpr(expr.bodyExpr, subEnv));
        }
        return out;
      }

      case 'Index': {
        const target = this.evalExpr(expr.target, env);
        const idx = Number(this.evalExpr(expr.index, env) || 0);
        if (Array.isArray(target) || typeof target === 'string') {
          return target[idx];
        }
        return 0;
      }

      case 'Unary': {
        const v = this.evalExpr(expr.arg, env);
        if (expr.op === '-') return Array.isArray(v) ? v.map((x) => -x) : -Number(v || 0);
        if (expr.op === '+') return Number(v || 0);
        if (expr.op === '!') return !this.isTruthy(v);
        return v;
      }

      case 'Binary': {
        if (expr.op === '&&') {
          return this.isTruthy(this.evalExpr(expr.left, env)) && this.isTruthy(this.evalExpr(expr.right, env));
        }
        if (expr.op === '||') {
          return this.isTruthy(this.evalExpr(expr.left, env)) || this.isTruthy(this.evalExpr(expr.right, env));
        }
        const l = this.evalExpr(expr.left, env);
        const r = this.evalExpr(expr.right, env);

        if (Array.isArray(l) && Array.isArray(r)) {
          if (expr.op === '+') return l.map((v, i) => v + (r[i] || 0));
          if (expr.op === '-') return l.map((v, i) => v - (r[i] || 0));
        }
        if (Array.isArray(l) && typeof r === 'number') {
          if (expr.op === '*') return l.map((v) => v * r);
          if (expr.op === '/') return l.map((v) => v / (r || 1));
        }
        if (typeof l === 'number' && Array.isArray(r) && expr.op === '*') {
          return r.map((v) => l * v);
        }

        switch (expr.op) {
          case '+': return Number(l) + Number(r);
          case '-': return Number(l) - Number(r);
          case '*': return Number(l) * Number(r);
          case '/': return Number(r) !== 0 ? Number(l) / Number(r) : 0;
          case '%': return Number(r) !== 0 ? Number(l) % Number(r) : 0;
          case '^': return Math.pow(Number(l), Number(r));
          case '==': return l === r;
          case '!=': return l !== r;
          case '<': return Number(l) < Number(r);
          case '>': return Number(l) > Number(r);
          case '<=': return Number(l) <= Number(r);
          case '>=': return Number(l) >= Number(r);
          default: return 0;
        }
      }

      case 'Ternary': {
        return this.isTruthy(this.evalExpr(expr.cond, env))
          ? this.evalExpr(expr.trueExpr, env)
          : this.evalExpr(expr.falseExpr, env);
      }

      case 'FuncCall': {
        const args = expr.args.map((a) => this.evalExpr(a.expr, env));
        return this.evalFuncCall(expr.name, args, expr.args, env);
      }

      default:
        return 0;
    }
  }

  evalFuncCall(name, args, rawArgs, env) {
    const rad = (deg) => (Number(deg || 0) * Math.PI) / 180;
    const deg = (r) => (Number(r || 0) * 180) / Math.PI;

    switch (name) {
      case 'min': {
        const flat = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        return Math.min(...flat.map(Number));
      }
      case 'max': {
        const flat = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        return Math.max(...flat.map(Number));
      }
      case 'abs': return Math.abs(Number(args[0] || 0));
      case 'floor': return Math.floor(Number(args[0] || 0));
      case 'ceil': return Math.ceil(Number(args[0] || 0));
      case 'round': return Math.round(Number(args[0] || 0));
      case 'sqrt': return Math.sqrt(Math.max(0, Number(args[0] || 0)));
      case 'pow': return Math.pow(Number(args[0] || 0), Number(args[1] || 0));
      case 'sin': return Math.sin(rad(args[0]));
      case 'cos': return Math.cos(rad(args[0]));
      case 'tan': return Math.tan(rad(args[0]));
      case 'asin': return deg(Math.asin(Number(args[0] || 0)));
      case 'acos': return deg(Math.acos(Number(args[0] || 0)));
      case 'atan': return deg(Math.atan(Number(args[0] || 0)));
      case 'atan2': return deg(Math.atan2(Number(args[0] || 0), Number(args[1] || 1)));
      case 'len': return Array.isArray(args[0]) || typeof args[0] === 'string' ? args[0].length : 0;
      case 'str': return args.map((x) => String(x ?? '')).join('');
      case 'concat': return [].concat(...args.map((a) => (Array.isArray(a) ? a : [a])));
      case 'norm': return Array.isArray(args[0]) ? Math.hypot(...args[0].map(Number)) : Math.abs(Number(args[0] || 0));
      default: {
        if (this.globalFunctions.has(name)) {
          const fnDef = this.globalFunctions.get(name);
          const fnEnv = this.cloneEnv(env);
          fnDef.params.forEach((p, idx) => {
            const byName = rawArgs.find((a) => a.name === p.name);
            let val;
            if (byName) val = this.evalExpr(byName.expr, env);
            else if (idx < args.length) val = args[idx];
            else if (p.defaultExpr) val = this.evalExpr(p.defaultExpr, fnEnv);
            fnEnv.set(p.name, val);
          });
          return this.evalExpr(fnDef.expr, fnEnv);
        }
        return 0;
      }
    }
  }

  expandIterable(val) {
    if (Array.isArray(val)) return val;
    if (val && val._isRange) {
      const start = val.start;
      const end = val.end;
      let step = val.step;
      if (step === null || step === 0) {
        step = start <= end ? 1 : -1;
      }
      const list = [];
      const maxSteps = 500;
      if (step > 0) {
        for (let v = start; v <= end + 1e-7 && list.length < maxSteps; v += step) {
          list.push(Number(v.toFixed(6)));
        }
      } else if (step < 0) {
        for (let v = start; v >= end - 1e-7 && list.length < maxSteps; v += step) {
          list.push(Number(v.toFixed(6)));
        }
      }
      return list;
    }
    return [];
  }

  isTruthy(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return v.length > 0;
    if (Array.isArray(v)) return v.length > 0;
    return Boolean(v);
  }

  parseColorToHex(cArg) {
    if (typeof cArg === 'string') {
      const s = cArg.trim().toLowerCase();
      if (s.startsWith('#')) {
        if (s.length === 4) {
          return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
        }
        return s.slice(0, 7);
      }
      return CSS_NAMED_COLORS[s] || '#38bdf8';
    }
    if (Array.isArray(cArg) && cArg.length >= 3) {
      const toHex = (n) => {
        const v = Number(n) <= 1.0 ? Math.round(Number(n) * 255) : Math.round(Number(n));
        return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
      };
      return `#${toHex(cArg[0])}${toHex(cArg[1])}${toHex(cArg[2])}`;
    }
    return '#38bdf8';
  }
}

// ============================================================================
// 7. BINARY STL & MULTICOLOR 3MF PACKAGER + EXTERNAL STL PARSER
// ============================================================================

function groupMeshItemsByColor(items3D) {
  const map = new Map();
  for (const item of items3D) {
    if (!item.triangles || item.triangles.length === 0) continue;
    const color = (item.color || '#38bdf8').toLowerCase();
    const key = `${item.name || 'Part'}::${color}`;
    if (!map.has(key)) {
      map.set(key, {
        name: item.name || 'Part',
        color,
        triangles: []
      });
    }
    map.get(key).triangles.push(...item.triangles);
  }
  return Array.from(map.values());
}

function exportBinarySTL(parts) {
  let totalTriangles = 0;
  for (const part of parts) {
    totalTriangles += part.triangles.length;
  }

  const buffer = new ArrayBuffer(84 + totalTriangles * 50);
  const view = new DataView(buffer);

  const headerStr = 'Board2CAD Manifold Binary STL (eps=0.05mm) - Fusion 360 Ready';
  for (let i = 0; i < 80; i++) {
    view.setUint8(i, i < headerStr.length ? headerStr.charCodeAt(i) : 32);
  }

  view.setUint32(80, totalTriangles, true);

  let offset = 84;
  for (const part of parts) {
    for (const tri of part.triangles) {
      const [x0, y0, z0, x1, y1, z1, x2, y2, z2] = tri;
      const ux = x1 - x0, uy = y1 - y0, uz = z1 - z0;
      const vx = x2 - x0, vy = y2 - y0, vz = z2 - z0;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;

      view.setFloat32(offset, nx, true);
      view.setFloat32(offset + 4, ny, true);
      view.setFloat32(offset + 8, nz, true);

      view.setFloat32(offset + 12, x0, true);
      view.setFloat32(offset + 16, y0, true);
      view.setFloat32(offset + 20, z0, true);

      view.setFloat32(offset + 24, x1, true);
      view.setFloat32(offset + 28, y1, true);
      view.setFloat32(offset + 32, z1, true);

      view.setFloat32(offset + 36, x2, true);
      view.setFloat32(offset + 40, y2, true);
      view.setFloat32(offset + 44, z2, true);

      view.setUint16(offset + 48, 0, true);
      offset += 50;
    }
  }

  return { buffer, totalTriangles };
}

function exportMulticolor3MF(parts) {
  const materials = [];
  const colorToIndex = new Map();

  for (const part of parts) {
    const hex = (part.color || '#38bdf8').toUpperCase();
    if (!colorToIndex.has(hex)) {
      colorToIndex.set(hex, materials.length);
      materials.push({ name: part.name, color: hex });
    }
  }

  const verticesXml = [];
  const trianglesXml = [];
  let vIndex = 0;

  for (const part of parts) {
    const matIdx = colorToIndex.get((part.color || '#38bdf8').toUpperCase()) || 0;
    for (const tri of part.triangles) {
      const [x0, y0, z0, x1, y1, z1, x2, y2, z2] = tri;
      verticesXml.push(
        `          <vertex x="${x0.toFixed(4)}" y="${y0.toFixed(4)}" z="${z0.toFixed(4)}" />`,
        `          <vertex x="${x1.toFixed(4)}" y="${y1.toFixed(4)}" z="${z1.toFixed(4)}" />`,
        `          <vertex x="${x2.toFixed(4)}" y="${y2.toFixed(4)}" z="${z2.toFixed(4)}" />`
      );
      trianglesXml.push(
        `          <triangle v1="${vIndex}" v2="${vIndex + 1}" v3="${vIndex + 2}" pid="1" p1="${matIdx}" />`
      );
      vIndex += 3;
    }
  }

  const baseMaterialsXml = materials
    .map((m) => `      <base name="${m.name.replace(/["<>]/g, '')}" displaycolor="${m.color}FF" />`)
    .join('\n');

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="it-IT" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Application">Board2CAD Studio v1.1.0</metadata>
  <resources>
    <basematerials id="1">
${baseMaterialsXml}
    </basematerials>
    <object id="2" name="Board2CAD_PCB_Assembly" type="model" pid="1" pindex="0">
      <mesh>
        <vertices>
${verticesXml.join('\n')}
        </vertices>
        <triangles>
${trianglesXml.join('\n')}
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="2" />
  </build>
</model>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;

  const enc = new TextEncoder();
  return buildWorkerZip([
    { name: '[Content_Types].xml', data: enc.encode(contentTypesXml) },
    { name: '_rels/.rels', data: enc.encode(relsXml) },
    { name: '3D/3dmodel.model', data: enc.encode(modelXml) }
  ]);
}

function buildWorkerZip(files) {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c >>> 0;
  }
  const crc32 = (bytes) => {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  const enc = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const dataBytes = f.data;
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lh.set(nameBytes, 30);
    localParts.push(lh, dataBytes);

    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    centralParts.push(ch);

    offset += lh.length + size;
  }

  const centralSize = centralParts.reduce((a, b) => a + b.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + 22);
  let pos = 0;
  for (const p of localParts) { out.set(p, pos); pos += p.length; }
  for (const p of centralParts) { out.set(p, pos); pos += p.length; }
  out.set(eocd, pos);
  return out.buffer;
}

/**
 * Parses an external Binary or ASCII .STL ArrayBuffer into viewerParts + metrics
 */
function parseExternalSTLBuffer(arrayBuffer, color = '#38bdf8') {
  const view = new DataView(arrayBuffer);
  const triangles = [];

  // Check if binary STL (84 + count * 50 === byteLength)
  if (arrayBuffer.byteLength >= 84) {
    const triCount = view.getUint32(80, true);
    if (84 + triCount * 50 === arrayBuffer.byteLength && triCount > 0) {
      let offset = 84;
      for (let i = 0; i < triCount; i++) {
        const x0 = view.getFloat32(offset + 12, true);
        const y0 = view.getFloat32(offset + 16, true);
        const z0 = view.getFloat32(offset + 20, true);
        const x1 = view.getFloat32(offset + 24, true);
        const y1 = view.getFloat32(offset + 28, true);
        const z1 = view.getFloat32(offset + 32, true);
        const x2 = view.getFloat32(offset + 36, true);
        const y2 = view.getFloat32(offset + 40, true);
        const z2 = view.getFloat32(offset + 44, true);
        triangles.push([x0, y0, z0, x1, y1, z1, x2, y2, z2]);
        offset += 50;
      }
    }
  }

  // Fallback to ASCII STL parser
  if (triangles.length === 0) {
    const text = new TextDecoder().decode(arrayBuffer);
    const vertexRegex = /vertex\s+([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s+([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s+([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)/g;
    const verts = [];
    let m;
    while ((m = vertexRegex.exec(text)) !== null) {
      verts.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
      if (verts.length === 9) {
        triangles.push(verts.slice());
        verts.length = 0;
      }
    }
  }

  return [{ name: 'Imported_STL_Mesh', color, triangles }];
}

/**
 * Extracts 3D/3dmodel.model XML from an uncompressed or standard .3MF buffer and parses vertices/triangles/colors
 */
function parseExternal3MFBuffer(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const modelStart = text.indexOf('<model');
  const modelEnd = text.lastIndexOf('</model>');
  if (modelStart === -1 || modelEnd === -1) {
    return [];
  }
  const xml = text.slice(modelStart, modelEnd + 8);

  // Extract basematerials displaycolors
  const colors = [];
  const baseRegex = /<base\s+[^>]*displaycolor="(#?[0-9a-fA-F]{6,8})"/g;
  let bm;
  while ((bm = baseRegex.exec(xml)) !== null) {
    let hex = bm[1].startsWith('#') ? bm[1] : `#${bm[1]}`;
    colors.push(hex.slice(0, 7));
  }

  // Extract vertices
  const vertices = [];
  const vertRegex = /<vertex\s+[^>]*x="([+-]?\d*\.?\d+)"\s+y="([+-]?\d*\.?\d+)"\s+z="([+-]?\d*\.?\d+)"/g;
  let vm;
  while ((vm = vertRegex.exec(xml)) !== null) {
    vertices.push([parseFloat(vm[1]), parseFloat(vm[2]), parseFloat(vm[3])]);
  }

  // Extract triangles
  const byColor = new Map();
  const triRegex = /<triangle\s+[^>]*v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"(?:[^>]*p1="(\d+)")?/g;
  let tm;
  while ((tm = triRegex.exec(xml)) !== null) {
    const v1 = vertices[parseInt(tm[1], 10)];
    const v2 = vertices[parseInt(tm[2], 10)];
    const v3 = vertices[parseInt(tm[3], 10)];
    if (!v1 || !v2 || !v3) continue;
    const cIdx = tm[4] !== undefined ? parseInt(tm[4], 10) : 0;
    const col = colors[cIdx] || '#38bdf8';
    if (!byColor.has(col)) {
      byColor.set(col, { name: `3MF_Material_${cIdx}`, color: col, triangles: [] });
    }
    byColor.get(col).triangles.push([v1[0], v1[1], v1[2], v2[0], v2[1], v2[2], v3[0], v3[1], v3[2]]);
  }

  return Array.from(byColor.values());
}

function serializePartsForViewer(parts) {
  return parts.map((p) => {
    const positions = new Float32Array(p.triangles.length * 9);
    let idx = 0;
    for (const tri of p.triangles) {
      for (let k = 0; k < 9; k++) {
        positions[idx++] = tri[k];
      }
    }
    return {
      name: p.name,
      color: p.color,
      triangleCount: p.triangles.length,
      positions
    };
  });
}

function applyParameterOverrides(scadCode = '', overrides = {}) {
  let updated = scadCode;
  for (const [key, val] of Object.entries(overrides)) {
    const formatted = typeof val === 'boolean' ? (val ? 'true' : 'false') : Number(val);
    const regex = new RegExp(`(^\\s*${key.replace('$', '\\$')}\\s*=\\s*)([^;]+)(;.*)$`, 'm');
    if (regex.test(updated)) {
      updated = updated.replace(regex, `$1${formatted}$3`);
    }
  }
  return updated;
}

function validateManifoldScad(scadCode = '') {
  const warnings = [];
  const errors = [];

  if (!scadCode || scadCode.trim().length < 10) {
    errors.push('Lo script OpenSCAD è vuoto o troppo breve.');
  }

  if (!/\beps\s*=/.test(scadCode) && !/0\.05/.test(scadCode)) {
    warnings.push('Consiglio: usa una compenetrazione eps = 0.05 mm per evitare facce coplanari.');
  }

  return {
    isValid: errors.length === 0,
    isManifold: errors.length === 0,
    errors,
    warnings
  };
}

// ============================================================================
// 8. WEB WORKER MESSAGE HANDLER
// ============================================================================

self.onmessage = async (event) => {
  const { id, action, scadCode, overrides, stlBuffer: rawStlBuffer, threemfBuffer: raw3mfBuffer } = event.data || {};

  const t0 = performance.now();

  try {
    // ACTION A: Parse an uploaded external .STL buffer and generate matching 3MF + viewerParts
    if (action === 'parse_stl' && rawStlBuffer) {
      const parts = parseExternalSTLBuffer(rawStlBuffer, '#38bdf8');
      const allTris = parts.flatMap((p) => p.triangles);
      if (allTris.length === 0) {
        throw new Error('Il file STL caricato non contiene triangoli validi.');
      }
      const bbox = computeBoundingBox(allTris);
      const threemfBuffer = exportMulticolor3MF(parts);
      const viewerParts = serializePartsForViewer(parts);
      const elapsedMs = Math.round(performance.now() - t0);

      self.postMessage({
        id,
        ok: true,
        stlBuffer: rawStlBuffer,
        threemfBuffer,
        viewerParts,
        metrics: {
          triangles: allTris.length,
          vertices: allTris.length * 3,
          elapsedMs,
          engine: 'Direct STL Importer + 3MF Packager',
          center: [(bbox.minX + bbox.maxX) * 0.5, (bbox.minY + bbox.maxY) * 0.5],
          dimensions: {
            length: Number(Math.max(1, bbox.maxX - bbox.minX).toFixed(1)),
            width: Number(Math.max(1, bbox.maxY - bbox.minY).toFixed(1)),
            height: Number(Math.max(0.5, bbox.maxZ - bbox.minZ).toFixed(1))
          }
        }
      });
      return;
    }

    // ACTION A2: Parse an uploaded external .3MF buffer and generate matching STL + viewerParts
    if (action === 'parse_3mf' && raw3mfBuffer) {
      const parts = parseExternal3MFBuffer(raw3mfBuffer);
      const allTris = parts.flatMap((p) => p.triangles);
      if (allTris.length === 0) {
        throw new Error('Impossibile estrarre i triangoli dal file .3MF caricato (usa un .3MF non compresso o ricompila da .SCAD).');
      }
      const bbox = computeBoundingBox(allTris);
      const { buffer: stlBuffer } = exportBinarySTL(parts);
      const viewerParts = serializePartsForViewer(parts);
      const elapsedMs = Math.round(performance.now() - t0);

      self.postMessage({
        id,
        ok: true,
        stlBuffer,
        threemfBuffer: raw3mfBuffer,
        viewerParts,
        metrics: {
          triangles: allTris.length,
          vertices: allTris.length * 3,
          elapsedMs,
          engine: 'Direct 3MF Multicolor Importer',
          center: [(bbox.minX + bbox.maxX) * 0.5, (bbox.minY + bbox.maxY) * 0.5],
          dimensions: {
            length: Number(Math.max(1, bbox.maxX - bbox.minX).toFixed(1)),
            width: Number(Math.max(1, bbox.maxY - bbox.minY).toFixed(1)),
            height: Number(Math.max(0.5, bbox.maxZ - bbox.minZ).toFixed(1))
          }
        }
      });
      return;
    }

    // ACTION B: Compile arbitrary OpenSCAD script (.scad -> AST -> 3D CSG -> STL & 3MF)
    if (action !== 'compile') return;

    const finalScad = overrides ? applyParameterOverrides(scadCode, overrides) : scadCode;
    const validation = validateManifoldScad(finalScad);

    if (!validation.isValid) {
      self.postMessage({
        id,
        ok: false,
        error: validation.errors.join(' '),
        validation
      });
      return;
    }

    const tokens = tokenizeScad(finalScad);
    const parser = new ScadParser(tokens);
    const ast = parser.parseProgram();
    const interpreter = new ScadInterpreter(ast);
    const { items3D } = interpreter.run();

    const parts = groupMeshItemsByColor(items3D);
    if (parts.length === 0) {
      throw new Error('Lo script OpenSCAD non ha generato alcuna geometria 3D visibile.');
    }

    const allTris = parts.flatMap((p) => p.triangles);
    const bbox = computeBoundingBox(allTris);
    const { buffer: stlBuffer, totalTriangles } = exportBinarySTL(parts);
    const threemfBuffer = exportMulticolor3MF(parts);
    const viewerParts = serializePartsForViewer(parts);

    const elapsedMs = Math.round(performance.now() - t0);

    self.postMessage(
      {
        id,
        ok: true,
        scadCode: finalScad,
        stlBuffer,
        threemfBuffer,
        viewerParts,
        metrics: {
          triangles: totalTriangles,
          vertices: totalTriangles * 3,
          elapsedMs,
          engine: 'OpenSCAD AST CSG + 3MF Engine',
          center: [(bbox.minX + bbox.maxX) * 0.5, (bbox.minY + bbox.maxY) * 0.5],
          dimensions: {
            length: Number(Math.max(1, bbox.maxX - bbox.minX).toFixed(1)),
            width: Number(Math.max(1, bbox.maxY - bbox.minY).toFixed(1)),
            height: Number(Math.max(0.5, bbox.maxZ - bbox.minZ).toFixed(1))
          }
        },
        validation
      },
      [stlBuffer, threemfBuffer]
    );
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err?.message || String(err)
    });
  }
};
