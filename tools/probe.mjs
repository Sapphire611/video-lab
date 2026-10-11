/* 取 PNG 指定坐标的颜色。我看不见图，靠这个确认「东西真的画出来了」。

   PNG 路径按当前目录解析（本脚本不参与期目录那套解析），
   所以从仓库根跑要给全路径：
     node tools/probe.mjs videos/001-mbti-funcs/build/preview/s3_t5_9.png 960,596 100,100
*/
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const [png, ...rest] = process.argv.slice(2);
const pts = rest.map((s) => s.split(",").map(Number));

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
const b64 = fs.readFileSync(png).toString("base64");

const res = await page.evaluate(async ({ b64, pts }) => {
  const img = new Image();
  img.src = "data:image/png;base64," + b64;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const at = (x, y) => {
    const d = ctx.getImageData(x, y, 1, 1).data;
    return "#" + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("");
  };
  return { w: img.width, h: img.height, out: pts.map(([x, y]) => [x, y, at(x, y)]) };
}, { b64, pts });

console.log(`${path.basename(png)}  ${res.w}x${res.h}`);
for (const [x, y, hex] of res.out) console.log(`  (${x},${y})  ${hex}`);
await browser.close();
