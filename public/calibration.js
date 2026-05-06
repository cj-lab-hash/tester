import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
// import { set } from "pm2";


// ===================== CONFIG =====================
const SUPABASE_URL = "https://pnrbdohtrvbrmvabvkxc.supabase.co";
const SUPABASE_KEY = "sb_publishable_YAq1ZIeaJdjx4w0G4DwY3g_tXAZHuVk"; // publishable is OK in frontend
const DUE_SOON_DAYS = 10; // change to 30 if you want
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const STATUSPHERE_BASE = "http://statusphere.maxim-ic.com/dp/";


let lastStatusphereCheckedAt = null;


async function statusphereHasNewScrape(ids) {
  // No ids = nothing to check
  if (!ids || ids.length === 0) return false;

  // Get the newest checked_at among the testers currently shown on the page
  const { data, error } = await supabase
    .from("statusphere_equipment")
    .select("checked_at")
    .in("equipment_id", ids)
    .order("checked_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("Statusphere checked_at check failed:", error.message);
    // If check fails, fall back to updating to avoid stale UI
    return true;
  }

  if (!data || data.length === 0) {
    // No rows in DB yet
    return false;
  }

  const latest = data[0].checked_at;

  // First run: store and render
  if (!lastStatusphereCheckedAt) {
    lastStatusphereCheckedAt = latest;
    return true;
  }

  // If changed, a new scrape happened
  if (latest !== lastStatusphereCheckedAt) {
    lastStatusphereCheckedAt = latest;
    return true;
  }

  return false;
}

// ===================== HELPERS =====================
// Normalize equipment ID for consistent matching (e.g. " sz5 " -> "SZ005")
function normalizeIdent(id) {
  if (!id) return null;
  const s = id.trim().toUpperCase();

  let m = /^SZ(\d{1,3})$/i.exec(s);
  if (m) return `SZ${m[1].padStart(3, "0")}`;
  m = /^(TERCAT|QUARTET|DUO|MICROFLEX|TERFLEX)(\d{1,3})$/i.exec(s);
  if (m) return `${m[1]}${m[2].padStart(3, "0")}`;
  if (s.includes("IFLEX")) return s;
  if (/^EAGLE88[0-9A-Z]+$/.test(s)) return s;
   return null;
}

// Check if the equipment ID belongs to UFLEX group based on known patterns
function isUflexEquipment(rawId = "") {
  const s = rawId.trim().toUpperCase();
  // UFLEX group rules:
  // - MICROFLEX###, TERFLEX###
  // - anything containing IFLEX (01IFLEX, 25IFLEX_SAMPLE, etc.)
  return s.startsWith("MICROFLEX") || s.startsWith("TERFLEX") || s.includes("IFLEX") || s.startsWith("EAGLE88");
}

