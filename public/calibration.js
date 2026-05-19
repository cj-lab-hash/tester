import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

// ===================== CONFIG =====================
const SUPABASE_URL = "https://pnrbdohtrvbrmvabvkxc.supabase.co";
const SUPABASE_KEY = "sb_publishable_YAq1ZIeaJdjx4w0G4DwY3g_tXAZHuVk";

const CRITICAL = 3;
const DUE_SOON_DAYS = 10;
const STATUSPHERE_BASE = "http://statusphere.maxim-ic.com/dp/";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ===================== VIEW (Tiles) =====================
const VIEW_KEY = "tester_monitoring_view";
let currentView = localStorage.getItem(VIEW_KEY) || "ACT";

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
  { key: "SYSTEM", desc: "System Problems only" },
];

// ===================== STATE =====================
let lastStatusphereCheckedAt = null;
let lastSyncShownAt = null;
let lastSyncFetchedAtMs = 0;
let lastAlertScrapeTs = null;
const lastViewToastKey = new Map();

// Prevent overlapping refresh calls
let isRefreshing = false;

// ===================== HELPERS =====================
function normalizeIdent(id) {
  if (!id) return null;
  const s = id.trim().toUpperCase();

  let m = /^SZ(\d{1,3})$/i.exec(s);
  if (m) return `SZ${m[1].padStart(3, "0")}`;

  m = /^(TERCAT|QUARTET|DUO|MICROFLEX|TERFLEX)(\d{1,3})$/i.exec(s);
  if (m) return `${m[1]}${m[2].padStart(3, "0")}`;

  if (s.includes("IFLEX")) return s;
  if (/^EAGLE88[0-9A-Z]+$/.test(s)) return s;
  if (/^MAV(10|20)\d{2}$/i.test(s)) return s;
  if (/^TERMAG20\d{2}$/i.test(s)) return s;
  if (/^LTX\d{3}$/i.test(s)) return s;
  if (/^ASL1K\d{3}$/i.test(s)) return s;
  if (/^ASL4K\d{3}$/i.test(s)) return s;
  if (/^STS50\d{5}$/i.test(s)) return s;
  if (/^(SC212|KTS|MPS|NOISE|TERA360Z|DOT400|LTXMX)\d{3}$/i.test(s)) return s;

  return null;
}

