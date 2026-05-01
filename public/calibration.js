import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

// ===================== CONFIG =====================
const SUPABASE_URL = "https://pnrbdohtrvbrmvabvkxc.supabase.co";
const SUPABASE_KEY = "sb_publishable_YAq1ZIeaJdjx4w0G4DwY3g_tXAZHuVk"; // publishable is OK in frontend
const DUE_SOON_DAYS = 10; // change to 30 if you want
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);


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
function normalizeIdent(s) {
  return (s || "").trim().toUpperCase();
}

/**
 * Parse dates like "Oct 15, 2024"
 */
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
async function renderSchedulesAndHighlights() {
  const table = document.querySelector("table");
  if (!table) return;

  const rows = Array.from(table.querySelectorAll("tr")).slice(1);

  // collect SZ rows based on TESTER NAME column (col 0)
  const ids = rows
    .map(tr => normalizeIdent(tr.cells?.[0]?.textContent))
    // .filter(id => id.startsWith("SZ") || id.startsWith("TERCAT"));
    .filter(id => id.startsWith("SZ") || id.startsWith("TERCAT") || id.startsWith("QUARTET")|| id.startsWith("DUO"));

  if (!ids.length) return;

  const plans = await fetchPlansFor(ids);
  const map = new Map(plans.map(p => [normalizeIdent(p.identification), p]));

  for (const tr of rows) {
    tr.classList.remove("row-overdue", "row-due-soon");

    const testerName = normalizeIdent(tr.cells?.[0]?.textContent);
    if (!(testerName.startsWith("SZ") || testerName.startsWith("TERCAT") || testerName.startsWith("QUARTET") || testerName.startsWith("DUO"))) continue;

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
  if (s === "UMAINT") return { label: issue || "UMAINT", css: "ps-red" };

  // SETUP -> PINK (show issue if available)
  if (s === "SETUP") return { label: issue || "SETUP", css: "ps-pink" };

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
async function renderProductionStatusFromStatusphere() {
  console.log("Statusphere render running...")
  const rows = Array.from(document.querySelectorAll("tbody tr"));

  const ids = rows
    .map(tr => normalizeIdent(tr.cells?.[0]?.textContent)) // use your existing normalizeIdent()
    .filter(Boolean);

  if (!ids.length) return;

  const { data, error } = await supabase
    .from("statusphere_equipment")
    .select("equipment_id, state_short, state_long, raw_title, checked_at")
    .in("equipment_id", ids);

  if (error) {
    console.error("Statusphere fetch error:", error.message);
    return;
  }

  const map = new Map((data || []).map(r => [normalizeIdent(r.equipment_id), r]));

  for (const tr of rows) {
    const id = normalizeIdent(tr.cells?.[0]?.textContent);
    const cell = tr.cells?.[2]; // PRODUCTION STATUS column
    if (!cell) continue;

    cell.classList.remove("ps-red", "ps-green", "ps-pink", "ps-gray", "ps-blue");

    const r = map.get(id);
    if (!r) continue; // no DB row -> keep manual value

    const out = productionStatusFromDb(r.state_short, r.state_long, r.raw_title);

    cell.textContent = out.label;
    if (out.css) cell.classList.add(out.css);

    // Tooltip for detail
    cell.title = `State: ${r.state_short}\n${r.state_long || ""}\nUpdated: ${r.checked_at || ""}`;
  }
}



// ===================== SMART REFRESH (OPTION C) =====================
const TWELVE_HOURS = 12 * 60 * 60 * 1000;
const LAST_REFRESH_KEY = "calibration_last_refresh_ts";

function shouldRefreshNow() {
  const last = Number(localStorage.getItem(LAST_REFRESH_KEY) || "0");
  return Date.now() - last >= TWELVE_HOURS;
}

async function refreshData() {
  try {
    // Always refresh schedules (cheap + uses your local mapping)
    await renderSchedulesAndHighlights();            // cal/pm schedule
                     // your /api/data fill (if you have it)
    // await renderProductionStatusFromStatusphere(); 

    // Get the IDs visible in your table
    const rows = Array.from(document.querySelectorAll("tbody tr"));
    const ids = rows
      .map(tr => normalizeIdent(tr.cells?.[0]?.textContent))
      .filter(Boolean);

    // Only re-render production status when statusphere has new scrape
    const shouldUpdateProdStatus = await statusphereHasNewScrape(ids);

    if (shouldUpdateProdStatus) {
      await renderProductionStatusFromStatusphere();
      console.log("✅ Production status updated (new scrape detected)" + new Date().toLocaleTimeString());
    } else {
      console.log("⏸ No new scrape; production status not refreshed.");
    }

    // Keep your 12-hour tracking if you still want it
    localStorage.setItem(LAST_REFRESH_KEY, String(Date.now()));
  } catch (err) {
    console.error("❌ Refresh failed:", err);
  }
}
const UI_REFRESH_MS = 60 * 1000; // 1 minute
window.addEventListener("DOMContentLoaded", () => {
  refreshData();
  setInterval(refreshData, UI_REFRESH_MS)
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && shouldRefreshNow()) {
    refreshData();
  }
});

window.addEventListener("focus", () => {
  if (shouldRefreshNow()) {
    refreshData();
  }
});