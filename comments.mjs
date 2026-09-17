import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const STATUSPHERE_URL = process.env.STATUSPHERE_URL;

async function processQueue() {

  try {
    console.log(
      `[${new Date().toISOString()}] Checking pending requests...`
    );

    const { data: requests, error } = await supabase
      .from("comment_requests")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Request fetch error:", error);
      return;
    }

    if (!requests?.length) {
      console.log("No pending requests.");
      return;
    }

    for (const request of requests) {
      const equipmentId = request.equipment_id;

      try {
        console.log(`Processing ${equipmentId}`);

        const url = `${STATUSPHERE_URL}${equipmentId}`;

        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(
            `Statusphere returned ${response.status}`
          );
        }

        const html = await response.text();

        const $ = cheerio.load(html);

        const scrapedRows = [];

        // Find all table rows
        $("tr").each((index, row) => {
          const cols = $(row).find("td");

          // Skip rows with insufficient columns
          if (cols.length < 6) return;

          scrapedRows.push({
            equipment_id: equipmentId,

            trans_date: $(cols[0]).text().trim(),

            duration: $(cols[1]).text().trim(),

            status_code: $(cols[2]).text().trim(),

            status_reason: $(cols[3]).text().trim(),

            job_reason: $(cols[4]).text().trim(),

            comments: $(cols[5]).text().trim(),

            scraped_at: new Date().toISOString()
          });
        });

        // First 5 rows only
        const top5Rows = scrapedRows.slice(0, 5);

        if (top5Rows.length === 0) {
          console.warn(
            `No rows found for ${equipmentId}`
          );
        } else {
          console.log(
            `Found ${top5Rows.length} rows for ${equipmentId}`
          );

          // Remove previous comments for same equipment
          await supabase
            .from("equipment_comments")
            .delete()
            .eq("equipment_id", equipmentId);

          const { error: insertError } =
            await supabase
              .from("equipment_comments")
              .insert(top5Rows);

          if (insertError) {
            throw insertError;
          }
        }

        // Mark request completed
        const { error: updateError } =
          await supabase
            .from("comment_requests")
            .update({
              status: "completed",
              processed_at: new Date().toISOString()
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
  } catch (err) {
    console.error("Worker Error:", err);
  }
}


const expiresAt = new Date(
  Date.now() + 2 * 60 * 1000
).toISOString();

await supabase
  .from("equipment_comments")
  .insert({
    equipment_id: equipmentId,
    comments: "sample",
    scraped_at: new Date().toISOString(),
    expires_at: expiresAt
  });
async function cleanupExpiredComments() {

  const now = new Date().toISOString();

  await supabase
    .from("equipment_comments")
    .delete()
    .lt("expires_at", now);

}

processQueue();

setInterval(async () => {
  await cleanupExpiredComments();
  await processQueue();
}, 10000);