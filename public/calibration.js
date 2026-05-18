import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";



// ===================== CONFIG =====================
const SUPABASE_URL = "https://pnrbdohtrvbrmvabvkxc.supabase.co";
const SUPABASE_KEY = "sb_publishable_YAq1ZIeaJdjx4w0G4DwY3g_tXAZHuVk";
const CRITICAL = 3;
const DUE_SOON_DAYS = 10;
const STATUSPHERE_BASE = "http://statusphere.maxim-ic.com/dp/";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ===================== STATE =====================
let lastStatusphereCheckedAt = null;

// last sync display
let lastSyncShownAt = null;
let lastSyncFetchedAtMs = 0;

// global alerts (all groups)
let lastAlertScrapeTs = null;

const lastViewToastKey = new Map(); // key: viewName -> lastKey string
// ===================== HELPERS =====================

function normalizeIdent(id) {
  if (!id) return null;
  const s = id.trim().toUpperCase();

  let m = /^SZ(\d{1,3})$/i.exec(s);
  if (m) return `SZ${m[1].padStart(3, "0")}`;

  m = /^(TERCAT|QUARTET|DUO|MICROFLEX|TERFLEX)(\d{1,3})$/i.exec(s);
  if (m) return `${m[1]}${m[2].padStart(3, "0")}`;

  // IFLEX variants like 03IFLEX / 25IFLEX / 25IFLEX_SAMPLE
  if (s.includes("IFLEX")) return s;

  // EAGLE variants like EAGLE88159AB
  if (/^EAGLE88[0-9A-Z]+$/.test(s)) return s;

  // MAV variants like MAV10XX / MAV20XX
  if (/^MAV(10|20)\d{2}$/i.test(s)) return s;
// TERMAG variants like TERMAG20XX
  if (/^TERMAG20\d{2}$/i.test(s)) return s;
  // LTX variants like LTX20XX
  if (/^LTX\d{3}$/i.test(s)) return s;
  // ASL1K variants like ASL1K123
  if (/^ASL1K\d{3}$/i.test(s)) return s;
  // ASL4K variants like ASL4K123
  if (/^ASL4K\d{3}$/i.test(s)) return s;
  // STS50 variants like STS50XXXXX
  if (/^STS50\d{5}$/i.test(s)) return s;
  // SC212 variants like SC212XXX
  if (/^(SC212|KTS|MPS|NOISE|TERA360Z|DOT400|LTXMX)\d{3}$/i.test(s)) return s;
  // // KTS variants like KTS123
  // if (/^KTS\d{3}$/.test(s)) return s;
  // // MPS variants like MPS123
  // if (/^MPS\d{3}$/.test(s)) return s;
  // // NOISE variants like NOISE123
  // if (/^NOISE\d{3}$/.test(s)) return s;
  // // TERA360Z variants like TERA360Z123
  // if (/^TERA360Z\d{3}$/.test(s)) return s;
  return null;
}

