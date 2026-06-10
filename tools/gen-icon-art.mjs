// gen-icon-art.mjs — generate candidate app icons (OK-pinch hand + play
// elements) via the OpenAI Images API. The chosen candidate is then resized
// into icons/icon{16,32,48,128}.png (see tools/resize-icons.ps1).
//
// Usage (PowerShell, key via env, never printed):
//   $env:OPENAI_API_KEY = "<key>"; node tools/gen-icon-art.mjs
//
// Output: assets/store/icon-candidate-{a,b}.png (1024x1024, transparent)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "assets", "store");

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) {
  console.error("OPENAI_API_KEY is not set");
  process.exit(1);
}

const JOBS = [
  {
    file: "icon-candidate-a.png",
    prompt:
      "Flat modern vector app icon: a rounded-square badge with a smooth " +
      "purple-to-blue diagonal gradient (#7c3aed to #2563eb). Centered on it, " +
      "a single hand making the OK pinch gesture — thumb and index fingertip " +
      "touching to form a circle, middle/ring/pinky fingers pointing up — " +
      "light neutral skin with bold dark outlines. Inside the circle formed " +
      "by the fingers sits a small solid white video play triangle. Minimal, " +
      "crisp, no text, no watermark; transparent background outside the " +
      "rounded square.",
  },
  {
    file: "icon-candidate-b.png",
    prompt:
      "Flat modern vector icon on a fully transparent background: a single " +
      "hand making the OK pinch gesture (thumb and index touching in a " +
      "circle, three fingers up), light neutral skin, bold dark outlines, " +
      "with a solid white video play triangle inside the finger circle and a " +
      "short horizontal purple-to-blue gradient progress bar with a round " +
      "knob passing behind the hand. Minimal, crisp, no text, no watermark.",
  },
];

async function generate(job) {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: "gpt-image-1.5",
      prompt: job.prompt,
      size: "1024x1024",
      quality: "high",
      background: "transparent",
      output_format: "png",
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const buf = Buffer.from(data.data[0].b64_json, "base64");
  fs.writeFileSync(path.join(OUT_DIR, job.file), buf);
  console.log(`wrote ${job.file} (${(buf.length / 1024).toFixed(0)} KB)`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const job of JOBS) await generate(job);
console.log("done");
