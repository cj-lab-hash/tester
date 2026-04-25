import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const CALMASTER_URL = process.env.CALMASTER_URL;

const ROWS_PER_PAGE = process.env.ROWS_PER_PAGE || "100";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!process.env.SUPABASE_URL || !serviceKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
}

const supabase = createClient(process.env.SUPABASE_URL, serviceKey, {
  global: {
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
    },
  },
});

function getFrame(page, urlPart) {
  return page.frames().find((f) => f.url().includes(urlPart));
}

async function fillIdentificationAndSearch(searchFrame, identValue) {
  await searchFrame.waitForSelector("body", { timeout: 30000 });

  // Identification input near label "Identification"
  const identInput = searchFrame
    .locator(`xpath=//*[contains(normalize-space(.), 'Identification')]/following::input[1]`)
    .first();

  await identInput.waitFor({ timeout: 30000 });
  await identInput.fill("");
  await identInput.fill(identValue);

  // Click Search button (avoid selecting <option> text)
  const searchBtn = searchFrame
    .locator('input[type="submit"][value="Search"], button:has-text("Search")')
    .first();

  await searchBtn.waitFor({ state: "visible", timeout: 30000 });
  await searchBtn.scrollIntoViewIfNeeded();
  await searchBtn.click();
}

async function setRowsPerPage(mainFrame, value = "100") {
  try {
    const rowsSelect = mainFrame
      .locator(`xpath=//*[contains(normalize-space(.), 'Rows per page')]/following::select[1]`)
      .first();

    if (await rowsSelect.count()) {
      await rowsSelect.selectOption(value);
      await mainFrame.waitForTimeout(1000);
    }
  } catch {
    // If it fails, ignore; we can still scrape what is currently visible.
  }
}

async function scrapePlans(mainFrame) {
  await mainFrame.waitForSelector("body", { timeout: 30000 });

  // Wait until results are not empty
  await mainFrame
    .waitForFunction(() => !document.body.innerText.includes("Total of 0 items"), { timeout: 30000 })
    .catch(() => {});

  const plans = await mainFrame.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();

    const tables = Array.from(document.querySelectorAll("table"));
    const table =
      tables.find(
        (t) =>
          t.innerText.includes("Identification") &&
          t.innerText.includes("Cal Schedule") &&
          t.innerText.includes("PM Schedule")
      ) || tables[0];

    if (!table) return [];

    const headerRow = table.querySelector("thead tr") || table.querySelector("tr");
    if (!headerRow) return [];

    // ✅ Create headers first (fixes TDZ error)
    const headerCells = Array.from(headerRow.querySelectorAll("th, td"));
    const headers = headerCells.map((h) => norm(h.textContent));

    const headerIndex = new Map();
    headers.forEach((h, i) => {
      if (!headerIndex.has(h)) headerIndex.set(h, i);
    });

    const col = {
      identification: headerIndex.get("identification"),
      cal_interval: headerIndex.get("cal interval"),
      cal_schedule: headerIndex.get("cal schedule"),
      pm_interval: headerIndex.get("pm interval"),
      pm_schedule: headerIndex.get("pm schedule"),
    };

    const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
    const rows = bodyRows.length ? bodyRows : Array.from(table.querySelectorAll("tr")).slice(1);

    const pick = (cells, idx) =>
      typeof idx === "number" && idx >= 0 && cells[idx]
        ? (cells[idx].textContent || "").trim()
        : null;

    return rows
      .map((tr) => {
        const cells = Array.from(tr.querySelectorAll("td"));
        if (!cells.length) return null;

        const identification = pick(cells, col.identification);
        if (!identification) return null;

        return {
          identification,
          cal_interval: pick(cells, col.cal_interval),
          cal_schedule: pick(cells, col.cal_schedule),
          pm_interval: pick(cells, col.pm_interval),
          pm_schedule: pick(cells, col.pm_schedule),
        };
      })
      .filter(Boolean);
  });

  return plans;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(CALMASTER_URL, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1500);

    const searchFrame = getFrame(page, "/items/search");
    const mainFrame = getFrame(page, "/items/main");

    if (!searchFrame || !mainFrame) {
      console.error("Frames not found. Current frames:");
      console.log(page.frames().map((f) => f.url()));
      return;
    }

    // ✅ Read queries from .env: IDENT_QUERIES=SZ
    const queries = (process.env.IDENT_QUERIES || "SZ*")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    let total = 0;
    for (const q of queries) {
      total += await runQuery(searchFrame, mainFrame, q, ROWS_PER_PAGE);
    }

    console.log(`\n🎉 Done. Total rows upserted: ${total}`);

  } catch (err) {
    console.error("Sync failed:", err);
  } finally {
    await browser.close();
  }
}

async function runQuery(searchFrame, mainFrame, queryText, rowsPerPageValue) {
  console.log(`\n🔎 Searching Identification = ${queryText}`);

  // 1) Fill identification and click Search
  await fillIdentificationAndSearch(searchFrame, queryText);

  await mainFrame.waitForTimeout(1500);

  // 3) Optional: set rows per page (e.g. 100)
  await setRowsPerPage(mainFrame, rowsPerPageValue);
  await mainFrame.waitForTimeout(1000);

  // 4) Scrape table rows
  const plans = await scrapePlans(mainFrame);

  if (!plans.length) {
    console.log(`⚠️ No rows scraped for ${queryText}`);
    return 0;
  }

  // 5) Upsert into Supabase (single batch)
  const checkedAt = new Date().toISOString();
  const payload = plans.map(r => ({ ...r, checked_at: checkedAt }));

  const { error } = await supabase
    .from("calibration_plans")
    .upsert(payload, { onConflict: "identification" });

  if (error) throw error;

  console.log(`✅ Upserted ${payload.length} rows for ${queryText}`);
  return payload.length;
}

main();
