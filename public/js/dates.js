// Dates are handled as ISO strings ("2026-10-31") or as integer day numbers
// (days since 1970-01-01, computed in UTC so DST never shifts anything).

const DAY_MS = 86400000;

export function toDay(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function fromDay(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function todayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isValidISO(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return fromDay(toDay(iso)) === iso;
}

// 0 = Monday ... 6 = Sunday
export function weekdayMon(day) {
  return (new Date(day * DAY_MS).getUTCDay() + 6) % 7;
}

function utc(day) {
  return new Date(day * DAY_MS);
}

export function fmtLong(iso) {
  return utc(toDay(iso)).toLocaleDateString(undefined, {
    weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

export function fmtShort(iso) {
  return utc(toDay(iso)).toLocaleDateString(undefined, {
    weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
  });
}

export function fmtDayMonthYear(iso) {
  return utc(toDay(iso)).toLocaleDateString(undefined, {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

export function fmtMonthYear(year, month) {
  return new Date(Date.UTC(year, month, 1)).toLocaleDateString(undefined, {
    month: "long", year: "numeric", timeZone: "UTC",
  });
}
