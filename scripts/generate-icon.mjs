import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "assets/k-downloader.png");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html>
    <html><head><style>
      html, body { margin: 0; background: transparent; }
      .icon {
        width: 512px; height: 512px; display: grid; place-items: center;
        background: #b3f06c; color: #152018;
        font: 800 334px "DejaVu Sans", "Noto Sans", sans-serif;
        clip-path: polygon(0 0, 100% 0, 100% 72%, 72% 100%, 0 100%);
      }
    </style></head><body><div class="icon">K</div></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await mkdir(dirname(output), { recursive: true });
  await page.locator(".icon").screenshot({ path: output, omitBackground: true });
  console.log(`Generated ${output} (512x512 transparent PNG).`);
} finally {
  await browser.close();
}