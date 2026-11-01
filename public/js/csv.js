// CSV import/export. Export: start_date,cycle_length_days. Import reads the
// first column only, accepting YYYY-MM-DD, DD/MM/YYYY, DD.MM.YYYY or DD-MM-YYYY.
import { isValidISO, toDay } from "./dates.js";

export function toCSV(starts) {
  const rows = ["start_date,cycle_length_days"];
  starts.forEach((iso, i) => {
    const next = starts[i + 1];
    rows.push(`${iso},${next ? toDay(next) - toDay(iso) : ""}`);
  });
  return rows.join("\n") + "\n";
}

export function parseCSV(text) {
  const dates = [];
  const bad = [];
  for (const line of text.split(/\r?\n/)) {
    const cell = line.split(/[,;\t]/)[0].trim().replace(/^"|"$/g, "");
    if (!cell || /[a-z]/i.test(cell)) continue; // blank line or header
    const iso = parseDate(cell);
    if (iso) dates.push(iso);
    else bad.push(cell);
  }
  return { dates, bad };
}

function parseDate(s) {
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return check(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return check(m[3], m[2], m[1]);
  return null;
}

function check(y, m, d) {
  const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return isValidISO(iso) ? iso : null;
}
