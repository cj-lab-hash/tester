import "dotenv/config";
import { chromium } from "playwright";

const URL = process.env.STATUSPHERE_URL;

(async () => {
  const browser = await chromium.launch({ headless: false }); // show browser
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  console.log("👉 Please login via SSO in the opened browser.");
  console.log("👉 After you see the equipment page fully loaded, return here and press Enter.");

  process.stdin.resume();
  await new Promise(resolve => process.stdin.once("data", resolve));

  await context.storageState({ path: "statusphere_auth.json" });
  console.log("✅ Saved session to statusphere_auth.json");

  await browser.close();
})();