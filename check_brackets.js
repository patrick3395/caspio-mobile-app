const fs = require('fs');
const text = fs.readFileSync('src/app/pages/engineers-foundation/engineers-foundation.page.ts', 'utf8');
const stack = [];
let inSingle = false, inDouble = false, inTemplate = false, escape = false;
const opens = ['(', '{', '['];
const closes = [')', '}', ']'];
for (let i = 0; i < text.length; i++) {
  const ch = text[i];
  if (inSingle || inDouble || inTemplate) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (inSingle && ch === "'") { inSingle = false; continue; }
    if (inDouble && ch === '"') { inDouble = false; continue; }
    if (inTemplate && ch === '') { inTemplate = false; continue; }
    continue;
  }
  if (ch === "'") { inSingle = true; continue; }
  if (ch === '"') { inDouble = true; continue; }
  if (ch === '') { inTemplate = true; continue; }
  const openIndex = opens.indexOf(ch);
  const closeIndex = closes.indexOf(ch);
  if (openIndex !== -1) {
    stack.push({ ch, index: i });
  } else if (closeIndex !== -1) {
    if (stack.length === 0) {
      console.log('Unmatched closing', ch, 'at', i);
      process.exit(1);
    }
    const last = stack.pop();
    if (opens.indexOf(last.ch) !== closeIndex) {
      console.log('Mismatch', last.ch, 'at', last.index, 'with', ch, 'at', i);
      process.exit(1);
    }
  }
}
if (stack.length > 0) {
  console.log('Unmatched openings:', stack);
  process.exit(1);
}
console.log('Balanced');
