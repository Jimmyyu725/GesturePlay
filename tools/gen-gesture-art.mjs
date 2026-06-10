// gen-gesture-art.mjs — generate the three gesture illustrations used by the
// store screenshots, via the OpenAI Images API.
//
// Usage (PowerShell, key passed via env, never printed):
//   $env:OPENAI_API_KEY = "<key>"; node tools/gen-gesture-art.mjs
//
// Output: assets/store/gesture-{pinch,fist,palm}.png (1024x1024, transparent)
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

// Same style suffix for all three so they read as one set.
const STYLE =
  "Flat modern vector illustration, bold clean dark outlines, neutral light " +
  "skin tone, subtle purple-to-blue gradient shading on the sleeve/cuff, " +
  "centered composition, no text, no watermark, transparent background.";

const JOBS = [
  {
    file: "gesture-pinch.png",
    prompt:
      "A single right hand seen from the front making a precise pinch: thumb " +
      "and index fingertip touching to form a small O, while the middle, ring " +
      "and pinky fingers point straight up, clearly extended and separated. " +
      STYLE,
  },
  {
    file: "gesture-fist.png",
    prompt:
      "A single right hand seen from the front as a firmly closed fist, " +
      "knuckles facing the viewer, thumb wrapped over the fingers. " + STYLE,
  },
  {
    file: "gesture-palm.png",
    prompt:
      "A single right hand seen from the front as a relaxed open palm, all " +
      "five fingers extended and slightly apart, facing the viewer. " + STYLE,
  },
];

// Try the newest image model first, then fall back.
const MODELS = ["gpt-image-1.5", "gpt-image-1"];

async function generate(job) {
  let lastErr = null;
  for (const model of MODELS) {
    try {
      const res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${KEY}`,
        },
        body: JSON.stringify({
          model: model,
          prompt: job.prompt,
          size: "1024x1024",
          quality: "medium",
          background: "transparent",
          output_format: "png",
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${model} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      const data = await res.json();
      const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
      if (!b64) throw new Error(`${model} -> no b64_json in response`);
      const buf = Buffer.from(b64, "base64");
      fs.writeFileSync(path.join(OUT_DIR, job.file), buf);
      console.log(`wrote ${job.file} (${(buf.length / 1024).toFixed(0)} KB, model ${model})`);
      return;
    } catch (e) {
      lastErr = e;
      console.error(`attempt failed: ${e.message}`);
    }
  }
  throw lastErr;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const job of JOBS) {
  await generate(job);
}
console.log("done");
