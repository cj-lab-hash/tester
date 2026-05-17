import "dotenv/config";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const STATUSPHERE_URL = process.env.STATUSPHERE_URL;
if (!STATUSPHERE_URL) throw new Error("Missing STATUSPHERE_URL in .env");

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.SUPABASE_URL || !serviceKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
}

const supabase = createClient(process.env.SUPABASE_URL, serviceKey, {
  global: { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } },
});

const TARGET_FAMILIES = ["SZ", "TERCAT", "QUARTET", "DUO", "MICROFLEX", "TERFLEX", "IFLEX", "EAGLE", "MAV10", "MAV20", "TERMAG20","LTX","ASL1K","ASL4K","STS50", "KTS", "MPS","NOISE","TERA360Z","SC212","DOT400"];
// ---------- helpers ----------
function normalizeEquipmentId(id) {
  if (!id) return null;
  const s = id.trim().toUpperCase();

  // SZ1 / SZ11 / SZ011 -> SZ001 / SZ011 / SZ011
  let m = /^SZ(\d{1,3})$/.exec(s);
  if (m) return `SZ${m[1].padStart(3, "0")}`;

  // TERCAT5/05/005 -> TERCAT005; QUARTET1 -> QUARTET001; DUO8 -> DUO008
  m = /^(TERCAT|QUARTET|DUO|MICROFLEX|TERFLEX)(\d{1,3})$/.exec(s);
  if (m) return `${m[1]}${m[2].padStart(3, "0")}`;

  m = /^(\d{1,3})IFLEX$/.exec(s);
  if (m) return `${m[1].padStart(2, "0")}IFLEX`;
  if (s.includes("IFLEX")) return s;
  if (/^EAGLE88[0-9A-Z]+$/.test(s)) return s;
  if (/^MAV10\d{2}$/.test(s)) return s;
  if(/^MAV20\d{2}$/.test(s)) return s;
  if(/^TERMAG20\d{2}$/.test(s)) return s;
  if(/^LTX\d{3}$/.test(s)) return s;
  if(/^ASL1K\d{3}$/.test(s)) return s;
  if(/^ASL4K\d{3}$/.test(s)) return s;
  if(/^STS50\d{5}$/.test(s)) return s;
  if (/^KTS\d{3}$/.test(s)) return s;
  if (/^MPS\d{3}$/.test(s)) return s;
  if (/^NOISE\d{3}$/.test(s)) return s;
  if (/^TERA360Z\d{3}$/.test(s)) return s;
  if (/^SC212\d{3}$/.test(s)) return s;
  if (/^DOT400\d{3}$/.test(s)) return s;
  

  return null;
}

function isTargetFamily(id) {
  if (!id) return false;
  const s = id.toUpperCase();

  // return id && /^(SZ|TERCAT|QUARTET|DUO|MICROFLEX|TERFLEX)\d{3}$/.test(id);
return (
  /^SZ\d{3}$/.test(s) ||
  /^(TERCAT|QUARTET|DUO|MICROFLEX|TERFLEX)\d{3}$/.test(s) ||
  /^\d{2,3}IFLEX$/.test(s) ||
  s.includes("IFLEX") ||
  /^EAGLE88[0-9A-Z]+$/.test(s) || 
  /^MAV10\d{2}$/.test(s) ||
  /^MAV20\d{2}$/.test(s) ||
  /^TERMAG20\d{2}$/.test(s) ||
  /^LTX\d{3}$/.test(s) ||
  /^ASL1K\d{3}$/.test(s) ||
  /^ASL4K\d{3}$/.test(s) ||
  /^STS50\d{5}$/.test(s) ||
  /^KTS\d{3}$/.test(s) ||
  /^MPS\d{3}$/.test(s) ||
  /^NOISE\d{3}$/.test(s) ||
  /^TERA360Z\d{3}$/.test(s) ||
  /^SC212\d{3}$/.test(s) ||
  /^DOT400\d{3}$/.test(s)
  

    // include all the above as valid IDs
);
}

