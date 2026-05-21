import { readFileSync, existsSync } from "node:fs";
import {
  detectMarketingRecoupCapRisks,
  getShowContextForDetection,
  persistMarketingRecoupCapRisks,
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

function truncate(value: string, max = 700) {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}... [truncated ${value.length - max} chars]`;
}

function contextForPrint(
  context: Awaited<ReturnType<typeof getShowContextForDetection>>,
) {
  return {
    ...context,
    target: {
      ...context.target,
      deal: {
        ...context.target.deal,
        dealNotesFreetext: truncate(context.target.deal.dealNotesFreetext),
        bonusesJson: context.target.deal.bonusesJson
          ? truncate(context.target.deal.bonusesJson, 300)
          : null,
      },
    },
  };
}

async function main() {
  loadEnvLocal();

  const args = process.argv.slice(2);
  const persist = args.includes("--persist");
  const showId = args.find((arg) => !arg.startsWith("--"));
  if (!showId) {
    throw new Error("Usage: npm run preflight:check -- <showId> [--persist]");
  }

  const context = await getShowContextForDetection(showId);
  console.log("=== LLM input context ===");
  console.log(JSON.stringify(contextForPrint(context), null, 2));

  const risks = await detectMarketingRecoupCapRisks(context);
  console.log("\n=== Detected risks ===");
  console.log(JSON.stringify(risks, null, 2));

  if (persist) {
    const inserted = await persistMarketingRecoupCapRisks(context, risks);
    console.log("\n=== Persisted clarification IDs ===");
    console.log(JSON.stringify(inserted, null, 2));
  }
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
