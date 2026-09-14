// White-box test helper for this bundled image font, not a production endpoint or bypass.
// A local image challenge only deters basic scripts; throttling remains mandatory.
const fs = require("node:fs");
const path = require("node:path");
const glyphs = [...fs.readFileSync(path.join(__dirname, "../src/Cms.Services/LoginProtection.cs"), "utf8").matchAll(/"([01]{35})"/g)].map(m => m[1]);
function solve(image) {
  const svg = Buffer.from(image.split(",")[1], "base64").toString("utf8");
  const answer = [...svg.matchAll(/<path fill="[^\"]+" transform="[^\"]+" d="([^\"]+)"/g)].map(m => {
    const bits = Array(35).fill("0");
    for (const pixel of m[1].matchAll(/M(\d+) (\d+)h4v4h-4z/g)) bits[Number(pixel[2]) / 4 * 5 + Number(pixel[1]) / 4] = "1";
    const digit = glyphs.indexOf(bits.join(""));
    if (digit < 0) throw new Error("Unknown captcha test font");
    return String(digit + 2);
  }).join("");
  if (answer.length !== 6) throw new Error("Invalid captcha test image");
  return answer;
}
module.exports = { solve };
if (require.main === module) process.stdout.write(solve(fs.readFileSync(0, "utf8").trim()));