function parseCoords(coordsStr = "") {
  const parts = coordsStr.split(",").map(n => Number(n.trim()));
  if (parts.length < 4 || parts.some(Number.isNaN)) return null;
  const [x1, y1, x2, y2] = parts;
  return { x1, y1, x2, y2 };
}

function pickLatestByCoords(rows) {
  const latest = new Map();

  for (const r of rows) {
    const prev = latest.get(r.equipment_id);
    if (!prev) {
      latest.set(r.equipment_id, r);
      continue;
    }

    const rx2 = r._coords?.x2 ?? -1;
    const px2 = prev._coords?.x2 ?? -1;

    if (rx2 > px2) {
      latest.set(r.equipment_id, r);
      continue;
    }

    // tie-breaker if same x2
    const rx1 = r._coords?.x1 ?? -1;
    const px1 = prev._coords?.x1 ?? -1;
    if (rx2 === px2 && rx1 > px1) {
      latest.set(r.equipment_id, r);
    }
  }

  return Array.from(latest.values());
}

function parseTitle(title = "") {
  const obj = { raw_title: title };
  const lines = title.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;

    let key = line.slice(0, idx).trim().toLowerCase();
    key = key.replace(/\./g, "");
    key = key.replace(/\s+/g, "_");

    const value = line.slice(idx + 1).trim();
    obj[key] = value;
  }

  // runtime uses "->" (not "&gt;")
  if (obj.eqpt_state) {
    const cleaned = obj.eqpt_state.replace(/->/g, " ").trim();
    obj.state_long = cleaned || null;
    obj.state_short = cleaned ? cleaned.split(/\s+/)[0] : null;
  }

  return obj;
}

function extractEquipmentFromHref(href = "") {
  if (!href) return null;

  // handle HTML entity in href attributes
  const cleanHref = href.replace(/&amp;/g, "&");

  const u = new globalThis.URL(cleanHref, "http://local/");
  const eq = u.searchParams.get("EQUIPMENT"); // this is the actual param
  return eq ? eq.trim().toUpperCase() : null;
}

async function setTesterTypeAllWithTab(page) {
  const sel = page.locator('select[name="RESOURCEFAMILY"]'); // ✅ correct tester type dropdown
  //
  await sel.waitFor({ timeout: 50000 });

  // Select All
  await sel.selectOption({ label: "All" });

  // Mimic your manual action: Tab triggers submit/refresh
  await sel.focus();
  await page.keyboard.press("Tab");

  // You said it takes ~15 seconds, so give it 20 seconds
  await page.waitForTimeout(30000);

  // Verify that targets exist in the map after refresh
  await page.waitForFunction(() => {
    const hrefs = Array.from(document.querySelectorAll("map area"))
      .map(a => (a.getAttribute("href") || "").replace(/&amp;/g, "&"));
    return hrefs.some(h => /EQUIPMENT=(SZ|TERCAT|QUARTET|DUO|MICROFLEX|TERFLEX|IFLEX|EAGLE|MAV10|MAV20|TERMAG20|LTX|ASL1K|ASL4K|STS50|KTS|MPS|NOISE|TERA360Z|SC212|DOT400)\d*|EQUIPMENT=[^&]*IFLEX/i.test(h));
  }, { timeout: 70000 });

  // Debug: confirm what is selected now
  const selected = await sel.evaluate(el => el.options[el.selectedIndex]?.textContent?.trim());
  console.log("Tester Type selected (RESOURCEFAMILY):", selected);
}



async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: "statusphere_auth.json" });
  const page = await context.newPage();

  await page.goto(STATUSPHERE_URL, { waitUntil: "domcontentloaded", timeout: 70000 });
  await page.waitForTimeout(2500);

  //very helpful to debug selectors and page structure without needing to run the whole script each time
