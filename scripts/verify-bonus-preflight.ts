import { readFileSync, existsSync } from "node:fs";
import {
  detectBonusStructureDriftRisks,
  getShowContextForDetection,
} from "../lib/preFlight";
import { client } from "../db";

function loadEnvLocal() {
  const path = ".env.local";
  if (!existsSync(path)) return;

  const raw = readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] != null) continue;

    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function main() {
  loadEnvLocal();

  const showId = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!showId) {
    throw new Error("Usage: npm run preflight:check:bonus -- <showId>");
  }

  const context = await getShowContextForDetection(showId);
  const risks = await detectBonusStructureDriftRisks(context);
  console.log(JSON.stringify(risks, null, 2));
}

main()
  .then(() => {
    client.close();
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    client.close();
    process.exit(1);
  });
