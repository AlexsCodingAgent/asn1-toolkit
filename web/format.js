// Minimal Rust pretty-printer for rasn-compiler output in the browser.
//
// Why this exists: upstream, the Rust backend pipes its output through `rustfmt`.
// A browser cannot spawn processes, so WASM builds get raw unformatted code —
// effectively one very long line. This formats it well enough to read and copy.
//
// It is NOT rustfmt. It targets the shapes rasn-compiler actually emits:
//   #[derive(...)] #[rasn(...)] #[doc = "..."] attributes
//   pub mod x { ... }   pub struct X { ... }   impl X { ... }   fn new(...) { ... }
//
// Key correctness rule: a comma only ends a line when it sits at ZERO bracket
// depth relative to the current body. Commas inside `<...>`, `(...)` and `[...]`
// must not break the line — that was the bug in the first attempt, which split
// `#[derive(AsnType, Debug)]` and `fn new(a: T, b: T)` across lines.

const PAD = '    ';

// Split source into tokens, tracking bracket depth so we know when a comma is
// structural. Attributes are captured whole.
function tokenise(src) {
  const tokens = [];
  let i = 0;
  const n = src.length;
  // Depth of () [] <> relative to the current brace body.
  let depth = 0;

  while (i < n) {
    const c = src[i];

    if (/\s/.test(c)) {
      // Collapse runs of whitespace to a single space token, so we can join words.
      let j = i;
      while (j < n && /\s/.test(src[j])) j++;
      tokens.push({ t: 'ws' });
      i = j;
      continue;
    }

    // Attribute: "#[" or "# [" (the generator emits a space) — capture whole,
    // respecting nesting and strings.
    if (c === '#' && (src[i + 1] === '[' || (src[i + 1] === ' ' && src[i + 2] === '['))) {
      const start = i + (src[i + 1] === ' ' ? 3 : 2);
      let j = start, d = 1, inStr = false, esc = false;
      while (j < n && d > 0) {
        const k = src[j];
        if (inStr) {
          if (esc) esc = false;
          else if (k === '\\') esc = true;
          else if (k === '"') inStr = false;
        } else {
          if (k === '"') inStr = true;
          else if (k === '[') d++;
          else if (k === ']') d--;
        }
        j++;
      }
      tokens.push({ t: 'attr', v: src.slice(start, j - 1) });
      i = j;
      continue;
    }

    // String literal — one token, so commas inside never count.
    if (c === '"') {
      let j = i + 1, esc = false;
      while (j < n) {
        if (esc) esc = false;
        else if (src[j] === '\\') esc = true;
        else if (src[j] === '"') { j++; break; }
        j++;
      }
      tokens.push({ t: 'str', v: src.slice(i, j) });
      i = j;
      continue;
    }

    if (c === '{' || c === '}') {
      tokens.push({ t: 'brace', v: c, depth: 0 });
      i++;
      depth = 0;              // braces reset the relative depth
      continue;
    }

    if (c === '<' || c === '(' || c === '[') {
      depth++;
      tokens.push({ t: 'open', v: c, depth });
      i++;
      continue;
    }
    if (c === '>' || c === ')' || c === ']') {
      depth = Math.max(0, depth - 1);
      tokens.push({ t: 'close', v: c, depth });
      i++;
      continue;
    }

    if (c === ';' || c === ',') {
      tokens.push({ t: 'sep', v: c, depth });
      i++;
      continue;
    }

    // A word / identifier run.
    let j = i;
    while (j < n && !/[\s{};,]/.test(src[j]) &&
           !(src[j] === '#' && (src[j + 1] === '[' ||
             (src[j + 1] === ' ' && src[j + 2] === '['))) && src[j] !== '"' &&
           !'()<>[]'.includes(src[j])) j++;
    if (j === i) j = i + 1;   // safety: always advance
    tokens.push({ t: 'word', v: src.slice(i, j) });
    i = j;
  }
  return tokens;
}

