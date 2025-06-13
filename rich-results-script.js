/**
 * rich-results-script.js
 *
 * Automates Google’s Rich Results Test:
 * 1. Navigates to https://search.google.com/test/rich-results
 * 2. Moves cursor → clicks URL input → types URL → presses Enter
 * 3. Waits until results finish loading (with retry logic)
 * 4. Draws a red bounding box (for visualization) at the specified region
 * 5. Takes a clipped screenshot of that region
 *
 * Usage:
 *   node rich-results-script.js \
 *     --url="https://example.com" \
 *     --x=100 --y=200 --width=800 --height=600 \
 *     --output="result.png"
 *
 * Flags:
 *   --url       (required) The webpage URL to test
 *   --x         (optional, default=0)   X coordinate of the clip region
 *   --y         (optional, default=0)   Y coordinate of the clip region
 *   --width     (optional, default=1024)  Width of the clip region
 *   --height    (optional, default=768)   Height of the clip region
 *   --output    (optional, default="rich-results.png") Output screenshot filename
 *   --retries   (optional, default=3)    Number of times to retry on failure
 *   --timeout   (optional, default=60000) Timeout per step in milliseconds
 */

const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

// const inputUrl = 'Enter the Input URL to process'; //Enter the URL (mandatory)

async function parseArgs(inputUrl) {
  // const args = process.argv.slice(2);
  // console.log("argsssss",args)
  const config = {
    url: inputUrl,
    x: 470,
    y: 230,
    width: 970,
    height: 560,
    output: "rich-results.png",
    retries: 3,
    timeout: 60000,
  };

  if (!config.url) {
    console.error("ERROR: --url is required");
    process.exit(1);
  }

  return config;
}

async function handleRetryOnFailure(page, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // 1) Check if “Something went wrong” modal is visible
    const errorModalVisible = await page.evaluate(() =>
      Array.from(document.querySelectorAll("div, span")).some((el) =>
        /something went wrong/i.test(el.innerText)
      )
    );

    if (!errorModalVisible) {
      // No error → nothing to retry
      return;
    }

    console.warn(
      `⚠️ 'Something went wrong' detected. Attempt ${attempt}/${maxRetries}...`
    );

    // 2) Click “Dismiss” if it’s there
    const [dismissButton] = await page.$x(
      "//button[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'dismiss')]"
    );
    if (dismissButton) {
      await dismissButton.click();
      // Give the modal a moment to close
      await page.waitForTimeout(1000);
    }

    // 3) Re‐submit by pressing Enter on the already‐filled input
    //    First ensure the input is still visible, then press Enter.
    const inputSelector = 'input[type="url"], input[type="text"], input#url';
    await page.waitForSelector(inputSelector, { visible: true });
    await page.focus(inputSelector);
    await page.keyboard.press("Enter");
    console.log("🔁 Retrying test by pressing Enter on the URL input...");
    // Wait a little for the test to restart
    await page.waitForTimeout(3000);
  }

  // 4) After all retries, check if the modal is still visible—if so, throw.
  const stillFailing = await page.evaluate(() =>
    Array.from(document.querySelectorAll("div, span")).some((el) =>
      /something went wrong/i.test(el.innerText)
    )
  );

  if (stillFailing) {
    throw new Error(
      "❌ Repeated 'Something went wrong' errors after max retries."
    );
  }
}

// Helper to retry an async operation with exponential backoff
async function retryOperation(fn, retries = 3, delayMs = 1000) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt > retries) {
        throw err;
      }
      const backoff = delayMs * 2 ** (attempt - 1);
      console.warn(
        `Operation failed (attempt ${attempt}/${retries}). Retrying in ${backoff}ms...`
      );
      await new Promise((res) => setTimeout(res, backoff));
    }
  }
}

// Wait until the Rich Results Test is complete by polling for a known DOM change.
// You may need to adjust selectors if Google updates their page.
async function waitForTestCompletion(page, timeout) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const hasLoadingSpinner = await page.evaluate(() => {
      // Look for a spinner or "Testing…" label
      const spinner = document.querySelector(
        'div[class*="LoadingSpinner"], div[aria-label*="Testing"]'
      );
      return !!spinner;
    });
    if (hasLoadingSpinner) {
      // Still loading
      await new Promise((res) => setTimeout(res, 1000));
      continue;
    }

    // Check for a known indicator that results are shown
    const resultsVisible = await page.evaluate(() => {
      // 1) “View details” button
      if (document.querySelector('button[aria-label*="View details"]'))
        return true;
      // 2) A <pre> block (JSON‐LD)
      if (document.querySelector("pre")) return true;
      // 3) “TEST COMPLETE” text in a <span>
      const completeTag = Array.from(document.querySelectorAll("span")).find(
        (el) => /\bTEST COMPLETE\b/i.test(el.innerText)
      );
      return !!completeTag;
    });

    if (resultsVisible) {
      return;
    }

    // Otherwise, wait another second and poll again
    await new Promise((res) => setTimeout(res, 1000));
  }

  throw new Error("Timed out waiting for Rich Results Test to complete");
}

