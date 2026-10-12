// Refresh the self-hosted UI glyph subset from the official Google Fonts service.
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const request = (url, options = {}) =>
  fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
const files = await readdir("src", { recursive: true });
let content = "";
for (const file of files.filter((file) => file.endsWith(".ts")))
  content += await readFile(`src/${file}`, "utf8");
const text = [
  ...new Set([...content].filter((char) => char.codePointAt(0) > 127)),
]
  .sort()
  .join("");
const query = new URLSearchParams({
  family: "Noto Sans SC:wght@400..600",
  display: "swap",
  text,
});
const cssResponse = await request(
  `https://fonts.googleapis.com/css2?${query}`,
  {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    },
  },
);
if (!cssResponse.ok) throw new Error(`Font CSS HTTP ${cssResponse.status}`);
const css = await cssResponse.text();
const url = css.match(/url\(([^)]+)\) format\('woff2'\)/)?.[1];
if (!url?.startsWith("https://fonts.gstatic.com/"))
  throw new Error(
    `Expected an official WOFF2 font URL, received: ${css.slice(0, 400)}`,
  );
const response = await request(url);
if (!response.ok) throw new Error(`Font download HTTP ${response.status}`);
const bytes = new Uint8Array(await response.arrayBuffer());
let license;
try {
  license = await readFile("public/fonts/OFL.txt", "utf8");
} catch {
  const licenseResponse = await request(
    "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt",
  );
  if (!licenseResponse.ok) throw new Error("Font license unavailable");
  license = await licenseResponse.text();
}
if (!license.includes("SIL OPEN FONT LICENSE"))
  throw new Error("Unexpected font license");
await mkdir("public/fonts", { recursive: true });
await writeFile("public/fonts/noto-sans-sc.woff2", bytes);
await writeFile("public/fonts/OFL.txt", license.replace(/[ \t]+$/gm, ""));
await writeFile(
  "public/fonts/provenance.json",
  JSON.stringify(
    {
      family: "Noto Sans SC",
      source: "https://github.com/google/fonts/tree/main/ofl/notosanssc",
      subsetAPI: "https://developers.google.com/fonts/docs/css2",
      glyphs: [...text].length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    null,
    2,
  ),
);
console.log(
  `Vendored ${bytes.length} bytes for ${[...text].length} UI glyphs.`,
);