function buildStatusphereUrlFromRow(rowHref, equipmentId) {
  // If DB stores href (recommended)
  if (rowHref) {
    const cleanHref = rowHref.replace(/&amp;/g, "&");
    if (/^https?:\/\//i.test(cleanHref)) return cleanHref;
    return STATUSPHERE_BASE.replace(/\/+$/, "/") + cleanHref.replace(/^\/+/, "");
  }

  // Fallback if href missing
  if (equipmentId) {
    return `${STATUSPHERE_BASE}?q=br/equipment-hist/TEST&EQUIPMENT=${encodeURIComponent(equipmentId)}`;
  }

  return null;
}

// ---------- LAST SYNC (time only + Xm ago) ----------
async function updateLastSyncIndicator() {
  const el = document.getElementById("lastSync");
  if (!el) return;

  const nowMs = Date.now();
  const shouldFetch = (nowMs - lastSyncFetchedAtMs) > 60_000; // fetch max once per minute

  if (shouldFetch) {
    lastSyncFetchedAtMs = nowMs;

    const { data, error } = await supabase
      .from("statusphere_equipment")
      .select("checked_at")
      .order("checked_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error("Last Sync fetch error:", error.message);
      el.textContent = "Last Sync: (error)";
      return;
    }

    const latest = data?.[0]?.checked_at;
    if (!latest) {
      el.textContent = "Last Sync: --";
      return;
    }

    lastSyncShownAt = latest;
  }

  if (!lastSyncShownAt) {
    el.textContent = "Last Sync: --";
    return;
  }

  const dt = new Date(lastSyncShownAt);
  const timeOnly = dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const ageMin = Math.max(0, Math.floor((Date.now() - dt.getTime()) / 60000));

  el.textContent = `Last Sync: ${timeOnly} (${ageMin}m ago)`;
}

// ---------- SMART “NEW SCRAPE” CHECK (ACT only) ----------
async function statusphereHasNewScrape(ids) {
  if (!ids || ids.length === 0) return false;

  const { data, error } = await supabase
    .from("statusphere_equipment")
    .select("checked_at")
    .in("equipment_id", ids)
    .order("checked_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("Statusphere checked_at check failed:", error.message);
    return true; // fail-open
  }

  const latest = data?.[0]?.checked_at;
  if (!latest) return false;

  if (!lastStatusphereCheckedAt) {
    lastStatusphereCheckedAt = latest;
    return true;
  }

  if (latest !== lastStatusphereCheckedAt) {
    lastStatusphereCheckedAt = latest;
    return true;
  }

  return false;
}

// ---------- TOASTS ----------
function showToast({ type = "gray", title, message, onClick }) {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const existing = Array.from(container.querySelectorAll(".toast"))
    .find(t => t.dataset.title === title);
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.dataset.title = title;

  const badge = document.createElement("span");
  badge.className = "toast-badge";
  badge.textContent = "ALERT";

  const body = document.createElement("div");
  const t = document.createElement("div");
  t.className = "toast-title";
  t.textContent = title;

  const m = document.createElement("div");
  m.className = "toast-sub";
  m.textContent = message;

  body.appendChild(t);
  body.appendChild(m);

  toast.appendChild(badge);
  toast.appendChild(body);

  if (onClick) toast.addEventListener("click", onClick);

  container.appendChild(toast);
  setTimeout(() => toast.remove(), 10_000);
}

function classifyIssue(stateLong = "", rawTitle = "") {
  const text = ((stateLong || "") + " " + (rawTitle || "")).toUpperCase();

  if (text.includes("YIELD ISSUE")) return "YIELD ISSUE";
  if (text.includes("CONTACT ISSUE")) return "CONTACT ISSUE";
  if (text.includes("RKGU FAIL")) return "RKGU FAIL";

  if (
    text.includes("SYSTEM ISSUE") ||
    text.includes("SYSTEM PROBLEM") ||
    text.includes("SYSTEM FAILURE")
  ) return "SYSTEM ISSUE";

  if (text.includes("QUALIFICATION FAIL DFL")) return "QUALIFICATION FAILURE";
  if (text.includes("HW CHECKER PROBLEM") || text.includes("HW CHECKER")) return "HW CHECKER ISSUE";
  if (text.includes("QA FAIL")) return "QA FAILURE";

  return null;
}

// ✅ Alerts for ALL groups (ACT+UFLEX+EAGLE) based on DB, not table
async function alertIssuesAllGroupsIfNewScrape() {
  const { data: d1, error: e1 } = await supabase
    .from("statusphere_equipment")
    .select("checked_at")
    .order("checked_at", { ascending: false })
    .limit(1);

  if (e1) {
    console.error("Alert check failed:", e1.message);
    return;
  }

  const latestTs = d1?.[0]?.checked_at;
  if (!latestTs) return;

  if (latestTs === lastAlertScrapeTs) return;
  lastAlertScrapeTs = latestTs;

  const { data: rows, error: e2 } = await supabase
    .from("statusphere_equipment")
    .select("equipment_id, state_long, raw_title, href")
    .eq("checked_at", latestTs);

  if (e2) {
    console.error("Alert rows fetch failed:", e2.message);
    return;
  }

  const buckets = {
    "CONTACT ISSUE": [],
    "YIELD ISSUE": [],
    "RKGU FAIL": [],
    "SYSTEM ISSUE": [],
    "QUALIFICATION FAILURE": [],
    "HW CHECKER ISSUE": [],
    "QA FAILURE": [],
  };

  for (const r of (rows || [])) {
    const issue = classifyIssue(r.state_long, r.raw_title);
    if (!issue) continue;
    buckets[issue].push({ id: r.equipment_id, href: r.href });
  }

  for (const [issueName, list] of Object.entries(buckets)) {
    if (!list.length) continue;

    const type =
      issueName === "RKGU FAIL" ? "pink"
      : issueName.includes("SYSTEM") ? "yellow"
      : "red";

    const preview = list.slice(0, 6).map(x => x.id).join(", ") + (list.length > 6 ? " ..." : "");

    showToast({
      type,
      title: `${issueName}: ${list.length}`,
      message: preview,
      onClick: () => {
        const first = list[0];
        const url = buildStatusphereUrlFromRow(first.href, first.id);
        if (url) window.open(url, "_blank", "noopener");
      }
    });
  }
}

// ---------- SCHEDULES ----------
function parseScheduleDate(text) {
  if (!text) return null;
  const t = text.trim();

  const native = new Date(t);
  if (!Number.isNaN(native.getTime())) return native;

  const months = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  const m = /^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/.exec(t);
  if (!m) return null;

  const month = months[m[1].toLowerCase()];
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (month == null) return null;

  return new Date(year, month, day);
}

function computeStatus(dateObj) {
  if (!dateObj) return { state: "na", label: "N/A", days: null };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = new Date(dateObj);
  due.setHours(0, 0, 0, 0);

  const msPerDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.ceil((due - today) / msPerDay);

  if (diffDays < 0) return { state: "overdue", label: `OVERDUE ${Math.abs(diffDays)}d`, days: diffDays };
   if (diffDays === 0) return { state: "critical", label: `DUE TODAY`, days: diffDays };
  if (diffDays <= CRITICAL) return { state: "critical", label: `DUE IN ${diffDays}d`, days: diffDays };
  if (diffDays <= DUE_SOON_DAYS) return { state: "due-soon", label: `DUE IN ${diffDays}d`, days: diffDays };
  //if (diffDays === 0) return { state: "due", label: `DUE TODAY`, days: diffDays };

  return { state: "ok", label: `IN ${diffDays}d`, days: diffDays };
}

function setCellStatus(td, type, scheduleText) {
  td.classList.remove(`${type}-overdue`, `${type}-due-soon`, `${type}-critical`, `${type}-due`);
  td.textContent = scheduleText || "N/A";

  const dateObj = parseScheduleDate(scheduleText);
  const status = computeStatus(dateObj);

  if (status.state === "overdue" || status.state === "due-soon" || status.state === "critical" || status.state === "due") {
    const pill = document.createElement("span");
    pill.classList.add("status-pill");

    if (status.state === "overdue") {
      td.classList.add(`${type}-overdue`);
      pill.classList.add("status-overdue");
    } else if (status.state === "critical") {
      td.classList.add(`${type}-critical`);
      pill.classList.add("status-critical");
    } else if (status.state === "due") {
      td.classList.add(`${type}-due`);
      pill.classList.add("status-due");
    } else {
      td.classList.add(`${type}-due-soon`);
      pill.classList.add("status-due-soon");
    }

    pill.textContent = status.label;
    td.appendChild(pill);
  }

  return status.state;
}

async function fetchPlansFor(ids) {
  const { data, error } = await supabase
    .from("calibration_plans")
    .select("identification, cal_schedule, pm_schedule")
    .in("identification", ids);

  if (error) {
    console.error("Supabase fetch error:", error.message);
    return [];
  }
  return data || [];
}

async function renderSchedulesAndHighlights(tableEl) {
  if (!tableEl) return;

  const rows = Array.from(tableEl.querySelectorAll("tbody tr"));
  const ids = rows.map(tr => normalizeIdent(tr.cells?.[0]?.textContent)).filter(Boolean);
  if (!ids.length) return;

  const plans = await fetchPlansFor(ids);
  const map = new Map(plans.map(p => [normalizeIdent(p.identification), p]));

  for (const tr of rows) {
    tr.classList.remove("row-overdue", "row-due-soon", "row-critical", "row-due");

    const testerName = normalizeIdent(tr.cells?.[0]?.textContent);
    const plan = map.get(testerName);

    const calTd = tr.cells[4];
    const pmTd  = tr.cells[5];

    const calState = setCellStatus(calTd, "cal", plan?.cal_schedule ?? null);
    const pmState  = setCellStatus(pmTd, "pm",  plan?.pm_schedule ?? null);

    if (calState === "overdue" || pmState === "overdue") tr.classList.add("row-overdue");
    else if (calState === "critical" || pmState === "critical") tr.classList.add("row-critical");
    else if (calState === "due-soon" || pmState === "due-soon") tr.classList.add("row-due-soon");
    else if (calState === "due" || pmState === "due") tr.classList.add("row-due");
  }
}

// ---------- UFLEX/EAGLE ROWS ----------
async function ensureUflexRowsExist() {
  const tbody = document.getElementById("uflexTbody");
  if (!tbody) return;

  const { data, error } = await supabase
    .from("statusphere_equipment")
    .select("equipment_id")
    .or("equipment_id.ilike.MICROFLEX%,equipment_id.ilike.TERFLEX%,equipment_id.ilike.%IFLEX%")
    // .order("equipment_id", { ascending: false });
    .order("state_long", { ascending: false });

  if (error) {
    console.error("UFLEX list load error:", error.message);
    return;
  }

  const ids = (data || []).map(r => normalizeIdent(r.equipment_id)).filter(Boolean);

  tbody.innerHTML = "";
  for (const id of ids) {
    const tr = document.createElement("tr");
    const tdName = document.createElement("td");
    tdName.textContent = id;
    tr.appendChild(tdName);

    const tdProd = document.createElement("td");
    tr.appendChild(tdProd);

    tbody.appendChild(tr);
  }
}
//---------- EAGLE ROWS ----------
async function ensureEagleRowsExist() {
  const tbody = document.getElementById("eagleTbody");
  if (!tbody) return;

  const { data, error } = await supabase
    .from("statusphere_equipment")
    .select("equipment_id")
    .ilike("equipment_id", "EAGLE88%")
    .order("state_long", { ascending: false });
    // .order("equipment_id", { ascending: false });

  if (error) {
    console.error("EAGLE list load error:", error.message);
    return;
  }

  const ids = (data || []).map(r => normalizeIdent(r.equipment_id)).filter(Boolean);

  tbody.innerHTML = "";
  for (const id of ids) {
    const tr = document.createElement("tr");
    const tdName = document.createElement("td");
    tdName.textContent = id;
    tr.appendChild(tdName);

    const tdProd = document.createElement("td");
    tr.appendChild(tdProd);

    tbody.appendChild(tr);
  }
}
// ---------- MAV ROWS ----------
async function ensureMAVRowsExist() {
  const tbody = document.getElementById("mavTbody");
  if (!tbody) return;

  const { data, error } = await supabase
    .from("statusphere_equipment")
    .select("equipment_id")
    .or("equipment_id.ilike.MAV10%,equipment_id.ilike.MAV20%,equipment_id.ilike.TERMAG20%")
    // .order("equipment_id", { ascending: false });
    .order("state_long", { ascending: false });

  if (error) {
    console.error("MAV list load error:", error.message);
    return;
  }

  const ids = (data || []).map(r => normalizeIdent(r.equipment_id)).filter(Boolean);

  tbody.innerHTML = "";
  for (const id of ids) {
    const tr = document.createElement("tr");
    const tdName = document.createElement("td");
    tdName.textContent = id;
    tr.appendChild(tdName);

    const tdProd = document.createElement("td");
    tr.appendChild(tdProd);

    tbody.appendChild(tr);
  }
}
//---------- LTX ROWS ----------
async function ensureLTXRowsExist() {
  const tbody = document.getElementById("ltxTbody");
  if (!tbody) return;

  const { data, error } = await supabase
    .from("statusphere_equipment")
    .select("equipment_id")
    .or("equipment_id.ilike.LTX0%")
    // .order("equipment_id", { ascending: false });
    .order("state_long", { ascending: false });

  if (error) {
    console.error("LTX list load error:", error.message);
    return;
  }

  const ids = (data || []).map(r => normalizeIdent(r.equipment_id)).filter(Boolean);

  tbody.innerHTML = "";
  for (const id of ids) {
    const tr = document.createElement("tr");
    const tdName = document.createElement("td");
    tdName.textContent = id;
    tr.appendChild(tdName);

    const tdProd = document.createElement("td");
    tr.appendChild(tdProd);

    tbody.appendChild(tr);
  }
}
//---------- TMT ROWS ----------
async function ensureTMTRowsExist() {
  const tbody = document.getElementById("tmtTbody");
  if (!tbody) return;
  const { data, error } = await supabase
    .from("statusphere_equipment")
    .select("equipment_id")
    .or("equipment_id.ilike.ASL1K%,equipment_id.ilike.ASL4K%")
  .order("state_long", { ascending: false });
  if (error) {
    console.error("TMT list load error:", error.message);
    return;
  }
  const ids = (data || []).map(r => normalizeIdent(r.equipment_id)).filter(Boolean);
  tbody.innerHTML = "";
  for (const id of ids) {
    const tr = document.createElement("tr");
    const tdName = document.createElement("td");
    tdName.textContent = id;
    tr.appendChild(tdName);
    const tdProd = document.createElement("td");
    tr.appendChild(tdProd);
    tbody.appendChild(tr);
  }
}
//----------OTHER LEGACY ROWS (STS50/KTS/MPS/NOISE/TERA360Z/SC212) ----------
async function ensureLegacyRowsExist() {
  const tbody = document.getElementById("legacyTbody");
  if (!tbody) return;
  const { data, error } = await supabase
    .from("statusphere_equipment")
    .select("equipment_id")
    .or("equipment_id.ilike.KTS%,equipment_id.ilike.STS50%,equipment_id.ilike.MPS%,equipment_id.ilike.NOISE%,equipment_id.ilike.TERA360Z%,equipment_id.ilike.SC212%")
  .order("state_long", { ascending: false });
  if (error) {
    console.error("TMT list load error:", error.message);
    return;
  }

  const ids = (data || []).map(r => normalizeIdent(r.equipment_id)).filter(Boolean);
  tbody.innerHTML = "";

  for (const id of ids) {
    const tr = document.createElement("tr");
    const tdName = document.createElement("td");
    tdName.textContent = id;
    tr.appendChild(tdName);

    const tdProd = document.createElement("td");
    tr.appendChild(tdProd);

    tbody.appendChild(tr);
  }
}
//--------SPEA ROWS--------//
async function ensureSPEARowsExist() {
  const tbody = document.getElementById("speaTbody");
  if (!tbody) return;
  const { data, error } = await supabase
    .from("statusphere_equipment")
    .select("equipment_id")
    .ilike("equipment_id", "DOT400%")
  .order("state_long", { ascending: false });
  if (error) {
    console.error("SPEA list load error:", error.message);
    return;
  }
  const ids = (data || []).map(r => normalizeIdent(r.equipment_id)).filter(Boolean);
  tbody.innerHTML = "";
  for (const id of ids) {
    const tr = document.createElement("tr");
    const tdName = document.createElement("td");
    tdName.textContent = id;
    tr.appendChild(tdName);
    const tdProd = document.createElement("td");
    tr.appendChild(tdProd);
    tbody.appendChild(tr);
  }
}
async function ensureLTXMXRowsExist() {
  const tbody = document.getElementById("ltxmxTbody");
  if (!tbody) return;
  const { data, error } = await supabase
    .from("statusphere_equipment")
    .select("equipment_id")
    .ilike("equipment_id", "LTXMX%")
  .order("state_long", { ascending: false });
  if (error) {
    console.error("LTXMX list load error:", error.message);
    return;
  }
  const ids = (data || []).map(r => normalizeIdent(r.equipment_id)).filter(Boolean);
  tbody.innerHTML = "";
  for (const id of ids) {
    const tr = document.createElement("tr");
    const tdName = document.createElement("td");
    tdName.textContent = id;
    tr.appendChild(tdName);
    const tdProd = document.createElement("td");
    tr.appendChild(tdProd);
    tbody.appendChild(tr);
  }
}
// ---------- WAITING/ATTENDED + TIMER FOR ANY STATE ----------
function getEqptStateSegments(rawTitle) {
  if (!rawTitle) return [];
  const line = rawTitle.split(/\r?\n/).find(l => l.toLowerCase().includes("eqpt state"));
  if (!line) return [];
  const afterColon = line.split(":").slice(1).join(":").trim();

  // runtime uses '->'
  return afterColon
    .split("->")
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.toUpperCase());
}

