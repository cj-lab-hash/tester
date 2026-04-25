import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

// ===================== CONFIG =====================
const SUPABASE_URL = "https://pnrbdohtrvbrmvabvkxc.supabase.co";
const SUPABASE_KEY = "sb_publishable_YAq1ZIeaJdjx4w0G4DwY3g_tXAZHuVk"; // publishable is OK in frontend
const DUE_SOON_DAYS = 10; // change to 30 if you want
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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
  // Remove old classes
  td.classList.remove(`${type}-overdue`, `${type}-due-soon`);

  // Reset text
  td.textContent = scheduleText || "N/A";

  const dateObj = parseScheduleDate(scheduleText);
  const status = computeStatus(dateObj);

  // Add pill
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
  } else if (status.state === "ok") {
    // optional: comment out if you don't want OK pills
    pill.classList.add("status-ok");
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
    .filter(id => id.startsWith("SZ"));

  if (!ids.length) return;

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

    if (calState === "overdue" || pmState === "overdue") {
      tr.classList.add("row-overdue");
    } else if (calState === "due-soon" || pmState === "due-soon") {
      tr.classList.add("row-due-soon");
    }
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
    await renderSchedulesAndHighlights();
    localStorage.setItem(LAST_REFRESH_KEY, String(Date.now()));
    console.log("✅ Refreshed calibration data:", new Date().toLocaleString());
  } catch (err) {
    console.error("❌ Refresh failed:", err);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  refreshData();
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