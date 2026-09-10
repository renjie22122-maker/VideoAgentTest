import fs from 'node:fs';

// Brace/paren/bracket balance checker for refactors: node scripts/brace-check.mjs <file>
const file = process.argv[2];
const src = fs.readFileSync(file, 'utf8');
let line = 1;
const stack = [];
let i = 0;
let inStr = null;
while (i < src.length) {
  const c = src[i];
  const n = src[i + 1];
  if (c === '\n') line++;
  if (inStr) {
    if (c === '\\') i += 2;
    else {
      if (c === inStr) inStr = null;
      i++;
    }
    continue;
  }
  if (c === '"' || c === "'" || c === '`') {
    inStr = c;
    i++;
    continue;
  }
  if (c === '/' && n === '/') {
    while (i < src.length && src[i] !== '\n') i++;
    continue;
  }
  if (c === '/' && n === '*') {
    i += 2;
    while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
      if (src[i] === '\n') line++;
      i++;
    }
    i += 2;
    continue;
  }
  if (c === '(' || c === '[' || c === '{') stack.push({ c, line });
  else if (c === ')' || c === ']' || c === '}') {
    const open = stack.pop();
    const expect = c === ')' ? '(' : c === ']' ? '[' : '{';
    if (!open || open.c !== expect) {
      console.log(
        `MISMATCH at line ${line}: found ${c}, expected close of ${open ? open.c + ' (line ' + open.line + ')' : 'nothing'}`,
      );
      process.exit(1);
    }
  }
  i++;
}
if (inStr) console.log('unterminated string!');
if (stack.length) console.log('unclosed:', stack.slice(-8));
else console.log('balanced');
