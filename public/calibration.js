import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";


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
    .order("equipment_id", { ascending: true });

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
    .order("equipment_id", { ascending: true });

  if (error) {
    console.error("UFLEX list load error:", error.message);
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
    const view = getCurrentView();
    const actTable = document.getElementById("editableTable")
    const uflexTable = document.getElementById("uflexTable");
    const eagleTable = document.getElementById("eagleTable");

    
    if(view === "UFLEX") {
      await ensureUflexRowsExist();
      await renderProductionStatusFromStatusphere(uflexTable);
   return;
    }
    // await ensureFamilyRowsExist(); // Ensure all MICROFLEX/TERFLEX testers have rows before rendering
    if(view === "EAGLE") {
      await ensureEagleRowsExist();
      await renderProductionStatusFromStatusphere(eagleTable);
      return;
    }
    await renderSchedulesAndHighlights(actTable);     
    

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
});