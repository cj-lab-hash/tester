import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

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
  // Remove old classes
  td.classList.remove(`${type}-overdue`, `${type}-due-soon`);

  // Reset text
  td.textContent = scheduleText || "N/A";

  const dateObj = parseScheduleDate(scheduleText);
  const status = computeStatus(dateObj);

  // Add pill only if meaningful
  const pill = document.createElement("span");
  pill.classList.add("status-pill");

  if (status.state === "overdue") {
    td.classList.add(`${type}-overdue`);
    pill.classList.add("status-overdue");
    pill.textContent = status.label;
    td.appendChild(pill);
  } else if (status.state === "due-soon") {
    td.classList.add(`${type}-due-soon`);
    pill.classList.add("status-due-soon");
    pill.textContent = status.label;
    td.appendChild(pill);
  // } else if (status.state === "ok") {
    // Optional: show OK pill (comment out if you don’t want)
    pill.classList.add("status-ok");
    pill.textContent = status.label;
    td.appendChild(pill);
  } else {
    // N/A: leave as is
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

async function renderSchedulesAndHighlights() {
  const table = document.querySelector("table");
  if (!table) return;

  const rows = Array.from(table.querySelectorAll("tr")).slice(1);

 
  const ids = rows
    .map(tr => normalizeIdent(tr.cells?.[0]?.textContent))
    .filter(id => id.startsWith("SZ"));

  if (!ids.length) return;

  // Fetch all in ONE request
  const plans = await fetchPlansFor(ids);
  const map = new Map(plans.map(p => [normalizeIdent(p.identification), p]));

  for (const tr of rows) {
    tr.classList.remove("row-overdue", "row-due-soon");

    const testerName = normalizeIdent(tr.cells?.[0]?.textContent);
    if (!testerName.startsWith("SZ")) continue;

    const plan = map.get(testerName);
    const calTd = tr.cells[4]; // CAL SCHEDULE col
    const pmTd  = tr.cells[5]; // PM SCHEDULE col

    const calState = setCellStatus(calTd, "cal", plan?.cal_schedule ?? null);
    const pmState  = setCellStatus(pmTd, "pm",  plan?.pm_schedule ?? null);

    // Row highlight priority:
    // overdue > due soon > ok
    if (calState === "overdue" || pmState === "overdue") {
      tr.classList.add("row-overdue");
    } else if (calState === "due-soon" || pmState === "due-soon") {
      tr.classList.add("row-due-soon");
    }
  }
}
// === Smart refresh (12 hours) ===
const TWELVE_HOURS = 12 * 60 * 60 * 1000;
const LAST_REFRESH_KEY = "calibration_last_refresh_ts";

function shouldRefreshNow() {
  const last = Number(localStorage.getItem(LAST_REFRESH_KEY) || "0");
  return Date.now() - last >= TWELVE_HOURS;
}

async function refreshData() {
  try {
    // Your existing function that fetches + renders + highlights
    await renderSchedulesAndHighlights();

    localStorage.setItem(LAST_REFRESH_KEY, String(Date.now()));
    console.log("✅ Refreshed calibration data:", new Date().toLocaleString());
  } catch (err) {
    console.error("❌ Refresh failed:", err);
  }
}

// 1) On first page load: refresh once
window.addEventListener("DOMContentLoaded", () => {
  refreshData();
});

// 2) When user returns to the tab: refresh only if 12 hours passed
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && shouldRefreshNow()) {
    refreshData();
  }
});

// Optional: also refresh when the window gains focus (more reliable)
window.addEventListener("focus", () => {
  if (shouldRefreshNow()) {
    refreshData();
  }
});

// window.addEventListener("DOMContentLoaded", renderSchedulesAndHighlights);
// === Smart refresh (12 hours) ===
const TWELVE_HOURS = 12 * 60 * 60 * 1000;
const LAST_REFRESH_KEY = "calibration_last_refresh_ts";

function shouldRefreshNow() {
  const last = Number(localStorage.getItem(LAST_REFRESH_KEY) || "0");
  return Date.now() - last >= TWELVE_HOURS;
}

async function refreshData() {
  try {
    // Your existing function that fetches + renders + highlights
    await renderSchedulesAndHighlights();

    localStorage.setItem(LAST_REFRESH_KEY, String(Date.now()));
    console.log("✅ Refreshed calibration data:", new Date().toLocaleString());
  } catch (err) {
    console.error("❌ Refresh failed:", err);
  }
}

// 1) On first page load: refresh once
window.addEventListener("DOMContentLoaded", () => {
  refreshData();
});

// 2) When user returns to the tab: refresh only if 12 hours passed
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && shouldRefreshNow()) {
    refreshData();
  }
});

// Optional: also refresh when the window gains focus (more reliable)
window.addEventListener("focus", () => {
  if (shouldRefreshNow()) {
    refreshData();
  }
});

const SUPABASE_URL = "https://pnrbdohtrvbrmvabvkxc.supabase.co";
const SUPABASE_KEY = "sb_publishable_YAq1ZIeaJdjx4w0G4DwY3g_tXAZHuVk";
const DUE_SOON_DAYS = 10;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function normalizeIdent(s) {
  return (s || "").trim().toUpperCase();
}

/**
 * More reliable date parser for formats like "Oct 15, 2024"
 * (If CalMaster always uses English month names, this is safe.)
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

  const m = /^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})$/.exec(t);
  if (!m) return null;

  const month = months[m[1].toLowerCase()];
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (month == null) return null;

  return new Date(year, month, day);
}