// Rebuild an attribute into conventional form: `#[derive(AsnType, Debug)]`
function tightenAttr(inner) {
  let s = inner;
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/\s*\(\s*/g, '(').replace(/\s*\)\s*/g, ')');
  s = s.replace(/\s*\[/g, '[').replace(/\]\s*/g, ']');
  s = s.replace(/\s*,\s*/g, ', ');
  // Space out a bare '=' as used in `identifier = "x"`, but leave compound
  // operators alone: `..=` in size ranges, and `<=`/`>=`/`==`/`!=`.
  // A lone '=' is one not preceded by one of . < > ! =
  s = s.replace(/(^|[^.<>!=])\s*=\s*(?!=)/g, '$1 = ');
  s = s.replace(/<\s*/g, '<').replace(/\s*>/g, '>');
  // Ensure the ' = ' we just made is not adjacent to a quote oddly
  s = s.replace(/\s+/g, ' ');
  // space between ident and '(' : `derive (` -> `derive(`
  s = s.replace(/\b([A-Za-z_][A-Za-z0-9_]*) \(/g, '$1(');
  return s.trim();
}

export function formatRust(src) {
  if (!src || !src.trim()) return src;

  const tokens = tokenise(src);
  const lines = [];
  let indent = 0;
  let cur = '';

  const flush = () => {
    const t = cur.replace(/\s+/g, ' ').trim();
    if (t) lines.push(PAD.repeat(Math.max(0, indent)) + t);
    cur = '';
  };
  const add = (s) => {
    // Join words with a single space, but never pad after '(' '<' '[' or before them.
    if (!cur) { cur = s; return; }
    const last = cur[cur.length - 1];
    if ('(<['.includes(last) || ')>,;'.includes(s[0]) || s === ')' || s === '>' || s === ']') {
      cur += s;
    } else {
      cur += ' ' + s;
    }
  };

  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];

    if (tk.t === 'ws') continue;

    if (tk.t === 'attr') {
      // Every attribute gets its own line. The generator emits runs of them
      // (#[doc] #[derive] #[rasn] #[non_exhaustive]) and they must not be
      // concatenated onto one line.
      if (cur.trim()) flush();
      lines.push(PAD.repeat(Math.max(0, indent)) + '#[' + tightenAttr(tk.v) + ']');
      continue;
    }

    if (tk.t === 'brace' && tk.v === '{') {
      add('{');
      flush();
      indent++;
      continue;
    }

    if (tk.t === 'brace' && tk.v === '}') {
      flush();
      indent = Math.max(0, indent - 1);
      cur = '}';
      // Attach a following ';'
      if (tokens[i + 1] && tokens[i + 1].t === 'sep' && tokens[i + 1].v === ';') {
        cur = '};';
        i++;
      }
      flush();
      continue;
    }

    if (tk.t === 'sep') {
      if (tk.v === ';') {
        add(';');
        flush();
      } else {
        // A comma at depth 0 inside a body ends a member line.
        add(',');
        if (tk.depth === 0) flush();
      }
      continue;
    }

    add(tk.v);
  }
  flush();

  // Final tidy: normalise spacing the generator emits loosely.
  return lines
    .map((l) => l
      // NOTE: must not touch `..=` ranges. Do the `::` tidy first with a guard
      // that requires a word character before the colon, so `1..=16` is left alone.
      .replace(/([A-Za-z0-9_)\]])\s*::\s*/g, '$1::')
      // `pub x : T` -> `pub x: T`
      .replace(/([A-Za-z0-9_])\s+:\s+(?![=])/g, '$1: ')
      // `Option <T>` -> `Option<T>`, `SequenceOf <Iccid>` -> `SequenceOf<Iccid>`
      .replace(/\s+</g, '<')
      .replace(/<\s+/g, '<')
      // `fn new (` -> `fn new(`
      .replace(/\b(fn\s+[A-Za-z_][A-Za-z0-9_]*) \(/g, '$1(')
      .replace(/\(\s+/g, '(')
      .replace(/\s+\)/g, ')')
      .replace(/\s+;/g, ';')
      .replace(/\s+,/g, ','))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}