function getPhaseForState(stateShort, rawTitle) {
  const s = (stateShort || "").toUpperCase().trim();
  if (!s) return null;

  const seg = getEqptStateSegments(rawTitle);
  const idx = seg.indexOf(s);
  if (idx === -1) return null;

  const detail1 = seg[idx + 1] || null;
  const detail2 = seg[idx + 2] || null;

  if (!detail1) return null;
  return detail2 ? "ATTENDED" : "WAITING";
}

function extractDurationSeconds(stateShort, stateLong, rawTitle) {
  const text = `${stateShort || ""}\n${stateLong || ""}\n${rawTitle || ""}`.trim();
  if (!text) return null;

  const durLine = text.split(/\r?\n/).find(l => /duration\s*:/i.test(l)) || "";
  let m = durLine.match(/duration\s*:\s*([\d.]+)\s*(days?|d|hrs?|hours?|h|mins?|minutes?|m|secs?|seconds?|s)\b/i);

  if (!m) {
    m = text.match(/([\d.]+)\s*(days?|d|hrs?|hours?|h|mins?|minutes?|m|secs?|seconds?|s)\b/i);
  }

  if (!m) return null;

  const value = parseFloat(m[1]);
  if (Number.isNaN(value)) return null;

  const unit = m[2].toLowerCase();
  if (unit.startsWith("d")) return Math.round(value * 86400);
  if (unit.startsWith("h")) return Math.round(value * 3600);
  if (unit.startsWith("m")) return Math.round(value * 60);
  if (unit.startsWith("s")) return Math.round(value);

  return null;
}

