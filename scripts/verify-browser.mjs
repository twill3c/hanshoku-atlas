// 実ブラウザ検品(HC-041 / HC-078 / HC-080)と G-07 の実測。
//
// テストが緑でも動くとは限らない。ここで確かめるのは三つ:
//   1. 実際に Met から画像を CORS 越しに読み、canvas が汚染されずに版色が出るか(F-05)
//   2. **Chromium と Firefox で同じ版色になるか**(G-07 —— 閾値 Δh ≤ 2.0°)
//   3. 複数の画面幅で横に溢れていないか(N-05 / HC-078)
//
// **検品器自身の陽性対照**(HC-080): 存在しないはずの要素を数え、0 でなければ検品器の側を疑う。
// 終了コードで失敗を知らせる —— 取得に失敗した画面を撮っても「撮影しました」と出る道具にしない。

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium, firefox } from "playwright";

const ROOT = resolve(process.cwd(), "out");
const SHOTS = resolve(process.cwd(), "out-shots");
const HUE_TOLERANCE = 2.0; // G-07(SPEC §6 で宣言済み)
const WIDTHS = [390, 768, 1280];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

function serve() {
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent((req.url ?? "/").split("?")[0]);
      // vercel.json の rewrite を模倣する —— 本番では /met/* がエッジで
      // images.metmuseum.org へ書き換えられる(関数は起動しない)。
      // **これは模倣であって本番経路ではない。** 本番の rewrite 越しに Met が
      // 応答するかは、デプロイして確かめるまで「見込み」である(SPEC §2.7 / HC-096)。
      if (p.startsWith("/met/")) {
        const upstream = "https://images.metmuseum.org/" + p.slice("/met/".length);
        const r = await fetch(upstream);
        if (!r.ok) { res.writeHead(r.status).end("upstream " + r.status); return; }
        res.writeHead(200, { "Content-Type": r.headers.get("content-type") ?? "image/jpeg" });
        res.end(Buffer.from(await r.arrayBuffer()));
        return;
      }
      if (p.endsWith("/")) p += "index.html";
      const file = join(ROOT, p);
      if (!file.startsWith(ROOT)) throw new Error("path escape");
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

/** ページを開いて既定の作品の版色が出るまで待ち、パレットを読む。 */
async function readPlates(browserType, base, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

  await page.goto(base, { waitUntil: "load" });

  // 検品器は実装ではなく振る舞いで書く(HC-080)。要素名ではなくテキストの形で待つ
  await page.waitForFunction(
    () => document.querySelectorAll("button.plate").length >= 2,
    null,
    { timeout: 90_000 },
  );

  const plates = await page.$$eval("button.plate", (els) =>
    els.map((el) => ({
      hex: el.querySelector(".hex")?.textContent?.trim() ?? "",
      meta: el.querySelector(".meta")?.textContent?.trim() ?? "",
      share: el.querySelector(".share")?.textContent?.trim() ?? "",
    })),
  );

  // 版のマスク —— 押したら画面が変わることを確かめる(押せるだけでは意味がない)
  const before = await page.locator("canvas").screenshot();
  await page.locator("button.plate").first().click();
  await page.waitForTimeout(400);
  const after = await page.locator("canvas").screenshot();
  const maskChanged = Buffer.compare(before, after) !== 0;

  // 幅ごとの横溢れ(HC-078)
  const overflow = [];
  if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(250);
    const m = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      docH: document.documentElement.scrollHeight,
    }));
    if (m.scrollW > m.clientW + 1) overflow.push(`${w}px で横に ${m.scrollW - m.clientW}px 溢れた`);
    if (m.docH > 16000) overflow.push(`${w}px で縦が ${m.docH}px(表の潰れを疑う)`);
    await page.screenshot({ path: join(SHOTS, `${name}-${w}.png`), fullPage: false });
  }

  // 画面に出ている測定値(N-04 / 目玉の k)をそのまま読む
  const stats = (await page.$$eval(".stats", (els) => els.map((e) => e.textContent ?? ""))).join(" | ");

  // 慣性曲線は押したときだけ走る。**押して初めて目玉の k が出る**ので、ここで押す
  await page.getByRole("button", { name: /慣性の折れ曲がりを探す/ }).click();
  await page.waitForFunction(() => /示す k = \d+/.test(document.body.textContent ?? ""), null, {
    timeout: 180_000,
  });
  const curveStats = (await page.$$eval(".stats", (els) => els.map((e) => e.textContent ?? ""))).join(" | ");

  // 検品器の陽性対照(HC-080): 在るはずのないものを数える
  const bogus = await page.$$eval("button.plate-does-not-exist", (els) => els.length);

  await browser.close();
  return { plates, maskChanged, overflow, problems, bogus, stats, curveStats };
}

function hueOf(meta) {
  const m = meta.match(/h\s+([-\d.]+)°/);
  return m ? Number(m[1]) : NaN;
}

function circDiff(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}/`;
const fail = [];

try {
  const c = await readPlates(chromium, base, "chromium");
  const f = await readPlates(firefox, base, "firefox");

  for (const [name, r] of [
    ["chromium", c],
    ["firefox", f],
  ]) {
    console.log(`${name}: 版 ${r.plates.length} / マスク切替 ${r.maskChanged ? "効いた" : "効かない"}`);
    console.log(`  ${r.stats}`);
    console.log(`  ${r.curveStats}`);
    for (const p of r.plates) console.log(`  ${p.hex}  ${p.share.padStart(7)}  ${p.meta}`);
    if (r.problems.length) fail.push(`${name}: ${r.problems.join(" / ")}`);
    if (!r.maskChanged) fail.push(`${name}: 版を押しても canvas が変わらない(F-03)`);
    if (r.overflow.length) fail.push(`${name}: ${r.overflow.join(" / ")}`);
    if (r.bogus !== 0) fail.push(`${name}: 検品器の陽性対照が壊れている(存在しない要素を ${r.bogus} 件数えた)`);
    if (r.plates.length < 2) fail.push(`${name}: 版が 2 つ未満`);
  }

  // ---- G-07 —— ブラウザ間の色相角
  if (c.plates.length !== f.plates.length) {
    fail.push(`G-07: 版数が食い違う(chromium ${c.plates.length} / firefox ${f.plates.length})`);
  } else {
    let worst = 0;
    let worstAt = "";
    for (let i = 0; i < c.plates.length; i++) {
      const d = circDiff(hueOf(c.plates[i].meta), hueOf(f.plates[i].meta));
      if (!Number.isFinite(d)) {
        fail.push(`G-07: 色相角を読めなかった(版 ${i})`);
        continue;
      }
      if (d > worst) {
        worst = d;
        worstAt = `${c.plates[i].hex} vs ${f.plates[i].hex}`;
      }
    }
    console.log(`\n[G-07] Chromium ↔ Firefox の色相角の最大差 ${worst.toFixed(3)}°(閾値 ${HUE_TOLERANCE}°)${worstAt ? " — " + worstAt : ""}`);
    if (worst > HUE_TOLERANCE) fail.push(`G-07: 色相角が ${worst.toFixed(3)}° 食い違う`);

    const sameHex = c.plates.every((p, i) => p.hex === f.plates[i].hex);
    console.log(`[G-07] 16 進表記まで一致: ${sameHex ? "はい" : "いいえ"}`);
  }
} finally {
  server.close();
}

if (fail.length) {
  console.error("\n検品 NG:\n  " + fail.join("\n  "));
  process.exit(1);
}
console.log("\n検品 OK");
