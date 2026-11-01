import { toDay, fromDay, todayISO, weekdayMon, fmtLong, fmtShort, fmtDayMonthYear, fmtMonthYear } from "./dates.js";
import { analyze, describeDay } from "./cycles.js";
import { loadState, saveState, setPeriod, updateSettings, merge, sameState } from "./store.js";
import {
  deriveCredentials, saveCredentials, loadCredentials, forgetCredentials,
  pull, push, syncOnce, deleteVault, lastSync, SyncError,
} from "./sync.js";
import { toCSV, parseCSV } from "./csv.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

let state = loadState();
let creds = null;
let syncStatus = "local"; // local | syncing | ok | offline | error
let syncMessage = "";
let a; // current analysis

const now = new Date();
let calYear = now.getFullYear();
let calMonth = now.getMonth();

// ---------------------------------------------------------------- state

function commit() {
  saveState(state);
  render();
  scheduleSync();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

function logStart(iso) {
  const day = toDay(iso);
  const near = a.days.find((d) => d !== day && Math.abs(d - day) < 10);
  if (near !== undefined) {
    const gap = plural(Math.abs(near - day), "day");
    const msg = `There's already a period start on ${fmtShort(fromDay(near))}, ${gap} ${near < day ? "earlier" : "later"}. Log ${fmtShort(iso)} anyway?`;
    if (!confirm(msg)) return;
  }
  setPeriod(state, iso, true);
  commit();
  toast(`Logged ${fmtShort(iso)}`);
}

function removeStart(iso) {
  setPeriod(state, iso, false);
  commit();
  toast(`Removed ${fmtShort(iso)}`);
}

// ---------------------------------------------------------------- render

function render() {
  a = analyze(state, todayISO());
  renderToday();
  renderCalendar();
  renderHistory();
  renderSettings();
  renderSyncPill();
}

function renderToday() {
  const el = $("#today");
  const P = state.settings.periodLength;
  if (a.cycleDay === null) {
    el.innerHTML = `
      <div class="tile tile-big tile-empty">
        <span class="tile-z">00</span><span class="tile-sym">?</span><span class="tile-name">no data yet</span>
      </div>
      <div class="today-info">
        <p class="kicker">Welcome</p>
        <p class="next-when small">Log the first day of your last period to start.</p>
      </div>`;
    return;
  }

  let when;
  let date = "";
  if (a.lateBy > 0) {
    when = `${plural(a.lateBy, "day")} late`;
    date = `expected ${fmtShort(fromDay(a.today - a.lateBy))}`;
  } else if (a.nextDay === a.today) {
    when = "Due today";
    date = fmtShort(fromDay(a.nextDay));
  } else {
    const n = a.nextDay - a.today;
    when = n === 1 ? "Tomorrow" : `in ${n} days`;
    date = fmtShort(fromDay(a.nextDay));
  }

  const inPeriod = a.cycleDay <= P;
  const pct = Math.min(100, (a.cycleDay / a.predLength) * 100);
  const ticks = Array.from({ length: a.predLength }, (_, i) => {
    const cls = [i < a.cycleDay ? "on" : "", i < P ? "p" : ""].join(" ").trim();
    return `<i class="${cls}"></i>`;
  }).join("");

  el.innerHTML = `
    <div class="tile tile-big" aria-label="Cycle day ${a.cycleDay}">
      <span class="tile-z">cycle day</span>
      <span class="tile-sym">${a.cycleDay}</span>
      <span class="tile-name">of ~${a.predLength}</span>
    </div>
    <div class="today-info">
      <p class="kicker">${inPeriod ? `Period · day ${a.cycleDay}` : "Next period"}</p>
      <p class="next-when ${a.lateBy > 0 ? "late" : ""}">${inPeriod ? `next ${when.toLowerCase()}` : when}</p>
      <p class="next-date">${date}</p>
    </div>
    <div class="progress" style="--pct:${pct}%">${a.predLength <= 60 ? ticks : ""}</div>`;
}

function renderCalendar() {
  const mm = (m) => String(m + 1).padStart(2, "0");
  $("#cal-title").textContent = fmtMonthYear(calYear, calMonth);
  const first = toDay(`${calYear}-${mm(calMonth)}-01`);
  const nextMonth = calMonth === 11 ? toDay(`${calYear + 1}-01-01`) : toDay(`${calYear}-${mm(calMonth + 1)}-01`);
  const start = first - weekdayMon(first);
  const weeks = Math.ceil((nextMonth - start) / 7);
  const P = state.settings.periodLength;

  let html = "";
  for (let i = 0; i < weeks * 7; i++) {
    const day = start + i;
    const info = describeDay(a, day, P);
    const cls = ["cell"];
    if (day < first || day >= nextMonth) cls.push("out");
    if (info.period) cls.push(`per-${info.period}`);
    if (info.isStart) cls.push("start");
    if (info.isPredictedStart) cls.push("pstart");
    if (info.isToday) cls.push("today");
    if (info.isFuture) cls.push("future");
    const dnum = Number(info.iso.slice(8));
    const cd = info.cycleDay !== null
      ? `<span class="cd${info.cycleDayPredicted ? " cd-pred" : ""}">${info.cycleDay}</span>`
      : "";
    html += `<button type="button" class="${cls.join(" ")}" data-iso="${info.iso}"><span class="dnum">${dnum}</span>${cd}</button>`;
  }
  $("#cal-grid").innerHTML = html;
}

function renderHistory() {
  const s = a.stats;
  const tile = (z, sym, val, name) => `
    <div class="tile"><span class="tile-z">${z}</span><span class="tile-sym">${sym}</span><span class="tile-val">${val}</span><span class="tile-name">${name}</span></div>`;
  $("#stats").innerHTML = s
    ? tile(1, "Av", s.mean.toFixed(1), "average") +
      tile(2, "Rc", a.avg.toFixed(1), `last ${a.usedCount}`) +
      tile(3, "Lo", s.min, "shortest") +
      tile(4, "Hi", s.max, "longest") +
      tile(5, "N", s.count, s.count === 1 ? "cycle" : "cycles")
    : `<p class="hint">Cycle lengths appear once you've logged at least two period starts.</p>`;

  const rows = [];
  if (a.cycleDay !== null) rows.push({ start: fromDay(a.currentStart), length: a.cycleDay, ongoing: true });
  for (let i = a.cycles.length - 1; i >= 0; i--) rows.push(a.cycles[i]);

  if (!rows.length) {
    $("#bars").innerHTML = `<p class="hint">Nothing logged yet.</p>`;
    return;
  }
  const scale = Math.max(...rows.map((r) => r.length), a.predLength) * 1.12;
  const avgLine = s
    ? `<div class="avg-line" style="--x:${s.mean / scale}"><span>avg ${s.mean.toFixed(1)}</span></div>`
    : "";
  $("#bars").innerHTML =
    `<div class="bars-inner">${avgLine}` +
    rows
      .map((r, i) => `
      <button type="button" class="bar-row${r.ongoing ? " ongoing" : ""}" data-iso="${r.start}" style="--i:${Math.min(i, 20)}">
        <span class="bar-date">${r.ongoing ? "now" : esc(fmtDayMonthYear(r.start))}</span>
        <span class="bar-track">
          <span class="bar" style="--w:${(r.length / scale) * 100}%"></span>
          <span class="bar-num">${r.length}${r.ongoing ? "…" : ""}</span>
        </span>
      </button>`)
      .join("") +
    `</div>`;
}

function renderSettings() {
  const st = state.settings;
  $$('input[name="mode"]').forEach((r) => (r.checked = r.value === st.mode));
  $$("[data-mode-field]").forEach((f) => f.classList.toggle("dim", f.dataset.modeField !== st.mode));
  setIfIdle("#set-avg", st.avgCount);
  setIfIdle("#set-fixed", st.fixedLength);
  setIfIdle("#set-plen", st.periodLength);
  setIfIdle("#set-ahead", st.showAhead);

  let explain;
  if (st.mode === "fixed") explain = `Predicting a ${st.fixedLength}-day cycle.`;
  else if (a.avg === null) explain = `Not enough history yet, so using the fixed length (${st.fixedLength} days) until you've logged two period starts.`;
  else explain = `Average of your last ${plural(a.usedCount, "cycle")}: ${a.avg.toFixed(1)} days → predicting ${a.predLength}-day cycles.`;
  $("#pred-explain").textContent = explain;

  renderSyncCard();
}

function setIfIdle(sel, value) {
  const el = $(sel);
  if (document.activeElement !== el) el.value = value;
}

function renderSyncCard() {
  const card = $("#sync-card");
  if (!creds) {
    if ($("#sync-form", card)) return; // don't wipe what's being typed
    card.innerHTML = `
      <h2 class="section-title">Cloud sync</h2>
      <p class="hint">Your data is encrypted on this device before it's sent to Cloudflare, which only ever stores unreadable bytes.
      Enter the same passphrase on another device to see the same data.</p>
      <form id="sync-form" class="sync-form" autocomplete="on">
        <input type="text" name="username" value="period-table" autocomplete="username" hidden>
        <label class="field col"><span>Passphrase</span><input id="sync-pass" name="password" type="password" autocomplete="current-password" minlength="8" required></label>
        <label class="field col" id="sync-repeat-field" hidden><span>Repeat passphrase</span><input id="sync-repeat" type="password" autocomplete="new-password"></label>
        <button class="btn btn-primary" type="submit" id="sync-connect">Turn on sync</button>
      </form>
      <p class="hint warn">There's no password reset: forget the passphrase and the cloud copy can't be decrypted. Data on this phone and CSV exports are unaffected.</p>`;
    return;
  }
  const ls = lastSync();
  let status = ls ? `last synced ${esc(ago(ls))}` : "not synced yet";
  if (syncStatus === "error") status = `<span class="late">${esc(syncMessage)}</span>`;
  if (syncStatus === "offline") status = "offline, will sync when back online";
  card.innerHTML = `
    <h2 class="section-title">Cloud sync</h2>
    <p class="sync-status"><b>Sync is on</b> · ${status}</p>
    <p class="hint">Changes save on this phone instantly and sync whenever you're online.</p>
    <div class="btn-row">
      <button class="btn btn-ghost" id="sync-now" type="button">Sync now</button>
      <button class="btn btn-ghost" id="sync-forget" type="button">Disconnect</button>
    </div>
    <button class="link-danger" id="sync-delete" type="button">Delete cloud copy…</button>`;
}

function renderSyncPill() {
  const labels = { local: "local only", syncing: "syncing…", ok: "synced", offline: "offline · saved", error: "sync issue" };
  const pill = $("#sync-pill");
  pill.textContent = labels[syncStatus];
  pill.dataset.status = syncStatus;
}

function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}

