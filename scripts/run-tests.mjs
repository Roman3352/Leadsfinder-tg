import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const files = readdirSync(__dirname)
  .filter((f) => f.startsWith("test-") && f.endsWith(".ts"))
  .sort();

let totalPass = 0;
let totalFail = 0;
let failedFiles = [];

for (const file of files) {
  console.log(`\n=== ${file} ===`);
  const res = spawnSync(process.execPath, ["--experimental-strip-types", path.join(__dirname, file)], {
    stdio: "inherit",
    env: process.env,
  });
  if (res.status !== 0) failedFiles.push(file);
}

console.log("\n============================");
if (failedFiles.length === 0) {
  console.log(`✅ All test files passed (${files.length} files)`);
  process.exit(0);
} else {
  console.log(`❌ ${failedFiles.length} test file(s) failed: ${failedFiles.join(", ")}`);
  process.exit(1);
}