function buildStatusphereUrlFromRow(rowHref, equipmentId) {
  if (rowHref) {
    const cleanHref = rowHref.replace(/&amp;amp;/g, "&");
    if (/^https?:\/\//i.test(cleanHref)) return cleanHref;
    return STATUSPHERE_BASE.replace(/\/+$/, "/") + cleanHref.replace(/^\/+/, "");
  }

  if (equipmentId) {
    return `${STATUSPHERE_BASE}?q=br/equipment-hist/TEST&EQUIPMENT=${encodeURIComponent(equipmentId)}`;
  }

  return null;
}

// ===================== LAST SYNC =====================
async function updateLastSyncIndicator() {
  const el = document.getElementById("lastSync");
  if (!el) return;

  const nowMs = Date.now();
  const shouldFetch = (nowMs - lastSyncFetchedAtMs) > 60_000; // max 1/min

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
    lastSyncShownAt = latest || null;
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

// ===================== ACT: SMART SCRAPE CHECK =====================
async function statusphereHasNewScrape(ids) {
  if (!ids?.length) return false;

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

// ===================== TOASTS =====================
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

  if (text.includes("SYSTEM ISSUE") || text.includes("SYSTEM PROBLEM") || text.includes("SYSTEM FAILURE")) {
    return "SYSTEM ISSUE";
  }

  if (text.includes("QUALIFICATION FAIL DFL")) return "QUALIFICATION FAILURE";
  if (text.includes("HW CHECKER PROBLEM") || text.includes("HW CHECKER")) return "HW CHECKER ISSUE";
  if (text.includes("QA FAIL")) return "QA FAILURE";

  return null;
}

// Alerts for ALL groups based on DB “latest scrape timestamp”
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
      issueName === "RKGU FAIL" ? "pink" :
      issueName.includes("SYSTEM") ? "yellow" :
      "red";

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

// ===================== SCHEDULES (ACT) =====================
function parseScheduleDate(text) {
  if (!text) return null;
  const t = text.trim();

  const native = new Date(t);
  if (!Number.isNaN(native.getTime())) return native;

  const months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  const m = /^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/.exec(t);
  if (!m) return null;

  const month = months[m[1].toLowerCase()];
  if (month == null) return null;

  return new Date(Number(m[3]), month, Number(m[2]));
}

function computeStatus(dateObj) {
  if (!dateObj) return { state: "na", label: "N/A", days: null };

  const today = new Date(); today.setHours(0,0,0,0);
  const due = new Date(dateObj); due.setHours(0,0,0,0);

  const msPerDay = 86400000;
  const diffDays = Math.ceil((due - today) / msPerDay);

  if (diffDays < 0) return { state: "overdue", label: `OVERDUE ${Math.abs(diffDays)}d`, days: diffDays };
  if (diffDays === 0) return { state: "critical", label: "DUE TODAY", days: diffDays };
  if (diffDays <= CRITICAL) return { state: "critical", label: `DUE IN ${diffDays}d`, days: diffDays };
  if (diffDays <= DUE_SOON_DAYS) return { state: "due-soon", label: `DUE IN ${diffDays}d`, days: diffDays };

  return { state: "ok", label: `IN ${diffDays}d`, days: diffDays };
}

function setCellStatus(td, type, scheduleText) {
  td.classList.remove(`${type}-overdue`, `${type}-due-soon`, `${type}-critical`, `${type}-due`);
  td.textContent = scheduleText || "N/A";

  const dateObj = parseScheduleDate(scheduleText);
  const status = computeStatus(dateObj);

  if (status.state === "overdue" || status.state === "due-soon" || status.state === "critical") {
    const pill = document.createElement("span");
    pill.classList.add("status-pill");

    if (status.state === "overdue") {
      td.classList.add(`${type}-overdue`);
      pill.classList.add("status-overdue");
    } else if (status.state === "critical") {
      td.classList.add(`${type}-critical`);
      pill.classList.add("status-critical");
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
  }
}

// ===================== STATUS EXTRACTION (Production) =====================
function getEqptStateSegments(rawTitle) {
  if (!rawTitle) return [];
  const line = rawTitle.split(/\r?\n/).find(l => l.toLowerCase().includes("eqpt state"));
  if (!line) return [];
  const afterColon = line.split(":").slice(1).join(":").trim();
  return afterColon.split("->").map(s => s.trim()).filter(Boolean).map(s => s.toUpperCase());
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
  if (!m) m = text.match(/([\d.]+)\s*(days?|d|hrs?|hours?|h|mins?|minutes?|m|secs?|seconds?|s)\b/i);
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

function extractIssue(stateShort, stateLong, rawTitle) {
  const s = (stateShort || "").toUpperCase().trim();
  const text = ((stateLong || "") + " " + (rawTitle || "")).toUpperCase();
  if (!s) return null;

  const m = text.match(new RegExp(`${s}\\s*->\\s*([^->]+)`, "i"));
  if (m && m[1]) return m[1].trim();

  const known = [
    "CONTACT ISSUE","YIELD ISSUE","RKGU FAIL",
    "QA TEST","MISMATCH RESCREEN","RESCREEN",
    "NO INVENTORY","PLANNED IDLE","INACTIVE",
    "PRODUCT EVAL","INCOMPLETE RESOURCES",
    "QA FAIL","STANDBY/IDLE","LOT COMPLETION",
    "QUALIFICATION FAIL DFL","HW CHECKER PROBLEM","SYSTEM PROBLEM"
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
  } else if (phase === "ATTENDED") {
    result.pillText = "ATTENDED";
    result.pillCss = "phase-pill pill-attended";
  }

  return result;
}

// ===================== VIEW TOAST ALERTS (from table content) =====================
function collectIssueAlerts(tableEl) {
  if (!tableEl) return [];
  const rows = Array.from(tableEl.querySelectorAll("tbody tr"));

  const alerts = { YIELD:[], CONTACT:[], RKGU:[], SYSTEM:[], QUALIFICATION:[], HW_CHECKER:[], QA:[] };

  for (const tr of rows) {
    const tester = (tr.cells?.[0]?.textContent || "").trim();
    if (!tester) continue;

    const prodColIndex = Number(tableEl.dataset.prodCol ?? 2);
    const cell = tr.cells?.[prodColIndex];
    if (!cell) continue;

    const text = (cell.textContent || "").toUpperCase();

    if (text.includes("YIELD ISSUE")) alerts.YIELD.push(tester);
    if (text.includes("CONTACT ISSUE")) alerts.CONTACT.push(tester);
    if (text.includes("RKGU FAIL")) alerts.RKGU.push(tester);
    if (text.includes("SYSTEM ISSUE") || text.includes("SYSTEM PROBLEM")) alerts.SYSTEM.push(tester);
    if (text.includes("QUALIFICATION FAILURE")) alerts.QUALIFICATION.push(tester);
    if (text.includes("HW CHECKER ISSUE")) alerts.HW_CHECKER.push(tester);
    if (text.includes("QA FAILURE")) alerts.QA.push(tester);
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
  const alerts = collectIssueAlerts(tableEl);

  const signature = JSON.stringify({
    scrapeTs: scrapeTs || "",
    alerts: alerts.map(a => ({ label: a.label, count: a.list.length }))
  });

  if (lastViewToastKey.get(viewName) === signature) return;
  lastViewToastKey.set(viewName, signature);

  for (const a of alerts) {
    showToast({
      type: a.type,
      title: `[${viewName}] ${a.label}: ${a.list.length}`,
      message: a.list.slice(0, 6).join(", ") + (a.list.length > 6 ? " ..." : ""),
    });
  }
}
// =====================RENDER SYSTEM PROBLEM ONLY =====================
async function loadSYSTEMLatest(tableEl) {
  const tbody = document.getElementById("systemTbody");
  if (!tableEl || !tbody) return;

  const { data, error } = await supabase
    .from("statusphere_equipment_latest")
    .select("equipment_id, state_short, state_long, raw_title, checked_at, href")
    .or("state_long.ilike.%SYSTEM PROBLEM%,raw_title.ilike.%SYSTEM PROBLEM%")
    .order("checked_at", { ascending: false });

  if (error) {
    console.error("SYSTEM latest fetch error:", error.message);
    return;
  }

  tbody.innerHTML = "";
  const frag = document.createDocumentFragment();

  for (const r of (data || [])) {
    const tr = document.createElement("tr");

    // 1) Tester
    const tdName = document.createElement("td");
    const id = normalizeIdent(r.equipment_id) || r.equipment_id;
    tdName.textContent = id;
    tr.appendChild(tdName);

    // 2) Issue (clickable link)
    const tdIssue = document.createElement("td");
    const url = buildStatusphereUrlFromRow(r.href, id);

    const label = "SYSTEM PROBLEM"; // force label (since we filter for it)
    if (url) {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = label;
      a.classList.add("prod-link");
      tdIssue.appendChild(a);
    } else {
      tdIssue.textContent = label;
    }
    tdIssue.classList.add("ps-yellow"); // optional highlighting
    tr.appendChild(tdIssue);

    // 3) State
    const tdState = document.createElement("td");
    tdState.textContent = r.state_short || "";
    tr.appendChild(tdState);

    // 4) Updated
    const tdUpd = document.createElement("td");
    tdUpd.textContent = r.checked_at ? new Date(r.checked_at).toLocaleString() : "";
    tr.appendChild(tdUpd);

    frag.appendChild(tr);
  }

  tbody.appendChild(frag);
}

// ===================== ACT: Render status by IDs (latest view) =====================
async function renderProductionStatusFromStatusphere(tableEl) {
  if (!tableEl) return;

  const rows = Array.from(tableEl.querySelectorAll("tbody tr"));
  const ids = rows.map(tr => normalizeIdent(tr.cells?.[0]?.textContent)).filter(Boolean);
  if (!ids.length) return;

  const { data, error } = await supabase
    .from("statusphere_equipment_latest")
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

// ===================== NON-ACT: Optimized single-call load + render =====================
function renderProductionStatusFromDataNonPMCAL(tableEl, dataRows) {
  if (!tableEl) return;

  const rows = Array.from(tableEl.querySelectorAll("tbody tr"));
  const prodColIndex = Number(tableEl.dataset.prodCol ?? 2);

  const map = new Map((dataRows || []).map(r => [normalizeIdent(r.equipment_id), r]));

  // Issues-only (your current preference)
  const HIDE_STATES = new Set(["PRODN", "ENGG", "LOT", "SHUTDOWN", "NO", "IDLE"]);

  for (const tr of rows) {
    const id = normalizeIdent(tr.cells?.[0]?.textContent);
    const cell = tr.cells?.[prodColIndex];
    if (!cell) continue;

    const r = map.get(id);
    if (!r) { tr.hidden = true; continue; }

    const state = (r.state_short || "").toUpperCase();
    if (HIDE_STATES.has(state)) { tr.hidden = true; continue; }
    tr.hidden = false;

    const out = productionStatusFromDb(r.state_short, r.state_long, r.raw_title);

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

async function loadLatestByPatterns({ tableEl, tbodyId, patterns, orderBy = "state_long" }) {
  const tbody = document.getElementById(tbodyId);
  if (!tableEl || !tbody) return;

  const orFilter = patterns.map(p => `equipment_id.ilike.${p}`).join(",");

  const { data, error } = await supabase
    .from("statusphere_equipment_latest")
    .select("equipment_id, state_short, state_long, raw_title, checked_at, href")
    .or(orFilter)
    .order(orderBy, { ascending: false });

  if (error) {
    console.error(`Latest fetch error for ${tbodyId}:`, error.message);
    return;
  }

  tbody.innerHTML = "";
  const frag = document.createDocumentFragment();

  for (const r of (data || [])) {
    const tr = document.createElement("tr");

    const tdName = document.createElement("td");
    tdName.textContent = normalizeIdent(r.equipment_id) || r.equipment_id;
    tr.appendChild(tdName);

    const tdProd = document.createElement("td");
    tr.appendChild(tdProd);

    frag.appendChild(tr);
  }
  tbody.appendChild(frag);

  renderProductionStatusFromDataNonPMCAL(tableEl, data);
}

// View-specific loaders (all optimized)
const viewLoaders = {
  UFLEX:  (tableEl) => loadLatestByPatterns({ tableEl, tbodyId:"uflexTbody",  patterns:["MICROFLEX%","TERFLEX%","%IFLEX%"] }),
  EAGLE:  (tableEl) => loadLatestByPatterns({ tableEl, tbodyId:"eagleTbody",  patterns:["EAGLE88%"] }),
  SPEA:   (tableEl) => loadLatestByPatterns({ tableEl, tbodyId:"speaTbody",   patterns:["DOT400%"] }),
  LTXMX:  (tableEl) => loadLatestByPatterns({ tableEl, tbodyId:"ltxmxTbody",  patterns:["LTXMX%"] }),
  MAV:    (tableEl) => loadLatestByPatterns({ tableEl, tbodyId:"mavTbody",    patterns:["MAV10%","MAV20%","TERMAG20%"] }),
  TMT:    (tableEl) => loadLatestByPatterns({ tableEl, tbodyId:"tmtTbody",    patterns:["ASL1K%","ASL4K%"] }),
  LEGACY: (tableEl) => loadLatestByPatterns({ tableEl, tbodyId:"legacyTbody", patterns:["KTS%","STS50%","MPS%","NOISE%","TERA360Z%","SC212%"] }),
  LTX:    (tableEl) => loadLatestByPatterns({ tableEl, tbodyId:"ltxTbody",    patterns:["LTX0%"] }),
  ARK:    (tableEl) => loadLatestByPatterns({ tableEl, tbodyId:"arkTbody",    patterns:["KVDM2%","ASL3K%","RFX%"] }),
  SYSTEM: (tableEl) => loadSYSTEMLatest({ tableEl, tbodyId:"systemTbody", patterns:["SYSTEM%"] }),
};

// ===================== TILES UI =====================
function getCurrentView() { return currentView; }

function setCurrentView(view) {
  currentView = view;
  localStorage.setItem(VIEW_KEY, view);

  document.querySelectorAll(".view-tile").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
}

function renderViewTiles() {
  const wrap = document.getElementById("viewTiles");
  if (!wrap) return;
  wrap.innerHTML = "";

  for (const v of VIEWS) {
    const btn = document.createElement("button");
    btn.type = "button";
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

  setCurrentView(getCurrentView());
}

// ===================== SECTION SWITCH =====================
function setView(view) {
  const ids = [
    ["ACT", "sectionACT"],
    ["UFLEX", "sectionUFLEX"],
    ["EAGLE", "sectionEAGLE"],
    ["MAV", "sectionMAV"],
    ["LTX", "sectionLTX"],
    ["TMT", "sectionTMT"],
    ["LEGACY", "sectionLEGACY"],
    ["SPEA", "sectionSPEA"],
    ["LTXMX", "sectionLTXMX"],
    ["ARK", "sectionARK"],
    ["SYSTEM", "sectionSYSTEM"],
  ];

  for (const [key, elId] of ids) {
    const el = document.getElementById(elId);
    if (el) el.style.display = (view === key) ? "block" : "none";
  }
}

// ===================== REFRESH =====================
async function refreshData() {
  if (isRefreshing) return;
  isRefreshing = true;

  try {
    await updateLastSyncIndicator();

    const view = getCurrentView();

    const actTable    = document.getElementById("editableTable");
    const uflexTable  = document.getElementById("uflexTable");
    const eagleTable  = document.getElementById("eagleTable");
    const mavTable    = document.getElementById("mavTable");
    const ltxTable    = document.getElementById("ltxTable");
    const tmtTable    = document.getElementById("tmtTable");
    const legacyTable = document.getElementById("legacyTable");
    const speaTable   = document.getElementById("speaTable");
    const ltxmxTable  = document.getElementById("ltxmxTable");
    const systemTable = document.getElementById("systemTable");
    const arkTable    = document.getElementById("arkTable");



    // Non-ACT optimized views
    if (view !== "ACT") {
      const tableMap = { UFLEX: uflexTable, EAGLE: eagleTable, MAV: mavTable, LTX: ltxTable, TMT: tmtTable, LEGACY: legacyTable, SPEA: speaTable, LTXMX: ltxmxTable,ARK: arkTable,SYSTEM: systemTable};
      const tableEl = tableMap[view];

      const loader = viewLoaders[view];
      if (loader && tableEl) {
        await loader(tableEl);
        showViewAlertsOncePerChange(view, tableEl, lastSyncShownAt);
      }
      return;
    }

    // ACT view
    await renderSchedulesAndHighlights(actTable);

    const rows = Array.from(actTable.querySelectorAll("tbody tr"));
    const ids = rows.map(tr => normalizeIdent(tr.cells?.[0]?.textContent)).filter(Boolean);

    const shouldUpdate = await statusphereHasNewScrape(ids);
    if (shouldUpdate) {
      await renderProductionStatusFromStatusphere(actTable);
    }

    showViewAlertsOncePerChange("ACT", actTable, lastSyncShownAt);
  } catch (err) {
    console.error("❌ Refresh failed:", err);
  } finally {
    isRefreshing = false;
  }
}

// ===================== BOOT =====================
const UI_REFRESH_MS = 60 * 1000;

window.addEventListener("DOMContentLoaded", () => {
  renderViewTiles();
  setView(getCurrentView());
  refreshData();
  updateLastSyncIndicator();
  alertIssuesAllGroupsIfNewScrape();

  setInterval(refreshData, UI_REFRESH_MS);
  setInterval(updateLastSyncIndicator, 15_000);
  setInterval(alertIssuesAllGroupsIfNewScrape, 30_000);
});