// ---------------------------------------------------------------- day sheet

function openDay(iso) {
  const info = describeDay(a, toDay(iso), state.settings.periodLength);
  const sheet = $("#day-sheet");
  let body = "";
  if (info.cycleDay !== null) {
    body += `<p class="sheet-cd">${info.cycleDayPredicted ? "predicted " : ""}cycle day <b>${info.cycleDay}</b></p>`;
  }
  if (info.isPredictedStart) body += `<p class="hint">Predicted period start.</p>`;
  let action;
  if (info.isStart) action = `<button class="btn btn-ghost" data-act="remove" type="button">Remove period start</button>`;
  else if (!info.isFuture) action = `<button class="btn btn-primary" data-act="log" type="button">Period started this day</button>`;
  else action = `<p class="hint">You can log this day once it arrives.</p>`;

  sheet.innerHTML = `
    <form method="dialog" class="sheet-inner">
      <h3 class="sheet-title">${esc(fmtLong(iso))}</h3>
      ${body}
      <div class="sheet-actions">${action}<button class="btn btn-link" value="close">Close</button></div>
    </form>`;
  sheet.onclick = (e) => {
    if (e.target === sheet) return sheet.close();
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    sheet.close();
    if (act === "log") logStart(iso);
    if (act === "remove") removeStart(iso);
  };
  sheet.showModal();
}

