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
import { judgeFooter, CONFORMING_FOOTER } from "./footer-rule.mjs";

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
    const m = await page.evaluate(() => {
      const fs = [...document.querySelectorAll("footer")];
      const foot = fs.find((x) => (x.innerText ?? "").includes("MIT License")) ?? fs[0];
      return {
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        docH: document.documentElement.scrollHeight,
        footerH: foot ? Math.ceil(foot.getBoundingClientRect().height) : 0,
        padBottom: Math.floor(parseFloat(getComputedStyle(document.body).paddingBottom) || 0),
      };
    });
    if (m.scrollW > m.clientW + 1) overflow.push(`${w}px で横に ${m.scrollW - m.clientW}px 溢れた`);
    if (m.docH > 16000) overflow.push(`${w}px で縦が ${m.docH}px(表の潰れを疑う)`);
    // 固定フッタは狭い幅で折り返して高くなる。逃げ(body の padding-bottom)が
    // それより小さいと、**最後の要素がフッタの下に隠れる**(実測 2026-08-31)
    if (m.footerH > m.padBottom) {
      overflow.push(`${w}px でフッタ ${m.footerH}px > 逃げ ${m.padBottom}px(本文が隠れる)`);
    }
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

  // フリート規約のフッタ(koho-lens が正本)。**描画結果の DOM で見る** ——
  // HTML を文字列で grep する検品は JS で組み立てるアプリで必ず誤判定する。
  // 1 ページに footer が 2 つあることもあるので、**MIT License を含むものを選ぶ**。
  const footer = await page.evaluate(() => {
    const fs = [...document.querySelectorAll("footer")];
    const f = fs.find((x) => (x.innerText ?? "").includes("MIT License")) ?? fs[0];
    if (!f) return null;
    return {
      text: (f.innerText ?? "").replace(/\s+/g, " ").trim(),
      links: [...f.querySelectorAll("a")].map((a) => ({ text: a.textContent?.trim() ?? "", href: a.href })),
      fixed: getComputedStyle(f).position,
      count: fs.length,
    };
  });

  // 検品器の陽性対照(HC-080): 在るはずのないものを数える
  const bogus = await page.$$eval("button.plate-does-not-exist", (els) => els.length);

  await browser.close();
  return { plates, maskChanged, overflow, problems, bogus, stats, curveStats, footer };
}

/** ⑤ 摺りの散らばり(F-09 / G-09)。**画面に出ている数字をそのまま読む。** */
async function readSpread(browserType, base, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(new URL("suri/", base).toString(), { waitUntil: "load" });
  const designCount = await page.$$eval("#d option", (o) => o.length);
  const waitTable = () =>
    page.waitForFunction(() => document.querySelectorAll("table.suri tbody tr").length >= 2, null, {
      timeout: 240_000,
    });
  await waitTable();

  // **全図柄を測る。** 1 図柄の幅を代表値にしない —— 誤差棒は図柄ごとに違いうる
  const all = [];
  for (let i = 0; i < designCount; i++) {
    if (i > 0) {
      await page.selectOption("#d", String(i));
      await page.waitForFunction(() => document.querySelectorAll("table.suri tbody tr").length === 0, null, {
        timeout: 60_000,
      }).catch(() => {});
      await waitTable();
    }
    const label = await page.$eval("#d", (e) => e.options[e.selectedIndex].textContent?.trim() ?? "");
    const ns = await page.$$eval(".bignums .n", (els) => els.map((e) => Number(e.textContent)));
    const doubt = await page.$$eval("table.suri td.doubt", (els) => els.length);
    all.push({ label, deMedian: ns[0], deMax: ns[1], shareMedian: ns[2], shareMax: ns[3], doubt });
  }
  await page.selectOption("#d", "0");
  await waitTable();
  const nums = await page.$$eval(".bignums > div", (els) =>
    els.map((e) => ({
      n: e.querySelector(".n")?.textContent?.trim() ?? "",
      l: e.querySelector(".l")?.textContent?.trim() ?? "",
    })),
  );
  const rows = await page.$$eval("table.suri tbody tr", (trs) =>
    trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => (td.textContent ?? "").replace(/\s+/g, " ").trim())),
  );
  const cols = await page.$$eval("table.suri thead th", (ths) => ths.map((t) => t.textContent?.trim() ?? ""));
  const claim = await page.$eval(".headline p", (e) => (e.textContent ?? "").replace(/\s+/g, " ").trim());
  const w = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  await browser.close();
  return { nums, rows, cols, claim, problems, all, overflow: w.scrollW > w.clientW + 1 };
}

function hueOf(meta) {
  const m = meta.match(/h\s+([-\d.]+)°/);
  return m ? Number(m[1]) : NaN;
}

