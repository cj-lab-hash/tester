import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import { chromium } from "playwright";

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!process.env.SUPABASE_URL || !serviceKey) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env"
  );
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  serviceKey,
  {
    global: {
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey
      }
    }
  }
);

const STATUSPHERE_URL = process.env.EQUIPMENT_TRACKS;

console.log(
  "STATUSPHERE_URL:",
  JSON.stringify(STATUSPHERE_URL)
);

async function cleanupExpiredComments() {
  try {
    const now = new Date().toISOString();

    const { error } = await supabase
      .from("equipment_comments")
      .delete()
      .lt("expires_at", now);

    if (error) {
      console.error("Cleanup error:", error);
      return;
    }

    console.log("Expired comments cleaned.");
  } catch (err) {
    console.error("Cleanup failed:", err);
  }
}

async function processQueue() {
  let browser;

  try {
    console.log(
      `[${new Date().toISOString()}] Checking pending requests...`
    );

    const { data: requests, error } = await supabase
      .from("comment_requests")
      .select("*")
      .eq("status", "pending")
      .order("created_at", {
        ascending: true
      });

    if (error) {
      console.error("Request fetch error:", error);
      return;
    }

    if (!requests?.length) {
      console.log("No pending requests.");
      return;
    }

    browser = await chromium.launch({
      headless: true
    });

    const context = await browser.newContext({
      storageState: "statusphere_auth.json"
    });

    for (const request of requests) {
      const equipmentId = request.equipment_id;

      try {
        console.log(`Processing ${equipmentId}`);

        const url =
          `${STATUSPHERE_URL}${equipmentId}`;

        console.log(`Fetching: ${url}`);

        const page =
          await context.newPage();

        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 60000
        });

        //
        // DEBUG SCREENSHOT #1
        //
        await page.screenshot({
          path: `debug_${equipmentId}.png`,
          fullPage: true
        });

        const title = await page.title();

        console.log(
          "Page title:",
          title
        );

        const html =
          await page.content();

        console.log(
          html.substring(0, 1000)
        );

        //
        // ACCESS DENIED CHECK
        //
        if (
          html.includes("Access denied") ||
          html.includes("not authorized") ||
          title.includes("Access denied")
        ) {
          await page.screenshot({
            path: `access_denied_${equipmentId}.png`,
            fullPage: true
          });

          await page.close();

          throw new Error(
            "Statusphere access denied"
          );
        }

        //
        // SUCCESS SCREENSHOT
        //
        await page.screenshot({
          path: `success_${equipmentId}.png`,
          fullPage: true
        });

        await page.close();

        const $ =
          cheerio.load(html);

        const scrapedRows = [];

        //finding exact table
        // $("table").each((i, table) => {
        //   const text = $(table)
        //   .text()
        //   .slice(0, 500);
        //   console.log(`Table ${i}:`);
        //   console.log(text);

        // });
        const history = [];
        let historyTable = null;

      $("table").each((i, table) => {
        const tableText = $(table).text();

        if (
          tableText.includes("Trans Date") &&
          tableText.includes("Duration") &&
          tableText.includes("Status Code") &&
          tableText.includes("Comments")
            ) {
            historyTable = $(table);

          console.log(
            `Found history table: ${i}`
        );
      }
        });
        if (!historyTable) {
        throw new Error(
          "Machine History table not found"
        );
      }
        historyTable.find("tr").each((index, row) => {
          const cols = $(row).find("td");

          if (cols.length < 5) return;
          scrapedRows.push({
            equipment_id: equipmentId,
            // trans_date: $(cols[0]).text().trim(),
            status_code: $(cols[2]).text().trim(),
            status_reason: $(cols[3]).text().trim(),
            comments: $(cols[5]).text().trim(),
            scraped_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 3 * 60 * 1000).toISOString()
          });
        });
        console.log(
          JSON.stringify(
            scrapedRows.slice(0, 6),
            null,
            2
          )
        );
        const testerRow = {
          equipment_id: equipmentId,
          history: scrapedRows.map(r => ({
            status_code: r.status_code,
            status_reason: r.status_reason,
            comments: r.comments
          })),
          scraped_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 3 * 60 * 1000).toISOString()
        };
        const top5Rows = scrapedRows.slice(0, 10);

        console.log(
          `Found ${top5Rows.length} rows`
        );
        console.log("Table count:", $("table").length);
        $("table").each((i, table) => {
          console.log(
            `Table ${i} rows:`,
            $(table).find("tr").length
          );
        });


        const {
          error: upsertError
        } = await supabase
          .from("equipment_comments")
          .upsert(testerRow, {
            onConflict: "equipment_id"
          }
        );
          if (upsertError) {
            console.error(
              "Upsert error:",
              upsertError
            );
            throw upsertError;
          }

        const {
          error: updateError
        } = await supabase
          .from("comment_requests")
          .update({
            status: "completed",
            processed_at:
              new Date().toISOString()
          })
          .eq("id", request.id);

        if (updateError) {
          throw updateError;
        }

        console.log(
          `Completed ${equipmentId}`
        );
      } catch (err) {
        console.error(
          `Failed ${equipmentId}:`,
          err.message
        );

        await supabase
          .from("comment_requests")
          .update({
            status: "failed"
          })
          .eq("id", request.id);
      }
    }

    await browser.close();
  } catch (err) {
    console.error(
      "Worker Error:",
      err
    );

    if (browser) {
      await browser.close();
    }
  }
}

(async () => {
  // await cleanupExpiredComments();
  await processQueue();
})();

setInterval(async () => {
  // await cleanupExpiredComments();
  await processQueue();
}, 30000);