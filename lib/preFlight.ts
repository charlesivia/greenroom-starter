import { createHash } from "node:crypto";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "../db";
import {
  agencies,
  agents,
  artists,
  dealClarifications,
  deals,
  settlements,
  shows,
  venues,
  type Recoup,
} from "../db/schema";

const MODEL = "gpt-4o-mini-2024-07-18";

export type MarketingRecoupCapRisk = {
  riskClass: "marketing_recoup_cap";
  severity: "high" | "medium";
  leadSentence: string;
  detectedPhraseFromDeal: string;
  suggestedClarification: string;
  citationShowIds: string[];
};

export type PreFlightDetectionContext = Awaited<
  ReturnType<typeof getShowContextForDetection>
>;

type RawModelRisk = {
  riskClass: "marketing_recoup_cap";
  detectedPhraseFromDeal: string;
  citationShowIds: string[];
};

type RawModelResponse = {
  risks: RawModelRisk[];
};

function todayLocalDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addMonths(dateString: string, months: number) {
  const [year, month, day] = dateString.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  d.setMonth(d.getMonth() + months);
  const outYear = d.getFullYear();
  const outMonth = String(d.getMonth() + 1).padStart(2, "0");
  const outDay = String(d.getDate()).padStart(2, "0");
  return `${outYear}-${outMonth}-${outDay}`;
}

function amountFromMarketingRecoupPhrase(phrase: string) {
  const amountMatch = phrase.match(/\$([\d,]+(?:\.\d+)?)/);
  if (!amountMatch) return null;
  return Number(amountMatch[1].replace(/,/g, ""));
}

function formatMoneyNumber(value: number) {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
}

function formatShortShowDate(dateString: string) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(year, month - 1, day));
}

function marketingRecoupCapQuestion(input: {
  showDate: string;
  recoupAmount: number;
  expenseCap: number;
}) {
  return (
    `Quick clarification before ${formatShortShowDate(input.showDate)}: ` +
    `is the $${formatMoneyNumber(input.recoupAmount)} marketing recoup ` +
    `inside or outside the $${formatMoneyNumber(input.expenseCap)} expense cap?`
  );
}