//   const selectDump = await page.evaluate(() => {
//   return Array.from(document.querySelectorAll("select")).map((s, i) => ({
//     i,
//     name: s.getAttribute("name"),
//     id: s.getAttribute("id"),
//     selected: s.options[s.selectedIndex]?.textContent?.trim(),
//     // show first 25 options only (enough to see LTXMX/All)
//     options: Array.from(s.options).slice(0, 25).map(o => (o.textContent || "").trim())
//   }));
// });
// console.log(JSON.stringify(selectDump, null, 2));




  // ✅ THIS is the key step: switch Tester Type to All + wait for the page to update before scraping
  await setTesterTypeAllWithTab(page);

  // Screenshot AFTER filters applied (so you can verify it shows "All")
  await page.screenshot({ path: "statusphere_debug.png", fullPage: true });
  console.log("Saved screenshot: statusphere_debug.png");

  // After setting All and waiting:
const hasTargets = await page.evaluate(() => {
  const hrefs = Array.from(document.querySelectorAll("map area"))
    .map(a => (a.getAttribute("href") || "").replace(/&amp;/g, "&"));
   return hrefs.some(h => /EQUIPMENT=(SZ|TERCAT|QUARTET|DUO|MICROFLEX|TERFLEX|IFLEX|EAGLE|MAV10|MAV20|TERMAG20|LTX|ASL1K|ASL4K|STS50|KTS|MPS|NOISE|TERA360Z|SC212|DOT400)\d*|EQUIPMENT=[^&]*IFLEX/i.test(h));
  

});

if (!hasTargets) {
  await page.screenshot({ path: "statusphere_not_all.png", fullPage: true });
  console.error("Filter did not switch to ALL (no SZ/TERCAT/QUARTET/DUO/MICROFLEX/TERFLEX/IFLEX/EAGLE/MAV10/MAV20/TERMAG20/LTX/ASL1K/ASL4K/STS50/KTS/MPS/NOISE/TERA360Z/SC212/DO400 found).");
  await browser.close();
  process.exit(2);
}
  // Scrape areas (main page)
  let areas = await page.$$eval("map area", els =>
    els.map(a => ({
      title: a.getAttribute("title") || "",
      href: a.getAttribute("href") || "",
      coords: a.getAttribute("coords") || "",
    }))
  );

// console.log(`Scraped ${areas.length} equipment areas`);

const ids = areas.map(a => normalizeEquipmentId(extractEquipmentFromHref(a.href))).filter(Boolean);
// console.log("Sample normalized IDs:", ids.slice(0, 20));



  // If map is in a frame, fall back
  if (areas.length === 0) {
    for (const f of page.frames()) {
      try {
        const c = await f.locator("map area").count();
        if (c > 0) {
          areas = await f.$$eval("map area", els =>
            els.map(a => ({
              title: a.getAttribute("title") || "",
              href: a.getAttribute("href") || "",
              coords: a.getAttribute("coords") || "",
            }))
          );
          break;
        }
      } catch {}
    }
  }

if (!areas.length) {
  await page.screenshot({ path: "statusphere_failed.png", fullPage: true });
  console.error("No map areas found. Possibly logged out / session expired.");
  process.exit(3);
}
  console.log(`Scraped ${areas.length} equipment areas`);
  // console.log("Sample href (raw):", areas[1]?.href);
  // console.log("Extracted EQUIPMENT:", extractEquipmentFromHref(areas[1]?.href));
// const ids = areas
//   .map(a => normalizeEquipmentId(extractEquipmentFromHref(a.href)))
//   .filter(Boolean);