function formatHMS(totalSeconds) {
  if (totalSeconds == null) return "";
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = n => String(n).padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

// ---------- ISSUE EXTRACTION + STATUS MAPPING ----------
function extractIssue(stateShort, stateLong, rawTitle) {
  const s = (stateShort || "").toUpperCase().trim();
  const text = ((stateLong || "") + " " + (rawTitle || "")).toUpperCase();
  if (!s) return null;

  // runtime uses '->'
  const m = text.match(new RegExp(`${s}\\s*->\\s*([^->]+)`, "i"));
  if (m && m[1]) return m[1].trim();

  const known = [
    "CONTACT ISSUE", "YIELD ISSUE", "RKGU FAIL",
    "QA TEST", "MISMATCH RESCREEN", "RESCREEN",
    "NO INVENTORY", "PLANNED IDLE", "INACTIVE",
    "PRODUCT EVAL", "INCOMPLETE RESOURCES",
    "QA FAIL", "STANDBY/IDLE", "LOT COMPLETION",
    "QUALIFICATION FAIL DFL", "HW CHECKER PROBLEM", "SYSTEM PROBLEM"
  ];
  for (const k of known) if (text.includes(k)) return k;
  return null;
}

function productionStatusFromDb(stateShort, stateLong, rawTitle) {
  const s = (stateShort || "").toUpperCase().trim();
  const issue = extractIssue(s, stateLong, rawTitle);

  let result;

  if (s === "UMAINT") result = { label: issue || "UMAINT", css: "ps-red" };
  else if (s === "SETUP") result = { label: issue || "SETUP", css: "ps-pink" };
  else if (s === "PRODN") result = { label: issue || "PRODN", css: "ps-green" };
  else if (s === "ENGG") result = { label: issue || "ENGG", css: "ps-blue" };
  else if (s === "LOT") result = { label: issue || "LOT COMPLETION", css: "ps-violet" };
  else if (s === "PMCAL") result = { label: issue || "TESTER PM CAL", css: "ps-orange" };
  else if (s === "SHUTDOWN" || s === "NO") {
    const label = (s === "NO") ? (issue || "NO PRODUCT") : "SHUTDOWN";
    result = { label, css: "ps-gray" };
  } else if (s === "IDLE") result = { label: issue || "IDLE", css: "ps-yellow" };
  else result = { label: issue || s || "", css: "" };

  const PILL_ALLOWED_STATES = new Set(["UMAINT", "SETUP"]);
  if (!PILL_ALLOWED_STATES.has(s)) return result;

  const phase = getPhaseForState(s, rawTitle);

  if (phase === "WAITING") {
    const durSecs = extractDurationSeconds(s, stateLong, rawTitle);
    const hms = formatHMS(durSecs);
    result.pillText = hms ? `WAITING ${hms}` : "WAITING";
    result.pillCss = "phase-pill pill-waiting";
    return result;
  }
  // } else if (phase === "ATTENDED") {
  //   result.pillText = "ATTENDED";
  //   result.pillCss = "phase-pill pill-attended";
  // }
if (phase === "ATTENDED") {
    result.pillText = "ATTENDED";
    result.pillCss = "phase-pill pill-attended";
  }
  return result;
}
function collectIssueAlerts(tableEl) {
  if (!tableEl) return [];
  const rows = Array.from(tableEl.querySelectorAll("tbody tr"));
  const alerts = {
  YIELD: [],
  CONTACT: [],
  RKGU: [],
  SYSTEM: [],
  QUALIFICATION: [],
  HW_CHECKER: [],
  QA: [],
};
for (const tr of rows) {
  const tester =(tr.cells?.[0]?.textContent || "").trim();
  if(!tester) continue;
  const prodColIndex = Number(tableEl.dataset.prodCol ?? 2);
  const cell = tr.cells?.[prodColIndex];
  if (!cell) continue;
  const text =(cell.textContent || "").toUpperCase();

  if (text.includes("YIELD ISSUE")) alerts.YIELD.push(tester);
  if (text.includes("CONTACT ISSUE")) alerts.CONTACT.push(tester);
  if (text.includes("RKGU FAIL")) alerts.RKGU.push(tester);
  if (text.includes("SYSTEM ISSUE")) alerts.SYSTEM.push(tester);
  if (text.includes("QUALIFICATION FAILURE")) alerts.QUALIFICATION.push(tester);
  if (text.includes("HW CHECKER ISSUE")) alerts.HW_CHECKER.push(tester);
  if (text.includes("QA FAILURE")) alerts.QA.push(tester);
  if (text.includes("SYSTEM PROBLEM")) alerts.SYSTEM.push(tester);
  
}

const result = [];
if (alerts.YIELD.length) result.push({key:"YIELD", list: alerts.YIELD, type:"blue", label:"YIELD ISSUE"});
if (alerts.CONTACT.length) result.push({key:"CONTACT", list: alerts.CONTACT, type:"red", label:"CONTACT ISSUE"});
if (alerts.RKGU.length) result.push({key:"RKGU", list: alerts.RKGU, type:"pink", label:"RKGU FAIL"});
if (alerts.SYSTEM.length) result.push({key:"SYSTEM", list: alerts.SYSTEM, type:"yellow", label:"SYSTEM ISSUE"});
if (alerts.QUALIFICATION.length) result.push({key:"QUALIFICATION", list: alerts.QUALIFICATION, type:"pink", label:"QUALIFICATION FAILURE"});
if (alerts.HW_CHECKER.length) result.push({key:"HW_CHECKER", list: alerts.HW_CHECKER, type:"pink", label:"HW CHECKER ISSUE"});
if (alerts.QA.length) result.push({key:"QA", list: alerts.QA, type:"red", label:"QA FAILURE"});
return result;
}

function showViewAlertsOncePerChange(viewName, tableEl, scrapeTs) {
  // scrapeTs = latest checked_at you already fetched for Last Sync (or pass null)
  const alerts = collectIssueAlerts(tableEl);

  // Build a signature so we only toast when content changes
  const signature = JSON.stringify({
    scrapeTs: scrapeTs || "",
    alerts: alerts.map(a => ({ label: a.label, count: a.list.length }))
  });

  if (lastViewToastKey.get(viewName) === signature) return;
  lastViewToastKey.set(viewName, signature);

  // Show toasts for this view
  for (const a of alerts) {
    showToast({
      type: a.type,
      title: `[${viewName}] ${a.label}: ${a.list.length}`,
      message: a.list.slice(0, 6).join(", ") + (a.list.length > 6 ? " ..." : ""),
    });
  }
}
// ---------- RENDER PRODUCTION STATUS ----------
async function renderProductionStatusFromStatusphere(tableEl) {
  if (!tableEl) return;

  const rows = Array.from(tableEl.querySelectorAll("tbody tr"));
  const ids = rows.map(tr => normalizeIdent(tr.cells?.[0]?.textContent)).filter(Boolean);
  if (!ids.length) return;

  const { data, error } = await supabase
    .from("statusphere_equipment")
    .select("equipment_id, state_short, state_long, raw_title, checked_at, href")
    .in("equipment_id", ids);

  if (error) {
    console.error("Statusphere fetch error:", error.message);
    return;
  }

  const map = new Map((data || []).map(r => [normalizeIdent(r.equipment_id), r]));
  const prodColIndex = Number(tableEl.dataset.prodCol ?? 2);

  for (const tr of rows) {
    const id = normalizeIdent(tr.cells?.[0]?.textContent);
    const cell = tr.cells?.[prodColIndex];
    if (!cell) continue;

    const r = map.get(id);
    if (!r) continue;

    const out = productionStatusFromDb(r.state_short, r.state_long, r.raw_title);
    
      // if ((r.state_short || "").toUpperCase() === "PRODN") {
      //   tr.hidden = true;
      //   continue;
      // }
      // tr.hidden = false;
      // console.log(`Row for ${id}: state=${r.state_short}, issue=${out.label}, css=${out.css}`);
    
  
    cell.textContent = "";
    cell.classList.remove("ps-red","ps-green","ps-pink","ps-gray","ps-blue","ps-yellow","ps-violet","ps-orange");

    const url = buildStatusphereUrlFromRow(r.href, id);

    if (url) {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = out.label;
      a.classList.add("prod-link");
      cell.appendChild(a);
    } else {
      const span = document.createElement("span");
      span.textContent = out.label;
      cell.appendChild(span);
    }

    if (out.pillText) {
      const pill = document.createElement("span");
      pill.textContent = out.pillText;
      pill.className = out.pillCss;
      cell.appendChild(pill);
    }

    if (out.css) cell.classList.add(out.css);

    cell.title = `State: ${r.state_short}\n${r.state_long || ""}\nUpdated: ${r.checked_at || ""}`;
  }
}

// ---------- RENDER PRODUCTION STATUS IF NO PM/CAL ROWS----------
async function renderProductionStatusFromStatusphereNonPMCAL(tableEl) {
  if (!tableEl) return;

  const rows = Array.from(tableEl.querySelectorAll("tbody tr"));
  const ids = rows.map(tr => normalizeIdent(tr.cells?.[0]?.textContent)).filter(Boolean);
  if (!ids.length) return;

  const { data, error } = await supabase
    .from("statusphere_equipment")
    .select("equipment_id, state_short, state_long, raw_title, checked_at, href")
    .in("equipment_id", ids);

  if (error) {
    console.error("Statusphere fetch error:", error.message);
    return;
  }

  const map = new Map((data || []).map(r => [normalizeIdent(r.equipment_id), r]));
  const prodColIndex = Number(tableEl.dataset.prodCol ?? 2);

  for (const tr of rows) {
    const id = normalizeIdent(tr.cells?.[0]?.textContent);
    const cell = tr.cells?.[prodColIndex];
    if (!cell) continue;

    const r = map.get(id);
    if (!r) continue;

    const out = productionStatusFromDb(r.state_short, r.state_long, r.raw_title);
    const HIDE_STATES = new Set(["PRODN", 
      "LOT",
      "SHUTDOWN",
      "NO",
      "ENGG",
      "IDLE"
    ]);
    const state = (r.state_short || "").toUpperCase();
    if (HIDE_STATES.has(state)) {
      tr.hidden = true;
      continue;
    }
    tr.hidden = false;
      //  if ((r.state_short || "").toUpperCase() === "PRODN") {
      //    tr.hidden = true;
      //    continue;
      //  }
      //  tr.hidden = false;
       console.log(`Row for ${id}: state=${r.state_short}, issue=${out.label}, css=${out.css}`);
    
  
    cell.textContent = "";
    cell.classList.remove("ps-red","ps-green","ps-pink","ps-gray","ps-blue","ps-yellow","ps-violet","ps-orange");

    const url = buildStatusphereUrlFromRow(r.href, id);

    if (url) {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = out.label;
      a.classList.add("prod-link");
      cell.appendChild(a);
    } else {
      const span = document.createElement("span");
      span.textContent = out.label;
      cell.appendChild(span);
    }

    if (out.pillText) {
      const pill = document.createElement("span");
      pill.textContent = out.pillText;
      pill.className = out.pillCss;
      cell.appendChild(pill);
    }

    if (out.css) cell.classList.add(out.css);

    cell.title = `State: ${r.state_short}\n${r.state_long || ""}\nUpdated: ${r.checked_at || ""}`;
  }
}

//-----------GRID VIEW TOGGLE----------

const VIEW_KEY = "tester_monitoring_view";
let currentView = localStorage.getItem(VIEW_KEY) || "ACT";

function getCurrentView() { return currentView; }

function setCurrentView(view) {
  currentView = view;
  localStorage.setItem(VIEW_KEY, view);

  document.querySelectorAll(".view-tile").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
}

// ✅ define this near the top, before renderViewTiles()
const VIEWS = [
  { key: "ACT",    desc: "Advantest / Credence / Teradyne" },
  { key: "UFLEX",  desc: "Microflex / Terflex / IFLEX" },
  { key: "EAGLE",  desc: "Eagle" },
  { key: "SPEA",   desc: "DOT400" },
  { key: "LTXMX",  desc: "LTXMX" },
  { key: "MAV",    desc: "MAV / TERMAG" },
  { key: "TMT",    desc: "ASL1K / ASL4K" },
  { key: "LEGACY", desc: "STS50 / KTS / MPS / NOISE / SC212" },
  { key: "LTX",    desc: "LTX" },
];
function renderViewTiles() {
  const wrap = document.getElementById("viewTiles");
  if (!wrap) return;
  wrap.innerHTML = "";

  for (const v of VIEWS) {
    const btn = document.createElement("button");
    btn.type = "button";                // ✅ important
    btn.className = "view-tile";
    btn.dataset.view = v.key;
    btn.textContent = v.key;

    if (v.desc) btn.title = v.desc;

    btn.addEventListener("click", () => {
      setCurrentView(v.key);
      setView(v.key);
      refreshData();
    });

    wrap.appendChild(btn);
  }

  // highlight stored view on load
  document.querySelectorAll(".view-tile").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === currentView);
  });
}