// Log a start on an earlier day (e.g. one you forgot to log at the time).
// Uses a visible date field: browsers' pop-up pickers don't show up everywhere.
function openOtherDay() {
  const today = todayISO();
  const sheet = $("#day-sheet");
  sheet.innerHTML = `
    <form method="dialog" class="sheet-inner">
      <h3 class="sheet-title">Log an earlier start</h3>
      <p class="hint">Pick the first day of a period you didn't log at the time.</p>
      <label class="field col"><span>First day of period</span>
        <input type="date" id="other-date" max="${today}" value="${fromDay(toDay(today) - 1)}" required>
      </label>
      <div class="sheet-actions">
        <button class="btn btn-primary" data-act="log" type="button">Log period start</button>
        <button class="btn btn-link" value="close">Cancel</button>
      </div>
    </form>`;
  sheet.onclick = (e) => {
    if (e.target === sheet) return sheet.close();
    if (e.target.closest("[data-act]")?.dataset.act !== "log") return;
    const iso = $("#other-date").value;
    if (!iso) return toast("Pick a date first");
    if (iso > todayISO()) return toast("That day hasn't happened yet");
    if (state.periods[iso] && !state.periods[iso].d) return toast("Already logged");
    sheet.close();
    logStart(iso);
  };
  sheet.showModal();
}