function normalizedPhrase(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function containsLiteralSubstring(prose: string, phrase: string) {
  return prose.toLowerCase().includes(phrase.toLowerCase());
}

function containsMarketingRecoupSignal(value: string) {
  const normalized = value.toLowerCase();
  return normalized.includes("recoup") || normalized.includes("marketing");
}

export async function getShowContextForDetection(showId: string) {
  const rows = await db
    .select({
      show: shows,
      deal: deals,
      artist: artists,
      agent: agents,
      agency: agencies,
      settlement: settlements,
      venue: venues,
    })
    .from(shows)
    .leftJoin(deals, eq(deals.showId, shows.id))
    .leftJoin(artists, eq(shows.artistId, artists.id))
    .leftJoin(agents, eq(artists.agentId, agents.id))
    .leftJoin(agencies, eq(agents.agencyId, agencies.id))
    .leftJoin(settlements, eq(settlements.showId, shows.id))
    .leftJoin(venues, eq(shows.venueId, venues.id))
    .where(eq(shows.id, showId));

  if (rows.length === 0) {
    throw new Error(`Show not found: ${showId}`);
  }
  const row = rows[0];
  if (!row.deal) {
    throw new Error(`Show has no deal: ${showId}`);
  }
  if (!row.venue) {
    throw new Error(`Show has no venue: ${showId}`);
  }

  const asOfDate = row.show.date < todayLocalDateString()
    ? row.show.date
    : todayLocalDateString();
  const windowStart = addMonths(asOfDate, -18);

  const recoupRows = await db
    .select({
      show: shows,
      artist: artists,
      agent: agents,
      agency: agencies,
      settlement: settlements,
    })
    .from(settlements)
    .innerJoin(shows, eq(settlements.showId, shows.id))
    .leftJoin(artists, eq(shows.artistId, artists.id))
    .leftJoin(agents, eq(artists.agentId, agents.id))
    .leftJoin(agencies, eq(agents.agencyId, agencies.id))
    .where(
      and(
        eq(shows.venueId, row.venue.id),
        gte(shows.date, windowStart),
        lte(shows.date, asOfDate),
      ),
    )
    .orderBy(desc(shows.date));

  const pastDisputes = recoupRows
    .filter((r) => r.show.id !== showId)
    .flatMap((r) => {
      if (!r.settlement.recoupsJson) return [];
      let recoups: Recoup[];
      try {
        const parsed = JSON.parse(r.settlement.recoupsJson);
        if (!Array.isArray(parsed)) return [];
        recoups = parsed;
      } catch {
        return [];
      }

      return recoups
        .filter(
          (recoup) =>
            recoup.category === "marketing" && recoup.status === "disputed",
        )
        .map((recoup) => ({
          showId: r.show.id,
          date: r.show.date,
          artistName: r.artist?.name ?? null,
          agentName: r.agent?.name ?? null,
          agencyName: r.agency?.name ?? null,
          recoupLabel: recoup.label,
          disputedAmount: recoup.amount,
          settlementStatus: r.settlement.status,
        }));
    })
    .slice(0, 8);

  return {
    target: {
      showId: row.show.id,
      date: row.show.date,
      venueName: row.venue.name,
      artistName: row.artist?.name ?? null,
      agentName: row.agent?.name ?? null,
      agencyName: row.agency?.name ?? null,
      agentProfileNote: row.agent?.preferencesNotes ?? null,
      deal: {
        id: row.deal.id,
        dealType: row.deal.dealType,
        guaranteeAmount: row.deal.guaranteeAmount,
        percentage: row.deal.percentage,
        percentageBasis: row.deal.percentageBasis,
        expenseCap: row.deal.expenseCap,
        hospitalityCap: row.deal.hospitalityCap,
        bonusesJson: row.deal.bonusesJson,
        dealNotesFreetext: row.deal.dealNotesFreetext ?? "",
      },
      settlementStatus: row.settlement?.status ?? null,
    },
    pastDisputes,
  };
}

export async function detectMarketingRecoupCapRisks(
  context: PreFlightDetectionContext,
): Promise<MarketingRecoupCapRisk[]> {
  const prose = context.target.deal.dealNotesFreetext;
  if (!prose || context.target.deal.expenseCap == null) return [];
  if (!containsMarketingRecoupSignal(prose)) return [];

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required to run pre-flight detection.");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.1,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "marketing_recoup_cap_detection",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["risks"],
            properties: {
              risks: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "riskClass",
                    "detectedPhraseFromDeal",
                    "citationShowIds",
                  ],
                  properties: {
                    riskClass: {
                      type: "string",
                      enum: ["marketing_recoup_cap"],
                    },
                    detectedPhraseFromDeal: { type: "string" },
                    citationShowIds: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      messages: [
        {
          role: "system",
          content: [
            "You detect only the marketing_recoup_cap risk class for Greenroom pre-flight deal review.",
            "Hard rules:",
            "1. Never invent values, dates, agency names, amounts, or show IDs.",
            "2. detectedPhraseFromDeal must be a literal substring of dealNotesFreetext.",
            "3. citationShowIds must come only from the provided pastDisputes input.",
            "4. Return strict JSON matching the schema.",
            "5. No prose explanations outside JSON.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "Return one risk only if the target deal prose includes a marketing recoup and the structured deal has an expense cap. Otherwise return an empty risks array.",
            target: context.target,
            pastDisputes: context.pastDisputes,
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${text}`);
  }

  const completion = await response.json();
  const message = completion.choices?.[0]?.message;
  if (message?.refusal) {
    throw new Error(`OpenAI refusal: ${message.refusal}`);
  }
  if (!message?.content) return [];

  const parsed = JSON.parse(message.content) as RawModelResponse;
  const citationIds = new Set(context.pastDisputes.map((d) => d.showId));
  const completePastDisputes = context.pastDisputes.filter(
    (d) => d.agencyName && d.date && typeof d.disputedAmount === "number",
  );

  return parsed.risks.flatMap((risk): MarketingRecoupCapRisk[] => {
    if (risk.riskClass !== "marketing_recoup_cap") return [];
    if (!containsLiteralSubstring(prose, risk.detectedPhraseFromDeal)) return [];
    if (!containsMarketingRecoupSignal(risk.detectedPhraseFromDeal)) return [];

    const allowedCitations = risk.citationShowIds.filter((id) =>
      citationIds.has(id),
    );
    const recoupAmount = amountFromMarketingRecoupPhrase(
      risk.detectedPhraseFromDeal,
    );
    const expenseCap = context.target.deal.expenseCap;
    if (expenseCap == null) return [];
    if (recoupAmount == null) return [];

    if (completePastDisputes.length > 0) {
      const cited =
        completePastDisputes.find((d) => allowedCitations.includes(d.showId)) ??
        completePastDisputes[0];

      return [
        {
          riskClass: "marketing_recoup_cap",
          severity: "high",
          leadSentence:
            `$${formatMoneyNumber(recoupAmount)} marketing recoup × ` +
            `$${formatMoneyNumber(expenseCap)} expense cap. Same combination ` +
            `contested at this venue with ${cited.agencyName} on ${cited.date} ` +
            `over a $${formatMoneyNumber(cited.disputedAmount)} recoup.`,
          detectedPhraseFromDeal: risk.detectedPhraseFromDeal,
          suggestedClarification: marketingRecoupCapQuestion({
            showDate: context.target.date,
            recoupAmount,
            expenseCap,
          }),
          citationShowIds: allowedCitations.length
            ? allowedCitations
            : [cited.showId],
        },
      ];
    }

    return [
      {
        riskClass: "marketing_recoup_cap",
        severity: "medium",
        leadSentence:
          `Marketing recoup × expense cap. Contested ${context.pastDisputes.length} ` +
          "times at this venue in the last 18 months.",
        detectedPhraseFromDeal: risk.detectedPhraseFromDeal,
        suggestedClarification: marketingRecoupCapQuestion({
          showDate: context.target.date,
          recoupAmount,
          expenseCap,
        }),
        citationShowIds: allowedCitations,
      },
    ];
  });
}

export async function persistMarketingRecoupCapRisks(
  context: PreFlightDetectionContext,
  risks: MarketingRecoupCapRisk[],
) {
  const existing = await db
    .select()
    .from(dealClarifications)
    .where(
      and(
        eq(dealClarifications.dealId, context.target.deal.id),
        eq(dealClarifications.riskClass, "marketing_recoup_cap"),
      ),
    );

  const existingPhrases = new Set(
    existing.map((row) => normalizedPhrase(row.detectedPhraseFromDeal)),
  );
  const inserted: string[] = [];

  for (const risk of risks) {
    if (existingPhrases.has(normalizedPhrase(risk.detectedPhraseFromDeal))) {
      continue;
    }

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
      detectedByModel: MODEL,
      status: "pending",
    });
    inserted.push(id);
    existingPhrases.add(normalizedPhrase(risk.detectedPhraseFromDeal));
  }

  return inserted;
}