// ---------- VIEW + REFRESH ----------
function setView(view) {
  const act = document.getElementById("sectionACT");
  const uflex = document.getElementById("sectionUFLEX");
  const eagle = document.getElementById("sectionEAGLE");
  const mav = document.getElementById("sectionMAV");
  const ltx = document.getElementById("sectionLTX");
  const tmt = document.getElementById("sectionTMT");
  const legacy = document.getElementById("sectionLEGACY");
  const spea = document.getElementById("sectionSPEA");
  const ltxmx = document.getElementById("sectionLTXMX");

  if (act) act.style.display = (view === "ACT") ? "block" : "none";
  if (uflex) uflex.style.display = (view === "UFLEX") ? "block" : "none";
  if (eagle) eagle.style.display = (view === "EAGLE") ? "block" : "none";
  if (mav) mav.style.display = (view === "MAV") ? "block" : "none";
  if (ltx) ltx.style.display = (view === "LTX") ? "block" : "none";
  if (tmt) tmt.style.display = (view === "TMT") ? "block" : "none";
  if (legacy) legacy.style.display = (view === "LEGACY") ? "block" : "none";
  if (spea) spea.style.display = (view === "SPEA") ? "block" : "none";
  if (ltxmx) ltxmx.style.display = (view === "LTXMX") ? "block" : "none";
}