// ---------------------------------------------------------------- sync

let syncTimer = null;
let syncing = false;
let syncAgain = false;

function scheduleSync(delay = 800) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, delay);
}

function setSync(status, message = "") {
  syncStatus = status;
  syncMessage = message;
  renderSyncPill();
  if (creds) renderSyncCard();
}

async function runSync() {
  if (!creds) return setSync("local");
  if (!navigator.onLine) return setSync("offline");
  if (syncing) {
    syncAgain = true;
    return;
  }
  syncing = true;
  setSync("syncing");
  try {
    const synced = await syncOnce(creds, state);
    // Anything edited while the request was in flight is merged back in.
    const combined = merge(state, synced);
    if (!sameState(combined, state)) {
      state = combined;
      saveState(state);
      render();
    }
    if (!sameState(combined, synced)) syncAgain = true;
    setSync("ok");
  } catch (e) {
    if (e instanceof SyncError) setSync("error", e.status === 403 ? "wrong passphrase" : e.message);
    else setSync("offline");
  } finally {
    syncing = false;
    if (syncAgain) {
      syncAgain = false;
      scheduleSync(300);
    }
  }
}

async function connect(pass) {
  const btn = $("#sync-connect");
  const repeatField = $("#sync-repeat-field");
  const creating = !repeatField.hidden;
  if (creating && $("#sync-repeat").value !== pass) return toast("The two passphrases don't match");
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Deriving key…";
  try {
    const c = await deriveCredentials(pass);
    btn.textContent = "Connecting…";
    const remote = await pull(c);
    if (remote === null) {
      if (!creating) {
        // First device ever: ask for the passphrase twice so a typo can't lock you out.
        repeatField.hidden = false;
        $("#sync-repeat").focus();
        btn.dataset.label = "Create cloud copy";
        toast("First time: repeat your passphrase to create the cloud copy");
        return;
      }
      await push(c, state);
      toast("Cloud copy created");
    } else {
      state = merge(state, remote);
      saveState(state);
      if (!sameState(state, remote)) await push(c, state);
      toast("Connected, data merged");
    }
    localStorage.setItem("pt.lastSync", String(Date.now()));
    await saveCredentials(c);
    creds = c;
    syncStatus = "ok";
    render();
  } catch (e) {
    if (e instanceof SyncError && e.status === 403) toast("Wrong passphrase");
    else if (e instanceof SyncError) toast(`Sync failed: ${e.message}`);
    else toast("Couldn't reach the server. Are you online?");
  } finally {
    if (btn.isConnected) {
      btn.disabled = false;
      btn.textContent = btn.dataset.label || label;
    }
  }
}

// ---------------------------------------------------------------- csv