function circDiff(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

// 既定はローカルの out/(rewrite は模倣)。`--url https://…` を渡すと**本番経路**を検品する
// —— SPEC §2.7 の「見込み」を実測に変えるのはこちらである(HC-096)。
const urlArg = process.argv.indexOf("--url");
const target = urlArg > -1 ? process.argv[urlArg + 1] : null;
// 検品器自身の対照(HC-080)—— 規則が実際に撃てることを、対象に当てる前に確かめる
if (judgeFooter(CONFORMING_FOOTER).length !== 0) {
  console.error("フッタ規則が規約どおりのフッタを落とした。規則の側が壊れている。");
  process.exit(2);
}
if (judgeFooter({ ...CONFORMING_FOOTER, fixed: "static" }).length === 0) {
  console.error("フッタ規則が壊れたフッタを通した。規則の側が壊れている。");
  process.exit(2);
}

/**
 * **本番検品の前に「同じ版が配られているか」を確かめる。**
 *
 * 実測 2026-08-31(二度):commit status が `success` になった後でも、エッジが前の版を
 * 配っていることがある。その状態で検品を回すと「反映待ち」と「本当の不合格」が混ざる
 * —— 実際に、直したはずのフッタの逃げが 64px と報告され、置いたはずの .wasm が 404 になった。
 *
 * ローカルのビルド成果物が参照する CSS の指紋と、本番が返す HTML の指紋を突き合わせる。
 * **合格するまで検品を繰り返すのではなく、反映の確認を検品と分ける。**
 */
async function waitForSameBuild(url) {
  const local = await readFile(join(ROOT, "index.html"), "utf-8");
  const want = [...local.matchAll(/_next\/static\/css\/([a-z0-9]+)\.css/g)].map((m) => m[1]);
  if (want.length === 0) {
    console.log("指紋を取れなかった(ローカルの index.html に CSS 参照が無い)。反映確認を飛ばす");
    return;
  }
  for (let i = 1; i <= 10; i++) {
    const html = await (await fetch(url, { cache: "no-store" })).text();
    const got = [...html.matchAll(/_next\/static\/css\/([a-z0-9]+)\.css/g)].map((m) => m[1]);
    if (want.every((w) => got.includes(w))) {
      console.log(`反映を確認(CSS 指紋 ${want.join(",")} / ${i} 回目)`);
      return;
    }
    console.log(`反映待ち ${i}/10 —— 期待 ${want.join(",")} / 本番 ${got.join(",") || "(無し)"}`);
    await new Promise((r) => setTimeout(r, 15_000));
  }
  console.error("本番がローカルのビルドと違う版を配り続けている。**検品ではなく反映を疑うこと**");
  process.exit(3);
}

const server = target ? null : await serve();
const base = target ?? `http://127.0.0.1:${server.address().port}/`;
console.log(`検品対象: ${base}${target ? "(本番経路)" : "(ローカル out/ + rewrite の模倣)"}`);
if (target) await waitForSameBuild(base);
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

    // ---- フッタ規約
    // 変数名は ft。この下の G-07 が firefox の結果を f で持つので、重ねない
    const ft = r.footer;
    if (!ft) {
      fail.push(`${name}: footer が無い`);
    } else {
      console.log(`  フッタ(${ft.fixed}): ${ft.text}`);
      // 規則は scripts/footer-rule.mjs に置き、**対照つきで単体テストしてある**(T-021)。
      // 検品器の中に書くと、規則が壊れたときに誰も気づかない。
      for (const p of judgeFooter(ft)) fail.push(`${name}: フッタ — ${p}`);
    }
  }

  // ---- ⑤ 摺りの散らばり(F-09 / G-09)
  const sp = await readSpread(chromium, base, "chromium");
  console.log("[⑤ 摺りの散らばり]");
  for (const n of sp.nums) console.log(`  ${n.n.padStart(6)}  ${n.l}`);
  console.log(`  列: ${sp.cols.join(" | ")}`);
  for (const r of sp.rows) console.log(`  ${r.join("  |  ")}`);
  console.log(`  ${sp.claim}`);
  console.log("  --- 図柄ごとの幅 ---");
  for (const d of sp.all) {
    console.log(
      `  ${d.label.padEnd(34)} ΔE 中央 ${String(d.deMedian).padStart(5)} 最大 ${String(d.deMax).padStart(5)}` +
        ` / 面積比の幅 中央 ${String(d.shareMedian).padStart(5)} 最大 ${String(d.shareMax).padStart(5)} pt / 怪しい対応 ${d.doubt}`,
    );
  }
  if (sp.all.length < 3) fail.push(`suri: 図柄が 3 つ未満(${sp.all.length})`);
  if (sp.problems.length) fail.push(`suri: ${sp.problems.join(" / ")}`);
  if (sp.rows.length < 2) fail.push("suri: 版が 2 行未満");
  if (sp.overflow) fail.push("suri: 横に溢れた");
  if (sp.nums.length !== 4) fail.push(`suri: 見出しの数字が 4 つでない(${sp.nums.length})`);
  {
    // G-09 —— **表示の桁が、測った幅より細かくないこと。**
    // 幅(ポイント)を読み、面積比の表示から刻みを読み、単位 ≤ 幅 を確かめる
    const spreadPoints = Number(sp.nums[3]?.n);
    const shareCell = sp.rows[0]?.[1] ?? "";
    const m = shareCell.match(/^(\d+)(?:\.(\d+))?\s*%$/);
    if (!Number.isFinite(spreadPoints) || !m) {
      fail.push(`G-09: 幅または面積比を読めなかった(幅=${sp.nums[3]?.n} 面積比=${shareCell})`);
    } else {
      const unit = m[2] ? Math.pow(10, -m[2].length) : Number(m[1]) % 10 === 0 ? 10 : 1;
      console.log(`  [G-09] 面積比の幅 ${spreadPoints} ポイント / 表示の刻み ${unit} ポイント`);
      if (unit > spreadPoints + 1e-9) fail.push(`G-09: 刻み ${unit} が幅 ${spreadPoints} より粗い`);
      if (spreadPoints >= unit * 10) fail.push(`G-09: 刻み ${unit} が幅 ${spreadPoints} に対し細かすぎる`);
    }
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
  server?.close();
}

if (fail.length) {
  console.error("\n検品 NG:\n  " + fail.join("\n  "));
  process.exit(1);
}
console.log("\n検品 OK");
