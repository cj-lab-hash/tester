import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";import { createClient = "https://YOURPROJECT.supabase.co";
const SUPABASE_KEY = "YOUR_PUBLISHABLE_OR_ANON_KEY";

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
    console.error("Supabase fetch error:", error.message);
    return [];
  }
  return data || [];
}

async function renderSchedules() {
  const table = document.querySelector("table");
  if (!table) return;

  const rows = Array.from(table.querySelectorAll("tr")).slice(1);

  // column 0 = TESTER NAME (SZxxx)
  const ids = rows
    .map(tr => normalizeIdent(tr.cells?.[0]?.textContent))
    .filter(id => id.startsWith("SZ"));

  if (!ids.length) return;

  const plans = await fetchPlansFor(ids);
  const map = new Map(plans.map(p => [normalizeIdent(p.identification), p]));

  for (const tr of rows) {
    const name = normalizeIdent(tr.cells?.[0]?.textContent);
    if (!name.startsWith("SZ")) continue;

    const plan = map.get(name);

    // column 4 = CAL SCHEDULE, column 5 = PM SCHEDULE (based on your screenshot)
    tr.cells[4].textContent = plan?.cal_schedule ?? "N/A";
    tr.cells[5].textContent = plan?.pm_schedule ?? "N/A";
  }
}

window.addEventListener("DOMContentLoaded", renderSchedules);

// DO NOT use service_role / sb_secret key in frontend

