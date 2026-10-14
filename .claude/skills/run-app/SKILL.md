---
name: run-app
description: Launch the game's dev servers and drive the game in a headless browser — create a match, click tiles, screenshot the board. Use when asked to run the app or verify a change works for real.
---

# Running the app

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
mkdir -p /tmp/wargame-browser && cd /tmp/wargame-browser
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

Tiles are canvas pixels, not DOM — there are no selectors. Dev builds expose
`window.__board.tileToScreen({ col, row })`, which answers in viewport
coordinates — exactly what `page.mouse.click` takes — or `null` off the grid.
Row 0 is the bottom rank, where blue deploys. It appears once the board's
renderer is ready, so wait for it:

```js
await page.waitForFunction(() => window.__board);
const click = async (col, row) => {
  const at = await page.evaluate((c) => window.__board.tileToScreen(c), { col, row });
  await page.mouse.click(at.x, at.y);
};
```

⚠️ **Ask just before each click; never cache an answer.** Zoom and pan move
every tile. And some things still take a click meant for a tile:

- a taller tile drawn in front — picking tries the tallest surface first;
- the menu and the forecast panes, which float above a tile and take clicks;
- the battle close-up, which swallows every click until it is dismissed with
  one of its own.

What to assert:

- Selection: click a friendly unit → its tile gets the **yellow** highlight
  and the **blue-tinted** movement-range overlay appears — unless it could
  attack or charge from where it stands, when the action panel opens there
  instead. Verify by screenshot; canvas pixels can't be read from page JS
  (`preserveDrawingBuffer` is off).
- Move: click a tinted tile to pin the route, click it again to confirm → the
  unit walks (~1–2s; `waitForTimeout(2000)`), then the panel opens, or straight
  to Hold's facing tiles when there is nothing to attack; a facing click
  commits.
- Battle: an attack or a charge opens the close-up, which waits for a click
  before the board takes clicks again.
- Map viewer: `page.click('text=Browse maps')` from the start screen → `/maps`,
  a `select` of every map. Switching the `select` rebuilds the scene;
  `page.selectOption('select', 'lakeland')` then screenshot. No tile clicking —
  the viewer registers no click handler and installs no `__board`.
- Turn: `page.click('text=End Turn')` →
  `waitForSelector("text=Red Army's turn")`. The turn label is real DOM.
- Always print collected page errors — a clean run reports `none`.