async function exportCSV() {
  const csv = toCSV(a.starts);
  const name = `period-table-${todayISO()}.csv`;
  const file = new File([csv], name, { type: "text/csv" });
  if (matchMedia("(pointer: coarse)").matches && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(file);
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importCSV(file) {
  const { dates, bad } = parseCSV(await file.text());
  if (!dates.length) return toast("No dates found in that file");
  const fresh = [...new Set(dates)].filter((iso) => !state.periods[iso] || state.periods[iso].d);
  fresh.forEach((iso) => setPeriod(state, iso, true));
  commit();
  toast(`Imported ${plural(fresh.length, "new date")}${bad.length ? ` · skipped ${bad.length} unreadable` : ""}`);
}

// ---------------------------------------------------------------- misc ui

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

function showTab(name) {
  $$(".view").forEach((v) => (v.hidden = v.dataset.view !== name));
  $$(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  window.scrollTo({ top: 0 });
}

function shiftMonth(delta) {
  calMonth += delta;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  if (calMonth > 11) { calMonth = 0; calYear++; }
  renderCalendar();
}

function bindNumber(sel, key, min, max) {
  $(sel).addEventListener("change", (e) => {
    const v = Math.round(Number(e.target.value));
    if (!Number.isFinite(v) || v < min || v > max) {
      toast(`Please pick a number from ${min} to ${max}`);
      e.target.value = state.settings[key];
      return;
    }
    updateSettings(state, { [key]: v });
    commit();
  });
}

function wire() {
  $$(".tabbar button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  $("#sync-pill").addEventListener("click", () => showTab("settings"));

  $("#log-today").addEventListener("click", () => {
    const t = todayISO();
    if (state.periods[t] && !state.periods[t].d) return toast("Already logged for today");
    logStart(t);
  });
  $("#log-other").addEventListener("click", openOtherDay);

  $("#cal-prev").addEventListener("click", () => shiftMonth(-1));
  $("#cal-next").addEventListener("click", () => shiftMonth(1));
  $("#cal-title").addEventListener("click", () => {
    const n = new Date();
    calYear = n.getFullYear();
    calMonth = n.getMonth();
    renderCalendar();
  });
  $("#cal-grid").addEventListener("click", (e) => {
    const cell = e.target.closest(".cell");
    if (cell) openDay(cell.dataset.iso);
  });
  let touchX = null;
  const grid = $("#cal-grid");
  grid.addEventListener("touchstart", (e) => (touchX = e.touches[0].clientX), { passive: true });
  grid.addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 60) shiftMonth(dx < 0 ? 1 : -1);
  });

  $("#bars").addEventListener("click", (e) => {
    const row = e.target.closest(".bar-row");
    if (!row) return;
    calYear = Number(row.dataset.iso.slice(0, 4));
    calMonth = Number(row.dataset.iso.slice(5, 7)) - 1;
    renderCalendar();
    showTab("cycle");
    $(".calendar").scrollIntoView({ behavior: "smooth" });
  });

  $$('input[name="mode"]').forEach((r) =>
    r.addEventListener("change", () => {
      updateSettings(state, { mode: r.value });
      commit();
    }),
  );
  bindNumber("#set-avg", "avgCount", 1, 36);
  bindNumber("#set-fixed", "fixedLength", 10, 90);
  bindNumber("#set-plen", "periodLength", 1, 14);
  bindNumber("#set-ahead", "showAhead", 1, 12);

  $("#sync-card").addEventListener("submit", (e) => {
    e.preventDefault();
    connect($("#sync-pass").value);
  });
  $("#sync-card").addEventListener("click", async (e) => {
    const id = e.target.id;
    if (id === "sync-now") runSync();
    if (id === "sync-forget" && confirm("Stop syncing on this device? Your data stays on this phone and in the cloud.")) {
      await forgetCredentials();
      creds = null;
      setSync("local");
      renderSyncCard();
    }
    if (id === "sync-delete" && confirm("Permanently delete the encrypted cloud copy? Data on this phone is kept. Other devices will stop syncing.")) {
      try {
        await deleteVault(creds);
        await forgetCredentials();
        creds = null;
        setSync("local");
        renderSyncCard();
        toast("Cloud copy deleted");
      } catch {
        toast("Couldn't delete. Are you online?");
      }
    }
  });

  $("#export-csv").addEventListener("click", exportCSV);
  $("#import-csv").addEventListener("change", (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f) importCSV(f);
  });

  window.addEventListener("online", () => runSync());
  window.addEventListener("offline", () => creds && setSync("offline"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    render(); // the date may have changed since the app was last open
    runSync();
  });
}

// ---------------------------------------------------------------- boot

wire();
render();
creds = await loadCredentials();
if (creds) {
  renderSyncCard();
  runSync();
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
