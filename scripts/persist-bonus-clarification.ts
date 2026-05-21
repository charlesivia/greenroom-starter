import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  detectBonusStructureDriftRisks,
  getShowContextForDetection,
} from "../lib/preFlight";
import { db, client } from "../db";
import { dealClarifications } from "../db/schema";
import { and, eq } from "drizzle-orm";

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

function normalizedPhrase(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

async function main() {
  loadEnvLocal();

  const showId = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!showId) {
    throw new Error("Usage: tsx scripts/persist-bonus-clarification.ts <showId>");
  }

  const context = await getShowContextForDetection(showId);
  const risks = await detectBonusStructureDriftRisks(context);
  const inserted: string[] = [];

  for (const risk of risks) {
    const existing = await db
      .select()
      .from(dealClarifications)
      .where(
        and(
          eq(dealClarifications.dealId, context.target.deal.id),
          eq(dealClarifications.riskClass, risk.riskClass),
        ),
      );
    const exists = existing.some(
      (row) =>
        normalizedPhrase(row.detectedPhraseFromDeal) ===
        normalizedPhrase(risk.detectedPhraseFromDeal),
    );
    if (exists) continue;

    const hash = createHash("sha1")
      .update(
        `${context.target.deal.id}|${risk.riskClass}|${normalizedPhrase(risk.detectedPhraseFromDeal)}`,
      )
      .digest("hex")
      .slice(0, 10);
    const id = `clr_${context.target.deal.id}_${risk.riskClass}_${hash}`;

    await db.insert(dealClarifications).values({
      id,
      dealId: context.target.deal.id,
      riskClass: risk.riskClass,
      severity: risk.severity,
      leadSentence: risk.leadSentence,
      detectedPhraseFromDeal: risk.detectedPhraseFromDeal,
      suggestedClarification: risk.suggestedClarification,
      citationShowIds: JSON.stringify(risk.citationShowIds),
      detectedAt: new Date(),
      detectedByModel: "gpt-4o-mini-2024-07-18",
      status: "pending",
    });
    inserted.push(id);
  }

  console.log(JSON.stringify({ showId, inserted, risks }, null, 2));
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
