import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = "https://pnrbdohtrvbrmvabvkxc.supabase.co";
const SUPABASE_KEY = "sb_publishable_YAq1ZIeaJdjx4w0G4DwY3g_tXAZHuVk";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function normalizeIdent(s) {
  return (s || "").trim().toUpperCase();
}

async function fetchPlansFor(ids) {
  const { data, error } = await supabase
    .from("calibration_plans")
    .select("identification, cal_schedule, pm_schedule")
    .in("identification", ids);

  if (error) {
    console.error("Supabase error:", error.message);
    return [];
  }
  return data || [];
}

async function renderSchedules() {
  const table = document.querySelector("table");
  if (!table) return;

  const rows = Array.from(table.querySelectorAll("tr")).slice(1);

  const ids = rows
    .map(tr => normalizeIdent(tr.cells?.[0]?.textContent))
    .filter(id => id.startsWith("SZ"));

  if (!ids.length) return;

  const plans = await fetchPlansFor(ids);
  const map = new Map(plans.map(p => [normalizeIdent(p.identification), p]));

  for (const tr of rows) {
    const ident = normalizeIdent(tr.cells?.[0]?.textContent);
    if (!ident.startsWith("SZ")) continue;

    const plan = map.get(ident);
    tr.cells[4].textContent = plan?.cal_schedule ?? "N/A";
    tr.cells[5].textContent = plan?.pm_schedule ?? "N/A";
  }
}

window.addEventListener("DOMContentLoaded", renderSchedules);