// const exampleInputUrl = 'squeegeedetail.com'; //Enter the URL (mandatory)



async function InitializeRichResultsScript(inputUrl) {
  const { url, x, y, width, height, output, retries, timeout } =
    await parseArgs(inputUrl);

  const os = require("os");

  const chromeUserDataDir = path.join(
    os.homedir(),
    "AppData",
    "Local",
    "Google",
    "Chrome",
    "User Data"
  );

  // Use a specific profile — adjust "Profile 1" or use "Default"
  const userProfile = "Default"; // or "Default" if you prefer

  const browser = await puppeteer.launch({
    headless: false,
    args: ["--start-maximized"],
    executablePath:
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    userDataDir: path.join(chromeUserDataDir, userProfile),
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1200 });

  // Increase default timeout
  page.setDefaultTimeout(timeout);

  try {
    // 1) Navigate to the Rich Results Test page
    await retryOperation(
      () =>
        page.goto("https://search.google.com/test/rich-results", {
          waitUntil: "domcontentloaded",
        }),
      retries,
      1000
    );

    // 2) Wait for the URL input field to appear
    const inputSelector = 'input[type="url"], input[type="text"], input#url';
    await retryOperation(
      () => page.waitForSelector(inputSelector, { visible: true }),
      retries,
      1000
    );

    // ─── NEW “HUMAN‐LIKE” INTERACTION START ───
    // 3) Move cursor to the input, click it, type URL, and press Enter
    const inputHandle = await page.$(inputSelector);
    const box = await inputHandle.boundingBox();
    if (box) {
      const clickX = box.x + box.width / 2;
      const clickY = box.y + box.height / 2;
      // Move the mouse in small steps to simulate a human
      await page.mouse.move(clickX, clickY, { steps: 20 });
      await page.waitForTimeout(200); // brief pause before clicking
      await page.mouse.click(clickX, clickY);
    } else {
      // Fallback to focusing if boundingBox() fails
      await page.focus(inputSelector);
    }

    // Type the URL and press Enter
    await page.keyboard.type(url, { delay: 100 });
    await page.keyboard.press("Enter");
    // Wait a moment for the test to start (and possibly show an error modal)
    await page.waitForTimeout(3000);
    // ─── NEW “HUMAN‐LIKE” INTERACTION END ───

    // 4) Handle “Something went wrong” modal (up to 5 retries)
    await handleRetryOnFailure(page);

    // 5) Wait for the test to actually complete
    await waitForTestCompletion(page, timeout);

    // 6) Draw a red bounding‐box overlay (for visualization)
    await page.evaluate(
      ({ x, y, width, height }) => {
        const existing = document.getElementById("__clipOverlay");
        if (existing) existing.remove();

        const overlay = document.createElement("div");
        overlay.id = "__clipOverlay";
        overlay.style.position = "absolute";
        overlay.style.top = `${y}px`;
        overlay.style.left = `${x}px`;
        overlay.style.width = `${width}px`;
        overlay.style.height = `${height}px`;
        overlay.style.border = "2px solid red";
        overlay.style.zIndex = "999999";
        overlay.style.pointerEvents = "none";
        document.body.appendChild(overlay);
      },
      { x, y, width, height }
    );

    // Give the overlay a moment to render
    await new Promise((resolve) => setTimeout(resolve, 2500));

    // 7) Take a screenshot of the specified region
    const screenshotDir = path.join(process.cwd(), "screenshots");
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir);
    }
    const outputPath = path.join(screenshotDir, output);
    await page.screenshot({
      path: outputPath,
      clip: { x, y, width, height },
    });

    console.log(`✅ Screenshot saved to ${outputPath}`);
  } catch (err) {
    console.error("❌ Error during automation:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

module.exports = {InitializeRichResultsScript}

if (require.main === module) {
  InitializeRichResultsScript('squeegeedetail.com').catch((error) => {
    console.log("Script Error:", error)
  })
}
