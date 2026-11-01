// All the period maths. Pure functions of (state, today).
import { toDay, fromDay } from "./dates.js";

export function activeStarts(state) {
  return Object.keys(state.periods)
    .filter((iso) => !state.periods[iso].d)
    .sort();
}

export function analyze(state, todayIso) {
  const s = state.settings;
  const starts = activeStarts(state);
  const days = starts.map(toDay);
  const today = toDay(todayIso);

  const cycles = [];
  for (let i = 0; i + 1 < days.length; i++) {
    cycles.push({ start: starts[i], length: days[i + 1] - days[i] });
  }

  // Which cycle length do we predict with?
  let avg = null;
  let usedCount = 0;
  if (cycles.length) {
    const recent = cycles.slice(-s.avgCount);
    usedCount = recent.length;
    avg = recent.reduce((sum, c) => sum + c.length, 0) / recent.length;
  }
  const useAverage = s.mode === "average" && avg !== null;
  const predLength = Math.max(1, useAverage ? Math.round(avg) : s.fixedLength);

  const lastDay = days.length ? days[days.length - 1] : null;
  const pastStarts = days.filter((d) => d <= today);
  const currentStart = pastStarts.length ? pastStarts[pastStarts.length - 1] : null;
  const cycleDay = currentStart !== null ? today - currentStart + 1 : null;

  // Predictions: lastStart + L, + 2L, ...  If that first date has already
  // passed without a logged period, we're "late": predict today, then onward.
  const predicted = [];
  let lateBy = 0;
  if (lastDay !== null) {
    let next = lastDay + predLength;
    if (next < today) {
      lateBy = today - next;
      next = today;
    }
    for (let k = 0; k < s.showAhead; k++) predicted.push(next + k * predLength);
  }

  return {
    starts, days, cycles, today,
    predLength, avg, usedCount, useAverage,
    currentStart, cycleDay, lateBy,
    predicted,
    nextDay: predicted.length ? predicted[0] : null,
    stats: cycleStats(cycles),
  };
}

function cycleStats(cycles) {
  if (!cycles.length) return null;
  const lengths = cycles.map((c) => c.length);
  return {
    count: lengths.length,
    mean: lengths.reduce((a, b) => a + b, 0) / lengths.length,
    min: Math.min(...lengths),
    max: Math.max(...lengths),
  };
}

// Describe a single calendar day: cycle day number, period shading, markers.
export function describeDay(a, day, periodLength) {
  const isFuture = day > a.today;
  // Anchors for counting cycle days: logged starts, plus predicted starts for the future.
  const anchors = isFuture ? a.days.concat(a.predicted) : a.days;
  let anchor = null;
  for (const d of anchors) {
    if (d <= day && (anchor === null || d > anchor)) anchor = d;
  }
  const anchorPredicted = anchor !== null && !a.days.includes(anchor);
  const cycleDay = anchor === null ? null : day - anchor + 1;

  const isStart = a.days.includes(day);
  const isPredictedStart = a.predicted.includes(day) && !isStart;

  // Period shading lasts `periodLength` days, but never runs into the next start.
  let period = null;
  for (const d of a.days) {
    if (day >= d && day < d + periodLength && !a.days.some((n) => n > d && n <= day)) period = "logged";
  }
  if (!period) {
    for (const d of a.predicted) {
      if (day >= d && day < d + periodLength) period = "predicted";
    }
  }

  return {
    iso: fromDay(day),
    cycleDay,
    cycleDayPredicted: isFuture || anchorPredicted,
    isStart,
    isPredictedStart,
    period,
    isToday: day === a.today,
    isFuture,
  };
}