// Build Statusphere URL from DB row, with fallback to equipment ID if href is missing
function buildStatusphereUrlFromRow(rowHref, equipmentId) {
  // If DB stores href (recommended)
  if (rowHref) {
    const cleanHref = rowHref.replace(/&amp;/g, "&");
    if (/^https?:\/\//i.test(cleanHref)) return cleanHref; // already absolute
    return STATUSPHERE_BASE.replace(/\/+$/, "/") + cleanHref.replace(/^\/+/, "");
  }

  // Fallback: if href is missing, build it from tester ID
  if (equipmentId) {
    return `${STATUSPHERE_BASE}?q=br/equipment-hist/TEST&EQUIPMENT=${encodeURIComponent(equipmentId)}`;
  }

  return null;
}
/**
 * Parse dates like "Oct 15, 2024"
 */
// Returns a Date object or null if invalid
function parseScheduleDate(text) {
  if (!text) return null;

  const t = text.trim();

  // Try native parse first
  const native = new Date(t);
  if (!Number.isNaN(native.getTime())) return native;

  // Fallback manual parse: "Mon DD, YYYY"
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

/**
 * Returns status for a date relative to today (local time)
 */

function computeStatus(dateObj) {
  if (!dateObj) return { state: "na", label: "N/A", days: null };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = new Date(dateObj);
  due.setHours(0, 0, 0, 0);

  const msPerDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.ceil((due - today) / msPerDay);

  if (diffDays < 0) {
    return { state: "overdue", label: `OVERDUE ${Math.abs(diffDays)}d`, days: diffDays };
  }
  if (diffDays <= DUE_SOON_DAYS) {
    return { state: "due-soon", label: `DUE IN ${diffDays}d`, days: diffDays };
  }
  return { state: "ok", label: `IN ${diffDays}d`, days: diffDays };
}

function setCellStatus(td, type, scheduleText) {
  td.classList.remove(`${type}-overdue`, `${type}-due-soon`);
  td.textContent = scheduleText || "N/A";

  const dateObj = parseScheduleDate(scheduleText);
  const status = computeStatus(dateObj);

  // Only show pill when overdue or due-soon
  if (status.state === "overdue" || status.state === "due-soon") {
    const pill = document.createElement("span");
    pill.classList.add("status-pill");

    if (status.state === "overdue") {
      td.classList.add(`${type}-overdue`);
      pill.classList.add("status-overdue");
    } else {
      td.classList.add(`${type}-due-soon`);
      pill.classList.add("status-due-soon");
    }

    pill.textContent = status.label;
    td.appendChild(pill);
  }

  return status.state;
}
//ensure EAGLE testers from DB have a row in the table
async function ensureEagleRowsExist() {
  const tbody = document.getElementById("eagleTbody");
  if (!tbody) return;

  const { data, error } = await supabase
    .from("statusphere_equipment")
    .select("equipment_id")
    .ilike("equipment_id", "EAGLE88%")
    // .order("equipment_id", { ascending: true });
      .order("state_long", { ascending: false });     // sort by state_long to group by status in the table
  if (error) {
    console.error("EAGLE list load error:", error.message);
    return;
  }

  const ids = (data || []).map(r=> normalizeIdent(r.equipment_id)).filter(Boolean);
  
  // rebuild every refresh (simple + avoids syncing problems)
  tbody.innerHTML = "";

  for (const id of ids) {
    const tr = document.createElement("tr");

    // 0 TESTER NAME
    const tdName = document.createElement("td");
    tdName.textContent = id;
    tr.appendChild(tdName);

    // 1 PRODUCTION STATUS (filled by statusphere render)
    const tdProd = document.createElement("td");
    tr.appendChild(tdProd);

    tbody.appendChild(tr);
  }
}


// Ensure all MICROFLEX and TERFLEX testers from DB have a row in the table
async function ensureUflexRowsExist() {
  const tbody = document.getElementById("uflexTbody");
  if (!tbody) return;

  // Get MICROFLEX + TERFLEX equipment list from statusphere_equipment
  const { data, error } = await supabase
    .from("statusphere_equipment")
    .select("equipment_id")
    .or("equipment_id.ilike.MICROFLEX%,equipment_id.ilike.TERFLEX%,equipment_id.ilike.%IFLEX%") // also include any IFLEX and EAGLE variants
    // .order("equipment_id", { ascending: true });
    .order("state_long", { ascending: false });     // sort by state_long to group by status in the table

  if (error) {
    console.error("UFLEX list load error:", error.message);f
    return;
  }

  const ids = (data || [])
    .map(r => (r.equipment_id || "").trim().toUpperCase())
    .filter(Boolean);

  // rebuild every refresh (simple + avoids syncing problems)
  tbody.innerHTML = "";

  for (const id of ids) {
    const tr = document.createElement("tr");

    // 0 TESTER NAME
    const tdName = document.createElement("td");
    tdName.textContent = id;
    tr.appendChild(tdName);

    // 1 PRODUCTION STATUS (filled by statusphere render)
    const tdProd = document.createElement("td");
    tr.appendChild(tdProd);

    tbody.appendChild(tr);
  }
}

function getEqpStatesSegments(rawTitle) {
  if (!rawTitle) return [];
  
  const line = rawTitle
  .split(/\r?\n/)
    .find(l => l.toLowerCase().includes("eqpt state"));

  if (!line) return [];

  // Example line formats:
  // "Eqpt State.: UMAINT->HANDLER PROBLEM->SINGULATOR JAM->"
  // "Eqpt State.: SETUP->RKGU FAIL->"
  const afterColon = line.split(":").slice(1).join(":").trim();

  // Split chain by "->" and remove empty parts
  return afterColon
    .split("->")
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.toUpperCase());
}

function getSetupPhase(rawTitle) {
  const seg = getEqpStatesSegments(rawTitle);

  // Find "SETUP" in the chain
  const idx = seg.indexOf("SETUP");
  if (idx === -1) return null;

  const detail1 = seg[idx + 1] || null;
  const detail2 = seg[idx + 2] || null;

  // no 2nd string (detail2) => WAITING
  // detail2 exists => STARTED
  return detail2 ? "ATTENDED" : "WAITING";
}
function getUmaintPhase(rawTitle) {
  const seg = getEqpStatesSegments(rawTitle);

  // Find "UMAINT" in the chain
  const idx = seg.indexOf("UMAINT");
  if (idx === -1) return null; 

  const detail1 = seg[idx + 1] || null;
  const detail2 = seg[idx + 2] || null;

  return detail2 ? "ATTENDED" : "WAITING"; // e.g. "CONTACT ISSUE", "YIELD ISSUE", "RKGU FAIL", etc.
}

let lastSyncShownAt = null;
let lastSyncFetchedAtMs = 0;

// Fetch the latest checked_at from statusphere_equipment and update the "Last Sync" indicator in the header
async function updateLastSyncIndicator() {
  const el = document.getElementById("lastSync");
  if (!el) return;

  const nowMs = Date.now();
  const shouldFetch = (nowMs - lastSyncFetchedAtMs > 60 * 1000);
  
  if (shouldFetch) {
    lastSyncFetchedAtMs = nowMs;
  
  // fetch at most once per minute
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
  // ✅ Only skip update if it hasn't changed

  const dt = new Date(lastSyncShownAt);
  const pretty = dt.toLocaleString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  const ageMin = Math.floor((Date.now() - dt.getTime()) / (60 * 1000));
  el.textContent = `Last Sync: ${pretty} (${ageMin} min ago)`;
}

// Simple toast notification helper 
function showToast({ type = "gray", title, message, onClick }) {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  // remove existing toast of same title (optional)
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

  if (onClick) {
    toast.addEventListener("click", onClick);
  }

  container.appendChild(toast);

  // auto-remove after 10 seconds
  setTimeout(() => toast.remove(), 10000);
}
// Scan the table for known issue keywords and collect testers with issues for summary alerts
function collectIssueAlerts(tableEl) {
  if (!tableEl) return [];

  const rows = Array.from(tableEl.querySelectorAll("tbody tr"));

  const alerts = {
    YIELD: [],
    CONTACT: [],
    RKGU: [],
    SYSTEM: [],
    QUALIFICATION: [],
    CHECKER: [],
    QA: [],
  };

  for (const tr of rows) {
    const tester = (tr.cells?.[0]?.textContent || "").trim();
    if (!tester) continue;

    // production status column index comes from data-prod-col
    const prodColIndex = Number(tableEl.dataset.prodCol ?? 2);
    const cell = tr.cells?.[prodColIndex];
    if (!cell) continue;

    const text = (cell.textContent || "").toUpperCase();

    if (text.includes("YIELD ISSUE")) alerts.YIELD.push(tester);
    if (text.includes("CONTACT ISSUE")) alerts.CONTACT.push(tester);
    if (text.includes("RKGU FAIL")) alerts.RKGU.push(tester);
    if (text.includes("QUALIFICATION ISSUE") || text.includes("QUALIFICATION FAIL")) alerts.QUALIFICATION.push(tester);
    if (text.includes("HW CHECKER PROBLEM") || text.includes("HW CHECKER")) alerts.CHECKER.push(tester);
    if (text.includes("QA FAIL")) alerts.QA.push(tester);
    // SYSTEM ISSUE (support multiple words)
    if (text.includes("SYSTEM ISSUE") || text.includes("SYSTEM PROBLEM") || text.includes("SYSTEM")) {
      // Avoid double-counting "SYSTEM" if it appears in something else you don't want
      alerts.SYSTEM.push(tester);
    }
  }

  const result = [];
  if (alerts.CONTACT.length) result.push({ key:"CONTACT", list: alerts.CONTACT, type:"red", label:"CONTACT ISSUE" });
  if (alerts.YIELD.length)   result.push({ key:"YIELD",   list: alerts.YIELD,   type:"red", label:"YIELD ISSUE" });
  if (alerts.RKGU.length)    result.push({ key:"RKGU",    list: alerts.RKGU,    type:"pink", label:"RKGU FAIL" });
  if (alerts.SYSTEM.length)  result.push({ key:"SYSTEM",  list: alerts.SYSTEM,  type:"yellow", label:"SYSTEM ISSUE" });
  if (alerts.QUALIFICATION.length) result.push({ key:"QUALIFICATION", list: alerts.QUALIFICATION, type:"pink", label:"QUALIFICATION FAILURE" });
  if (alerts.CHECKER.length) result.push({ key:"CHECKER", list: alerts.CHECKER, type:"red", label:"HW CHECKER ISSUE" });
  if (alerts.QA.length) result.push({ key:"QA", list: alerts.QA, type:"red", label:"QA FAILURE" });
  return result;
}
// let lastAlertScrapeTs = null;

// async function alertIssuesAllGroupsIfNewScrape() {
//   // 1) Get latest scrape timestamp
//   const { data: d1, error: e1 } = await supabase
//     .from("statusphere_equipment")
//     .select("checked_at")
//     .order("checked_at", { ascending: false })
//     .limit(1);

//   if (e1) {
//     console.error("Alert check failed:", e1.message);
//     return;
//   }

//   const latestTs = d1?.[0]?.checked_at;
//   if (!latestTs) return;

//   // Only alert if NEW scrape happened
//   if (latestTs === lastAlertScrapeTs) return;
//   lastAlertScrapeTs = latestTs;

//   // 2) Fetch ALL rows from the latest scrape
//   const { data: rows, error: e2 } = await supabase
//     .from("statusphere_equipment")
//     .select("equipment_id, state_long, raw_title, href")
//     .eq("checked_at", latestTs);

//   if (e2) {
//     console.error("Alert rows fetch failed:", e2.message);
//     return;
//   }

//   // 3) Build issue buckets
//   const buckets = {
//     "CONTACT ISSUE": [],
//     "YIELD ISSUE": [],
//     "RKGU FAIL": [],
//     "SYSTEM ISSUE": [],
//     "QUALIFICATION FAIL": [],
//     "HW CHECKER PROBLEM": [],
//     "QA FAIL": [],
//   };

//   for (const r of (rows || [])) {
//     const issue = classifyIssue(r.state_long, r.raw_title);
//     if (!issue) continue;

//     buckets[issue].push({
//       id: r.equipment_id,
//       href: r.href,
//     });
//   }

//   // 4) Show toast per issue type
//   for (const [issueName, list] of Object.entries(buckets)) {
//     if (!list.length) continue;

//     const type = (issueName === "RKGU FAIL") ? "pink" : "red";
//     const preview = list.slice(0, 6).map(x => x.id).join(", ") + (list.length > 6 ? " ..." : "");

//     showToast({
//       type,
//       title: `${issueName}: ${list.length}`,
//       message: preview,
//       onClick: () => {
//         // Open first tester in Statusphere (optional)
//         const first = list[0];
//         const url = buildStatusphereUrlFromRow(first.href, first.id);
//         if (url) window.open(url, "_blank", "noopener");
//       }
//     });
//   }
// }
//===================END OF HELPERS ====================
// ===================== DATA FETCH =====================
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

// ===================== RENDER =====================
async function renderSchedulesAndHighlights(tableEl) {
  if (!tableEl) return;
  // const table = document.querySelector("tbody tr");
  // if (!table) return;

  // const rows = Array.from(tableEl.querySelectorAll("tbody tr")).slice(1);
  const rows = Array.from(tableEl.querySelectorAll("tbody tr"));

  // collect SZ rows based on TESTER NAME column (col 0)
  const ids = rows
    .map(tr => normalizeIdent(tr.cells?.[0]?.textContent))
    // .filter(id => id.startsWith("SZ") || id.startsWith("TERCAT") || id.startsWith("QUARTET")|| id.startsWith("DUO")|| id.startsWith("MICROFLEX")|| id.startsWith("TERFLEX"));
    .filter(Boolean);

  if (!ids.length) return;

  const plans = await fetchPlansFor(ids);
  const map = new Map(plans.map(p => [normalizeIdent(p.identification), p]));

  for (const tr of rows) {
    tr.classList.remove("row-overdue", "row-due-soon");

    const testerName = normalizeIdent(tr.cells?.[0]?.textContent);
    if (!(testerName.startsWith("SZ") || testerName.startsWith("TERCAT") || testerName.startsWith("QUARTET") || testerName.startsWith("DUO") || testerName.startsWith("MICROFLEX") || testerName.startsWith("TERFLEX") || testerName.startsWith("IFLEX") || testerName.startsWith("EAGLE"))) continue;
  
    const plan = map.get(testerName);

    const calTd = tr.cells[4]; // CAL SCHEDULE col
    const pmTd  = tr.cells[5]; // PM SCHEDULE col

    const calState = setCellStatus(calTd, "cal", plan?.cal_schedule ?? null);
    const pmState  = setCellStatus(pmTd, "pm",  plan?.pm_schedule ?? null);

    if (calState === "overdue" || pmState === "overdue") {
      tr.classList.add("row-overdue");
    } else if (calState === "due-soon" || pmState === "due-soon") {
      tr.classList.add("row-due-soon");
    }
  }
}

// Try to extract issue type from state_long or raw_title based on known patterns
function extractIssue(stateShort, stateLong, rawTitle) {
  const s = (stateShort || "").toUpperCase().trim();
  const text = ((stateLong || "") + " " + (rawTitle || "")).toUpperCase();

  if (!s) return null;

  // Try to capture the segment immediately after "STATE->"
  // Works for: UMAINT->CONTACT ISSUE->..., SETUP->RKGU FAIL->...
  const m = text.match(new RegExp(`${s}\\s*->\\s*([^->]+)`, "i"));
  if (m && m[1]) return m[1].trim();

  // Fallback keyword detection (add more anytime)
  const known = [
    "CONTACT ISSUE",
    "YIELD ISSUE",
    "RKGU FAIL",
    "QA TEST",
    "MISMATCH RESCREEN",
    "RESCREEN",
    "NO INVENTORY",
    "PLANNED IDLE",
    "INACTIVE",
    "PRODUCT EVAL",
    "INCOMPLETE RESOURCES",
    "QA FAIL",
    "STANDBY/IDLE",
    "LOT COMPLETION",

  ];

  for (const k of known) {
    if (text.includes(k)) return k;
  }

  return null;
}



// Convert DB state to label + CSS class
function productionStatusFromDb(stateShort, stateLong, rawTitle) {
  const s = (stateShort || "").toUpperCase().trim();
  const issue = extractIssue(s, stateLong, rawTitle);

  // UMAINT -> RED (show issue if available)
  // if (s === "UMAINT") return { label: issue || "UMAINT", css: "ps-red" };
  if (s === "UMAINT") {
    const phase = getUmaintPhase(rawTitle);
    const labelBase = issue || "UMAINT";
    const label = phase ? `${labelBase} (${phase})` : labelBase;
    return {
       label: issue || "UMAINT",
       css: "ps-red",
       pillText:phase,
       pillCss: phase === "ATTENDED" ? "phase-pill pill-attended" : "phase-pill pill-waiting"
      };
  }
  // SETUP -> PINK (show issue if available)
  if (s === "SETUP") {
    const phase = getSetupPhase(rawTitle);
    const labelBase = issue || "SETUP";
    const label = phase ? `${labelBase} (${phase})` : labelBase;
    return {
       label: issue || "SETUP",
       css: "ps-pink",
       pillText:phase,
       pillCss: phase === "ATTENDED" ? "phase-pill pill-attended" : "phase-pill pill-waiting"
      };
  }

  // PRODN -> GREEN (show subtype if available, e.g. QA TEST, MISMATCH RESCREEN)
  if (s === "PRODN") return { label: issue || "PRODN", css: "ps-green" };
  
  // ENGG -> BLUE
  if (s === "ENGG") return { label: issue || "ENGG", css: "ps-blue" };
  // LOT COMP -> VIOLET

  if (s === "LOT") return { label: issue || "LOT COMPLETION", css: "ps-violet" };

  // SHUTDOWN/NO -> GRAY
  if (s === "SHUTDOWN" || s === "NO") {
    const label = (s === "NO") ? (issue || "NO PRODUCT") : "SHUTDOWN";
    return { label, css: "ps-gray" };
  }
  if (s=== "IDLE") return { label: issue || "IDLE", css: "ps-yellow" };
  // Fallback: show issue or stateShort
  return { label: issue || s || "", css: "" };
}


// Fetch from statusphere_equipment and render into column 2 (Production Status)
async function renderProductionStatusFromStatusphere(tableEl) {
  console.log("Statusphere render running...");
  if (!tableEl) return;

  const rows = Array.from(tableEl.querySelectorAll("tbody tr"));
  const ids = rows
    .map(tr => normalizeIdent(tr.cells?.[0]?.textContent))
    .filter(Boolean);

  if (!ids.length) return;

  const { data, error } = await supabase
    .from("statusphere_equipment")
    .select("equipment_id, state_short, state_long, raw_title, checked_at, href") // ✅ include href
    .in("equipment_id", ids);

  if (error) {
    console.error("Statusphere fetch error:", error.message);
    return;
  }

  const map = new Map((data || []).map(r => [normalizeIdent(r.equipment_id), r]));

  const prodColIndex = Number(tableEl.dataset.prodCol ?? 2);
 
  for (const tr of rows) {
    const id = normalizeIdent(tr.cells?.[0]?.textContent);
    const cell = tr.cells?.[prodColIndex]; // PRODUCTION STATUS column
    if (!cell) continue;

    const r = map.get(id);
    if (!r) continue; // no DB row -> keep manual value

    const out = productionStatusFromDb(r.state_short, r.state_long, r.raw_title);

    // reset cell
    cell.textContent = "";
    cell.classList.remove("ps-red", "ps-green", "ps-pink", "ps-gray", "ps-blue", "ps-yellow", "ps-violet");

    // Build link URL
    const url = buildStatusphereUrlFromRow(r.href, id);

    if (url) {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = out.label;
      a.classList.add("prod-link"); // link inherits the TD color
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
    // Apply color to TD
       if (out.css) cell.classList.add(out.css);

          // Tooltip
          cell.title = `State: ${r.state_short}\n${r.state_long || ""}\nUpdated: ${r.checked_at || ""}`;
    }
  }


  

// Compute days until the date shown in the cell
function daysUntil(dateText) {
  // Works best if your dateText is consistent like "May 09, 2026" or "Jul 12, 2026"
  const d = new Date(dateText);
  if (Number.isNaN(d.getTime())) return null;

  // Use PH timezone "today" boundary roughly by using local midnight.
  // If your server is in UTC but this is browser-rendered, local is PH anyway.
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const diffMs = d - startOfToday;
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

// Ensure all MICROFLEX and TERFLEX testers from DB have a row in the table
// async function ensureFamilyRowsExist() {
//   const tbody = document.querySelector("tbody");
//   if (!tbody) return;

//   // Fetch list from Supabase (only IDs)
//   const { data, error } = await supabase
//     .from("statusphere_equipment")
//     .select("equipment_id")
//     .or("equipment_id.ilike.MICROFLEX%,equipment_id.ilike.TERFLEX%")
//     .order("equipment_id", { ascending: true });

//   if (error) {
//     console.error("Failed to load MICROFLEX/TERFLEX list:", error.message);
//     return;
//   }

//   const ids = (data || []).map(r => (r.equipment_id || "").toUpperCase()).filter(Boolean);
//   if (!ids.length) return;

//   // Existing rows in your HTML table
//   const existing = new Set(
//     Array.from(tbody.querySelectorAll("tr"))
//       .map(tr => (tr.cells?.[0]?.textContent || "").trim().toUpperCase())
//       .filter(Boolean)
//   );

//   // Add missing rows
//   for (const id of ids) {
//     if (existing.has(id)) continue;

//     const tr = document.createElement("tr");

//     // Column 0: TESTER NAME
//     const tdName = document.createElement("td");
//     tdName.textContent = id;
//     tr.appendChild(tdName);

//     // Column 1: TESTER ID (unknown for MICROFLEX unless you have mapping)
//     const tdId = document.createElement("td");
//     tdId.textContent = ""; 
//     tr.appendChild(tdId);

//     // Column 2: PRODUCTION STATUS (will be filled by Statusphere renderer)
//     const tdProd = document.createElement("td");
//     tr.appendChild(tdProd);

//     // Column 3: DOCKING MECHANISM (manual)
//     const tdDock = document.createElement("td");
//     tr.appendChild(tdDock);

//     // Column 4: CAL SCHEDULE (filled from calibration_plans if exists)
//     const tdCal = document.createElement("td");
//     tdCal.classList.add("cal-status");
//     tr.appendChild(tdCal);

//     // Column 5: PM SCHEDULE
//     const tdPm = document.createElement("td");
//     tdPm.classList.add("pm-status");
//     tr.appendChild(tdPm);

//     tbody.appendChild(tr);
//     existing.add(id);
//   }
// }




// ===================== SMART REFRESH (OPTION C) =====================
const TWELVE_HOURS = 12 * 60 * 60 * 1000;
const LAST_REFRESH_KEY = "calibration_last_refresh_ts";

function shouldRefreshNow() {
  const last = Number(localStorage.getItem(LAST_REFRESH_KEY) || "0");
  return Date.now() - last >= TWELVE_HOURS;
}

async function refreshData() {
  try {
     await updateLastSyncIndicator();
    
    
    const view = getCurrentView();
    const actTable = document.getElementById("editableTable")
    const uflexTable = document.getElementById("uflexTable");
    const eagleTable = document.getElementById("eagleTable");

    
    if(view === "UFLEX") {
      await ensureUflexRowsExist();
      await renderProductionStatusFromStatusphere(uflexTable);
      
const alerts = collectIssueAlerts(uflexTable);
for (const a of alerts) {
  showToast({
    type: a.type,
    title: `${a.label}: ${a.list.length}`,
    message: a.list.slice(0, 6).join(", ") + (a.list.length > 6 ? " ..." : ""),
    onClick: () => {
      // Optional: jump to ACT view automatically
      // document.getElementById("viewSelect").value = "ACT";
      // setView("ACT");
      // refreshData();
      // Or open the first tester’s statusphere link:
      // (You can implement custom behavior here)
    }
  });
}

      
   return;
    }
    // await ensureFamilyRowsExist(); // Ensure all MICROFLEX/TERFLEX testers have rows before rendering
    if(view === "EAGLE") {
      await ensureEagleRowsExist();
      await renderProductionStatusFromStatusphere(eagleTable);
      
const alerts = collectIssueAlerts(eagleTable);
for (const a of alerts) {
  showToast({
    type: a.type,
    title: `${a.label}: ${a.list.length}`,
    message: a.list.slice(0, 6).join(", ") + (a.list.length > 6 ? " ..." : ""),
    onClick: () => {
      // Optional: jump to ACT view automatically
      // document.getElementById("viewSelect").value = "ACT";
      // setView("ACT");
      // refreshData();
      // Or open the first tester’s statusphere link:
      // (You can implement custom behavior here)
    }
  });
}

      return;
    }
    await renderSchedulesAndHighlights(actTable);     
const alerts = collectIssueAlerts(actTable);
for (const a of alerts) {
  showToast({
    type: a.type,
    title: `${a.label}: ${a.list.length}`,
    message: a.list.slice(0, 6).join(", ") + (a.list.length > 6 ? " ..." : ""),
    onClick: () => {
      // Optional: jump to ACT view automatically
      // document.getElementById("viewSelect").value = "ACT";
      // setView("ACT");
      // refreshData();
      // Or open the first tester’s statusphere link:
      // (You can implement custom behavior here)
    }
  });
}


    // Get the IDs visible in your table
    const rows = Array.from(actTable.querySelectorAll("tbody tr"));
    const ids = rows
      .map(tr => normalizeIdent(tr.cells?.[0]?.textContent))
      .filter(Boolean);

    // Only re-render production status when statusphere has new scrape
    const shouldUpdateProdStatus = await statusphereHasNewScrape(ids);

    if (shouldUpdateProdStatus) {
      await renderProductionStatusFromStatusphere(actTable);
      console.log("✅ ACT production status updated " + new Date().toLocaleTimeString());
    } else {
      console.log("⏸ No new scrape; production status not refreshed.");
    }
    
    // Keep your 12-hour tracking if you still want it
    localStorage.setItem(LAST_REFRESH_KEY, String(Date.now()));
  } catch (err) {
    console.error("❌ Refresh failed:", err);
  }
}
// ===================== VIEW SWITCHING =====================
function setView(view) {
  const act = document.getElementById("sectionACT");
  const uflex = document.getElementById("sectionUFLEX");
  const eagle = document.getElementById("sectionEAGLE");

  if (act) act.style.display = (view === "ACT") ? "block" : "none";
  if (uflex) uflex.style.display = (view === "UFLEX") ? "block" : "none";
  if (eagle) eagle.style.display = (view === "EAGLE") ? "block" : "none";
}

function getCurrentView() {
  return document.getElementById("viewSelect")?.value || "ACT";
}
 
// Optional: if you want to auto-detect view based on URL hash or something




// const UI_REFRESH_MS = 60 * 1000; // 1 minute
// window.addEventListener("DOMContentLoaded", () => {
//   const sel=document.getElementById("viewSelect");
//   setView(sel?.value || "ACT");

//   sel?.addEventListener("change", () => {
//     setView(sel.value);
//     // Optionally refresh immediately on view change
//     refreshData();
//   });
//   refreshData();
//   setInterval(refreshData, UI_REFRESH_MS)
// });

// document.addEventListener("visibilitychange", () => {
//   if (document.visibilityState === "visible" && shouldRefreshNow()) {
//     refreshData();
//   }
// });

// window.addEventListener("focus", () => {
//   if (shouldRefreshNow()) {
//     refreshData();
//   }
// });

const UI_REFRESH_MS = 60 * 1000;

window.addEventListener("DOMContentLoaded", () => {
  const sel = document.getElementById("viewSelect");
  setView(sel?.value || "ACT");

  sel?.addEventListener("change", () => {
    setView(sel.value);
    refreshData();
  });

  refreshData();
  setInterval(refreshData, UI_REFRESH_MS);
  setInterval(updateLastSyncIndicator, 15_000);
  // alertIssuesAllGroupsIfNewScrape(); // check for issues on load
  // setInterval(alertIssuesAllGroupsIfNewScrape, 60 * 1000); // check for issues every minute
});