// function getCurrentView() {
//   return document.getElementById("viewSelect")?.value || "ACT";
// }

const LAST_REFRESH_KEY = "calibration_last_refresh_ts";

async function refreshData() {
  try {
    await updateLastSyncIndicator();

    const view = getCurrentView();
    // console.log("VIEW:", view);
    const actTable = document.getElementById("editableTable");
    const uflexTable = document.getElementById("uflexTable");
    const eagleTable = document.getElementById("eagleTable");
    const mavTable = document.getElementById("mavTable");
    const ltxTable = document.getElementById("ltxTable");
    const tmtTable = document.getElementById("tmtTable");
    const legacyTable = document.getElementById("legacyTable");
    const speaTable = document.getElementById("speaTable");
    const ltxmxTable = document.getElementById("ltxmxTable");


    if (view === "UFLEX") {
      await ensureUflexRowsExist();
      //await renderProductionStatusFromStatusphere(uflexTable);
      await renderProductionStatusFromStatusphereNonPMCAL(uflexTable);
        // console.log("UFLEX production status rendered. " + new Date().toLocaleTimeString());
      showViewAlertsOncePerChange("UFLEX", uflexTable, lastSyncShownAt);
      return;
    }

    if (view === "EAGLE") {
      await ensureEagleRowsExist();
      // await renderProductionStatusFromStatusphere(eagleTable);
      await renderProductionStatusFromStatusphereNonPMCAL(eagleTable);
        // console.log("EAGLE production status rendered. " + new Date().toLocaleTimeString());
      showViewAlertsOncePerChange("EAGLE", eagleTable, lastSyncShownAt);
      return;
    }

    if (view === "MAV") {
      await ensureMAVRowsExist();
      // await renderProductionStatusFromStatusphere(mavTable);
      await renderProductionStatusFromStatusphereNonPMCAL(mavTable);
        // console.log("MAV production status rendered. " + new Date().toLocaleTimeString());
      showViewAlertsOncePerChange("MAV", mavTable, lastSyncShownAt);
      return;
    }
    if (view === "TMT") {
      await ensureTMTRowsExist();
      // await renderProductionStatusFromStatusphere(tmtTable);
      await renderProductionStatusFromStatusphereNonPMCAL(tmtTable);
        // console.log("TMT production status rendered. " + new Date().toLocaleTimeString());
      showViewAlertsOncePerChange("TMT", tmtTable, lastSyncShownAt);
      return;
    }
    if (view === "LTX") {
      await ensureLTXRowsExist();
      // await renderProductionStatusFromStatusphere(ltxTable);
      await renderProductionStatusFromStatusphereNonPMCAL(ltxTable);
        // console.log("LTX production status rendered. " + new Date().toLocaleTimeString());
      showViewAlertsOncePerChange("LTX", ltxTable, lastSyncShownAt);
      return;
    } 
    if (view === "LEGACY") {
      await ensureLegacyRowsExist();
      // await renderProductionStatusFromStatusphere(legacyTable);
      await renderProductionStatusFromStatusphereNonPMCAL(legacyTable);
      showViewAlertsOncePerChange("LEGACY", legacyTable, lastSyncShownAt);
      return;
    }
    if (view === "SPEA") {
      await ensureSPEARowsExist();
      // await renderProductionStatusFromStatusphere(speaTable);
      await renderProductionStatusFromStatusphereNonPMCAL(speaTable);
      showViewAlertsOncePerChange("SPEA", speaTable, lastSyncShownAt);
      return;
    }
    if (view === "LTXMX") {
      await ensureLTXMXRowsExist();
      await renderProductionStatusFromStatusphereNonPMCAL(ltxmxTable);
      showViewAlertsOncePerChange("LTXMX", ltxmxTable, lastSyncShownAt);
      return;
    }

    // ACT view
    await renderSchedulesAndHighlights(actTable);

    const rows = Array.from(actTable.querySelectorAll("tbody tr"));
    const ids = rows.map(tr => normalizeIdent(tr.cells?.[0]?.textContent)).filter(Boolean);

    const shouldUpdate = await statusphereHasNewScrape(ids);
    if (shouldUpdate) {
      await renderProductionStatusFromStatusphere(actTable);
      console.log("✅ ACT updated and other tables. " + new Date().toLocaleTimeString());
    }
    showViewAlertsOncePerChange("ACT", actTable, lastSyncShownAt);
    localStorage.setItem(LAST_REFRESH_KEY, String(Date.now()));
  } catch (err) {
    console.error("❌ Refresh failed:", err);
  }
}

// ---------- BOOT ----------
const UI_REFRESH_MS = 60 * 1000;

window.addEventListener("DOMContentLoaded", () => {
  renderViewTiles();
  setView(getCurrentView());
  setCurrentView(getCurrentView());
  refreshData();
  updateLastSyncIndicator();
  alertIssuesAllGroupsIfNewScrape();

  setInterval(refreshData, UI_REFRESH_MS);
  setInterval(updateLastSyncIndicator, 15_000);
  setInterval(alertIssuesAllGroupsIfNewScrape, 30_000);
});
//   const sel = document.getElementById("viewSelect");
//   setView(sel?.value || "ACT");

//   sel?.addEventListener("change", () => {
//     setView(sel.value);
//     refreshData();
//   });

//   refreshData();
//   updateLastSyncIndicator();
//   alertIssuesAllGroupsIfNewScrape();

//   setInterval(refreshData, UI_REFRESH_MS);
//   setInterval(updateLastSyncIndicator, 15_000);
//   setInterval(alertIssuesAllGroupsIfNewScrape, 30_000);
// });