const counts = ids.reduce((m, id) => {
  const prefix = id.startsWith("SZ") ? "SZ"
    : id.startsWith("TERCAT") ? "TERCAT"
    : id.startsWith("QUARTET") ? "QUARTET"
    : id.startsWith("DUO") ? "DUO"
    : id.startsWith("MICROFLEX") ? "MICROFLEX"
    : id.startsWith("TERFLEX") ? "TERFLEX"
    : id.startsWith("IFLEX") ? "IFLEX"
    : id.startsWith("EAGLE") ? "EAGLE"
    : id.startsWith("MAV10") ? "MAV10"
    : id.startsWith("MAV20") ? "MAV20"
    : id.startsWith("TERMAG20") ? "TERMAG20"
    : id.startsWith("LTX") ? "LTX"
    : id.startsWith("ASL1K") ? "ASL1K"
    : id.startsWith("ASL4K") ? "ASL4K"
    : id.startsWith("STS50") ? "STS50"
    :id.startsWith("KTS") ? "KTS"
    :id.startsWith("MPS") ? "MPS"
    :id.startsWith("NOISE") ? "NOISE"
    :id.startsWith("TERA360Z") ? "TERA360Z"
    :id.startsWith("SC212") ? "SC212"
    :id.startsWith("DOT400") ? "DOT400"
    : "OTHER";
  m[prefix] = (m[prefix] || 0) + 1;
  return m;
}, {});

console.log("Target family counts in page:", counts);

  const runTs = new Date().toISOString();

  const rowsRaw = areas
    .map(a => {
      const rawId = extractEquipmentFromHref(a.href);
      const equipmentId = normalizeEquipmentId(rawId);

      if (!equipmentId || !isTargetFamily(equipmentId)) return null;

      const parsed = parseTitle(a.title);

      return {
        equipment_id: equipmentId,
        href: a.href || null,
        state_short: parsed.state_short || null,
        state_long: parsed.state_long || null,
        handler: parsed.handler || null,
        duration: parsed.duration || null,
        time_start: parsed.time_start || null,
        time_end: parsed.time_end || null,
        raw_title: parsed.raw_title,
        checked_at: runTs,
        _coords: parseCoords(a.coords),
      };
    })
    .filter(Boolean);

  const latestRows = pickLatestByCoords(rowsRaw);
  const payloadFinal = latestRows.map(({ _coords, ...rest }) => rest);

  console.log(`Latest per tester: ${rowsRaw.length} -> ${payloadFinal.length}`);

  if (payloadFinal.length === 0) {
    console.warn("⚠️ No rows to upsert. Check the debug screenshot and the extracted EQUIPMENT value.");
    await browser.close();
    return;
  }

  const { error } = await supabase
    .from("statusphere_equipment")
    .upsert(payloadFinal, { onConflict: "equipment_id" });

  if (error) {
    console.error("Supabase upsert error:", error);
    await browser.close();
    return;
  }

  console.log("✅ Upsert success");

 const dot400Rows = rowsRaw.filter(r => (r.equipment_id || "").includes("DOT400"));
 console.log("DOT400 rowsRaw:", dot400Rows.length, dot400Rows.slice(0, 10).map(r => r.equipment_id));


  // Cleanup old rows (keep only latest scrape)
  const { error: delErr } = await supabase
    .from("statusphere_equipment")
    .delete()
    .lt("checked_at", runTs)
    .or("equipment_id.ilike.SZ%,equipment_id.ilike.TERCAT%,equipment_id.ilike.QUARTET%,equipment_id.ilike.DUO%,equipment_id.ilike.MICROFLEX%,equipment_id.ilike.TERFLEX%,equipment_id.ilike.%IFLEX%,equipment_id.ilike.EAGLE%,equipment_id.ilike.MAV10%,equipment_id.ilike.MAV20%,equipment_id.ilike.TERMAG20%,equipment_id.ilike.LTX%,equipment_id.ilike.ASL1K%,equipment_id.ilike.ASL4K%,equipment_id.ilike.STS50%,equipment_id.ilike.KTS%,equipment_id.ilike.MPS%,equipment_id.ilike.NOISE%,equipment_id.ilike.TERA360Z%,equipment_id.ilike.SC212%,equipment_id.ilike.DOT400%")
;
  if (delErr) console.error("❌ Cleanup delete error:", delErr);
  else console.log("🧹 Cleanup success (removed stale rows)");

  await browser.close();
}

main().catch(console.error);
