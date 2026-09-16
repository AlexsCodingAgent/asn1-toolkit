// TypeScript / JS pretty-printer for rasn-compiler's TypeScript backend output.
//
// Unlike the Rust backend, this one does not shell out to a formatter upstream,
// so the layout comes out with odd indentation: namespaces pushed far right,
// members at column 0, closing braces floating. It is valid TypeScript but it
// reads badly, which for a code generator is a bad look.
//
// This re-indents braces and namespace/interface/type bodies. It is line-based
// and conservative: it only changes leading whitespace plus the two obvious
// spacing nits (`{` placement), never the tokens themselves.

export function formatTypescript(src) {
  if (!src || !src.trim()) return src;

  const lines = src.split('\n');
  const out = [];
  let indent = 0;
  const PAD = '    ';

  for (let raw of lines) {
    let line = raw.trim();
    if (!line) {
      // Collapse runs of blank lines.
      if (out.length && out[out.length - 1] !== '') out.push('');
      continue;
    }

    // Strip any comment-only lines out of indentation accounting.
    const isComment = line.startsWith('//') || line.startsWith('/*') || line.startsWith('*');

    // A line that closes a block before anything else dedents first.
    while (line.startsWith('}')) {
      indent = Math.max(0, indent - 1);
      break;
    }

    if (isComment) {
      out.push(PAD.repeat(Math.max(0, indent)) + line);
    } else {
      // Normalise spacing inside the line.
      let l = line
        .replace(/\s*:\s*/g, ': ')
        .replace(/\s*\?\s*/g, '?')
        .replace(/\s*,\s*/g, ', ')
        .replace(/\s*=\s*/g, ' = ')
        .replace(/\[\s*\]/g, '[]')
        .replace(/\s+;/g, ';')
        .replace(/\s+([{}])/g, ' $1')          // collapse space before a brace
        .replace(/\{\s*$/, ' {')
        .replace(/\s{2,}/g, ' ')               // collapse any doubled spaces
        .replace(/,\s*$/, ',')                 // no trailing space after a comma
        .replace(/^\}\s*;/, '};');
      out.push(PAD.repeat(Math.max(0, indent)) + l);
    }

    // Adjust indent for the NEXT line based on braces opened/closed here.
    // Count braces outside of strings.
    let opens = 0, closes = 0, inStr = false, esc = false;
    for (const ch of line) {
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"' || ch === "'" || ch === '`') inStr = false;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { inStr = true; continue; }
      if (ch === '{') opens++;
      else if (ch === '}') closes++;
    }
    // A leading closing brace was already counted in the dedent above.
    const leading = line.startsWith('}') ? 1 : 0;
    indent += opens - Math.max(0, closes - leading);
    if (indent < 0) indent = 0;
  }

  // Drop trailing blank line, join.
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}
