/**
 * A CSV reader for the sheets in `data/`. Small on purpose -- these files come
 * from Google's own CSV export, so the only awkwardness is quoted fields
 * holding commas and newlines, which several contact and notes cells do.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  // Strip a BOM and normalise line endings so the state machine below only has
  // to think about \n.
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (quoted) {
      if (c === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }

  // A file not ending in a newline still has a last field to flush.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Google pads exports with fully empty trailing rows.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}
