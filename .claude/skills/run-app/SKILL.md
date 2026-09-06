---
name: run-app
description: Launch Victory or Death's dev servers and drive the game in a headless browser — create a match, click tiles, screenshot the board. Use when asked to run the app or verify a change works for real.
---

# Running Victory or Death

Two processes in dev: Vite on **5173** (the app) and the bun server on
**3001**. The Vite proxy forwards `/api` to the server, so everything goes
through 5173.

```sh
bun run dev   # from the repo root; run in the background, it does not exit
```

Smoke-check before driving (a 200 from both means the proxy and server are up):

```sh
curl -s -o /dev/null -w "vite=%{http_code} " http://localhost:5173/
curl -s -o /dev/null -w "api=%{http_code}\n"  http://localhost:5173/api/matches
```

Kill the dev process when done — it holds both ports.

## Driving it headless (verified 2026-09)

The board is a Babylon WebGL canvas — `curl` proves nothing about it, and the
repo's architecture doc says a real browser is the check for anything visual.
Playwright headless Chromium renders it fine (SwiftShader; no flags needed).

**Setup.** The npm package installs into a scratch dir (never this repo — it
must stay out of the workspaces); the browser binary caches durably in
`~/Library/Caches/ms-playwright`, so the download is one-time:

```sh
mkdir -p /tmp/vod-browser && cd /tmp/vod-browser
npm init -y && npm install playwright
npx playwright install chromium   # ~95MB, cached across runs
```

**Script skeleton** (`node script.mjs`, run from the scratch dir):

```js
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto('http://localhost:5173/');
await page.click('text=New match');            // navigates to /:matchId
await page.waitForSelector("text=Blue Army's turn");
await page.waitForTimeout(1500);               // let Babylon draw
await page.screenshot({ path: 'board.png' });
// ... drive, then:
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
```

## Clicking tiles

Tiles are canvas pixels, not DOM — there are no selectors. The reliable
workflow is **screenshot first, measure by eye, then click**: take a
screenshot, read it, note the pixel centre of the unit or tile you want, and
issue `page.mouse.click(x, y)` in a second run.

At viewport 1280×800 (canvas is 100vw × 90vh = 1280×720) the default 8×8
board renders at roughly **x 461–975, y 197–520**, columns ~64px wide, rows
narrower toward the top (isometric tilt). The bottom-left tile centre is
about **(493, 488)**. These drift if the camera or grid changes — trust the
screenshot, not these numbers.

What to assert:

- Selection: click a friendly unit → its tile gets the **yellow** highlight
  and the **blue-tinted** movement-range overlay appears. Verify by
  screenshot; canvas pixels can't be read from page JS
  (`preserveDrawingBuffer` is off).
- Move: click a tinted tile → the unit animates (~1–2s; `waitForTimeout(2000)`
  before the screenshot) and the selection clears.
- Turn: `page.click('text=End Turn')` →
  `waitForSelector("text=Red Army's turn")`. The turn label is real DOM.
- Always print collected page errors — a clean run reports `none`.
