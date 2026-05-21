/**
 * Server-side query helpers.
 */

import { db } from "@/db";
import {
  shows,
  artists,
  agents,
  agencies,
  deals,
  dealClarifications,
  ticketSales,
  comps,
  expenses,
  settlements,
  venues,
  type Recoup,
  type DealClarification,
} from "@/db/schema";
import { desc, asc, eq, sql, lte, gte, and } from "drizzle-orm";

function todayDateString(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function localDateString(offsetDays = 0): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const severityRank: Record<DealClarification["severity"], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export async function getAllShows() {
  return db
    .select({
      show: shows,
      artist: artists,
      agent: agents,
      deal: deals,
      settlement: settlements,
    })
    .from(shows)
    .leftJoin(artists, eq(shows.artistId, artists.id))
    .leftJoin(agents, eq(artists.agentId, agents.id))
    .leftJoin(deals, eq(deals.showId, shows.id))
    .leftJoin(settlements, eq(settlements.showId, shows.id))
    .where(lte(shows.date, todayDateString()))
    .orderBy(asc(shows.date));
}

export async function getShowById(id: string) {
  const rows = await db
    .select({
      show: shows,
      artist: artists,
      agent: agents,
      agency: agencies,
      deal: deals,
      settlement: settlements,
      venue: venues,
    })
    .from(shows)
    .leftJoin(artists, eq(shows.artistId, artists.id))
    .leftJoin(agents, eq(artists.agentId, agents.id))
    .leftJoin(agencies, eq(agents.agencyId, agencies.id))
    .leftJoin(deals, eq(deals.showId, shows.id))
    .leftJoin(settlements, eq(settlements.showId, shows.id))
    .leftJoin(venues, eq(shows.venueId, venues.id))
    .where(eq(shows.id, id));

  if (rows.length === 0) return null;
  const row = rows[0];

  const [showTicketSales, showExpenses, showComps, clarifications] =
    await Promise.all([
      db
        .select()
        .from(ticketSales)
        .where(eq(ticketSales.showId, id))
        .orderBy(desc(ticketSales.capturedAt)),
      db
        .select()
        .from(expenses)
        .where(eq(expenses.showId, id))
        .orderBy(asc(expenses.enteredAt)),
      db.select().from(comps).where(eq(comps.showId, id)),
      row.deal
        ? getClarificationsForDeal(row.deal.id)
        : Promise.resolve({
            active: [],
            resolved: [],
            awaitingReplyCount: 0,
          }),
    ]);

  let recoups: Recoup[] = [];
  if (row.settlement?.recoupsJson) {
    try {
      const parsed = JSON.parse(row.settlement.recoupsJson);
      if (Array.isArray(parsed)) recoups = parsed;
    } catch {
      // Malformed JSON — ignore
    }
  }

  return {
    ...row,
    ticketSales: showTicketSales,
    expenses: showExpenses,
    comps: showComps,
    recoups,
    clarifications,
  };
}

export type ShowWithRelations = NonNullable<
  Awaited<ReturnType<typeof getShowById>>
>;

export async function getThisWeekPreFlightQueue() {
  const windowStart = localDateString(0);
  const windowEnd = localDateString(7);

  const rows = await db
    .select({
      show: shows,
      artist: artists,
      clarification: dealClarifications,
    })
    .from(shows)
    .leftJoin(artists, eq(shows.artistId, artists.id))
    .leftJoin(deals, eq(deals.showId, shows.id))
    .leftJoin(dealClarifications, eq(dealClarifications.dealId, deals.id))
    .where(and(gte(shows.date, windowStart), lte(shows.date, windowEnd)))
    .orderBy(asc(shows.date));

  const showMap = new Map<
    string,
    {
      showId: string;
      date: string;
      artistName: string;
      unresolved: DealClarification[];
    }
  >();

  for (const row of rows) {
    const existing =
      showMap.get(row.show.id) ??
      {
        showId: row.show.id,
        date: row.show.date,
        artistName: row.artist?.name ?? "Unknown artist",
        unresolved: [],
      };

    if (
      row.clarification &&
      (row.clarification.status === "pending" ||
        row.clarification.status === "sent_to_agent")
    ) {
      existing.unresolved.push(row.clarification);
    }

    showMap.set(row.show.id, existing);
  }

  const items = Array.from(showMap.values())
    .flatMap((show) => {
      if (show.unresolved.length === 0) return [];

      const sorted = [...show.unresolved].sort((a, b) => {
        const severityDelta = severityRank[b.severity] - severityRank[a.severity];
        if (severityDelta !== 0) return severityDelta;
        return b.detectedAt.getTime() - a.detectedAt.getTime();
      });
      const highest = sorted[0];

      return [
        {
          showId: show.showId,
          date: show.date,
          artistName: show.artistName,
          leadSentence: highest.leadSentence,
          severity: highest.severity,
          status: highest.status,
          otherUnresolvedCount: sorted.length - 1,
        },
      ];
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    checkedShowCount: showMap.size,
    items,
  };
}

export async function getClarificationsForDeal(dealId: string) {
  const rows = await db
    .select()
    .from(dealClarifications)
    .where(eq(dealClarifications.dealId, dealId));

  const byTimestampDesc = (
    a: { detectedAt: Date; resolvedAt?: Date | null },
    b: { detectedAt: Date; resolvedAt?: Date | null },
  ) =>
    (b.resolvedAt?.getTime() ?? b.detectedAt.getTime()) -
    (a.resolvedAt?.getTime() ?? a.detectedAt.getTime());

  const active = rows
    .filter((row) => row.status === "pending" || row.status === "sent_to_agent")
    .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());

  const resolved = rows
    .filter(
      (row) =>
        row.status === "resolved" || row.status === "dismissed_by_booker",
    )
    .sort(byTimestampDesc);

  return {
    active,
    resolved,
    awaitingReplyCount: active.filter((row) => row.status === "sent_to_agent")
      .length,
  };
}

/** All artists with show counts. */
export async function getAllArtists() {
  return db
    .select({
      artist: artists,
      agent: agents,
      agency: agencies,
      showCount: sql<number>`count(${shows.id})`.as("show_count"),
      lastShowDate: sql<string | null>`max(${shows.date})`.as("last_show_date"),
    })
    .from(artists)
    .leftJoin(agents, eq(artists.agentId, agents.id))
    .leftJoin(agencies, eq(agents.agencyId, agencies.id))
    .leftJoin(shows, eq(shows.artistId, artists.id))
    .groupBy(artists.id, agents.id, agencies.id)
    .orderBy(desc(sql`count(${shows.id})`), asc(artists.name));
}

/** Aggregates for the reports page. */
export async function getReports() {
  const today = todayDateString();

  const allShowsRows = await db.select().from(shows);
  const pastShowIds = new Set(
    allShowsRows.filter((s) => s.date <= today).map((s) => s.id),
  );

  const allDealsRows = await db.select().from(deals);
  const pastDeals = allDealsRows.filter((d) => pastShowIds.has(d.showId));

  const allSettlementsRows = await db.select().from(settlements);
  const pastSettlements = allSettlementsRows.filter((s) =>
    pastShowIds.has(s.showId),
  );

  const allCompsRows = await db.select().from(comps);
  const pastComps = allCompsRows.filter((c) => pastShowIds.has(c.showId));

  const dealTypeCounts: Record<string, number> = {};
  for (const d of pastDeals) {
    dealTypeCounts[d.dealType] = (dealTypeCounts[d.dealType] ?? 0) + 1;
  }

  const totalDeals = pastDeals.length;
  const supportedTypes = ["flat", "percentage_of_gross"];
  const supportedCount = pastDeals.filter((d) =>
    supportedTypes.includes(d.dealType),
  ).length;
  const inAppToolUsageRate = totalDeals > 0 ? supportedCount / totalDeals : 0;

  const settlementStatus: Record<string, number> = {};
  for (const s of pastSettlements) {
    settlementStatus[s.status] = (settlementStatus[s.status] ?? 0) + 1;
  }

  const totalSettlements = pastSettlements.length;
  const disputedRate =
    totalSettlements > 0
      ? (settlementStatus.disputed ?? 0) / totalSettlements
      : 0;

  const totalGross = pastSettlements.reduce(
    (sum, s) => sum + (s.grossBoxOffice ?? 0),
    0,
  );
  const totalToArtists = pastSettlements.reduce(
    (sum, s) => sum + (s.totalToArtist ?? 0),
    0,
  );

  const showCount = pastShowIds.size;
  const settledCount = pastShowIds.size;

  // Bonuses
  const dealsWithBonuses = pastDeals.filter((d) => d.bonusesJson).length;

  // Recoups
  let totalRecoupValue = 0;
  let disputedRecoupValue = 0;
  let settlementsWithRecoups = 0;
  for (const s of pastSettlements) {
    if (!s.recoupsJson) continue;
    try {
      const recoups = JSON.parse(s.recoupsJson) as Recoup[];
      if (!Array.isArray(recoups) || recoups.length === 0) continue;
      settlementsWithRecoups++;
      for (const r of recoups) {
        totalRecoupValue += r.amount;
        if (r.status === "disputed") disputedRecoupValue += r.amount;
      }
    } catch {
      // skip
    }
  }

  // Comps
  const totalCompTickets = pastComps.reduce((s, c) => s + c.count, 0);
  const totalCompFaceValue = pastComps.reduce(
    (s, c) => s + c.count * c.faceValue,
    0,
  );
  const compsByCategory: Record<string, number> = {};
  for (const c of pastComps) {
    compsByCategory[c.category] = (compsByCategory[c.category] ?? 0) + c.count;
  }

  return {
    dealTypeCounts,
    totalDeals,
    inAppToolUsageRate,
    settlementStatus,
    totalSettlements,
    disputedRate,
    totalGross,
    totalToArtists,
    showCount,
    settledCount,
    dealsWithBonuses,
    totalRecoupValue,
    disputedRecoupValue,
    settlementsWithRecoups,
    totalCompTickets,
    totalCompFaceValue,
    compsByCategory,
  };
}

export type Reports = Awaited<ReturnType<typeof getReports>>;
