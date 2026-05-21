import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.DATABASE_URL ?? "file:./data/greenroom.db",
});

type Row = Record<string, unknown>;

function value(row: Row, key: string) {
  return row[key] == null ? "" : String(row[key]);
}

function money(raw: unknown) {
  if (raw == null) return "";
  return Number(raw).toFixed(2);
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

async function all(sql: string) {
  const result = await db.execute(sql);
  return result.rows as Row[];
}

async function main() {
  section("Venue check");
  for (const row of await all(`
  select
    v.name as venue,
    count(s.id) as show_count,
    min(s.date) as first_show_date,
    max(s.date) as last_show_date
  from venues v
  left join shows s on s.venue_id = v.id
  where v.name = 'The Crescent'
  group by v.id, v.name
`)) {
    console.log(`venue: ${value(row, "venue")}`);
    console.log(`shows: ${value(row, "show_count")}`);
    console.log(
      `date_range: ${value(row, "first_show_date")} to ${value(row, "last_show_date")}`,
    );
  }

  section("Deal type mix");
  for (const row of await all(`
  select
    coalesce(d.deal_type, '(missing deal)') as deal_type,
    count(s.id) as count
  from shows s
  left join deals d on d.show_id = s.id
  group by coalesce(d.deal_type, '(missing deal)')
  order by count desc, deal_type asc
`)) {
    console.log(`${value(row, "deal_type")}: ${value(row, "count")}`);
  }

  section("Lifecycle counts");
  for (const row of await all(`
  select
    status,
    count(*) as count
  from settlements
  group by status
  order by count desc, status asc
`)) {
    console.log(`${value(row, "status")}: ${value(row, "count")}`);
  }

  section("Asymmetric sign-off check");
  const signoffRows = await all(`
  select
    s.id as show_id,
    s.date as show_date,
    a.name as agent_name,
    d.deal_type,
    st.total_to_artist,
    st.signoff_text
  from settlements st
  join shows s on s.id = st.show_id
  left join deals d on d.show_id = s.id
  left join artists ar on ar.id = s.artist_id
  left join agents a on a.id = ar.agent_id
  where st.status in ('disputed', 'revised')
  order by s.date asc, s.id asc
`);
  if (signoffRows.length === 0) {
    console.log("(none)");
  } else {
    for (const row of signoffRows) {
      console.log(`show_id: ${value(row, "show_id")}`);
      console.log(`date: ${value(row, "show_date")}`);
      console.log(`agent: ${value(row, "agent_name")}`);
      console.log(`deal_type: ${value(row, "deal_type")}`);
      console.log(`total_to_artist: ${money(row.total_to_artist)}`);
      console.log("signoff_text:");
      console.log(value(row, "signoff_text"));
      console.log("---");
    }
  }

  section("Marketing recoup dominance");
  const recoupRows = await all(`
  select
    s.id as show_id,
    s.date as show_date,
    st.status as settlement_status,
    st.recoups_json
  from settlements st
  join shows s on s.id = st.show_id
  where st.recoups_json is not null
  order by s.date asc, s.id asc
`);

  let printedRecoups = 0;
  for (const row of recoupRows) {
    let hasDisputedRecoup = false;
    try {
      const recoups = JSON.parse(value(row, "recoups_json"));
      hasDisputedRecoup =
        Array.isArray(recoups) &&
        recoups.some((recoup) => recoup?.status === "disputed");
    } catch {
      hasDisputedRecoup = value(row, "recoups_json").includes(
        `"status":"disputed"`,
      );
    }

    if (!hasDisputedRecoup) continue;

    printedRecoups++;
    console.log(`show_id: ${value(row, "show_id")}`);
    console.log(`date: ${value(row, "show_date")}`);
    console.log(`settlement_status: ${value(row, "settlement_status")}`);
    console.log("recoups_json:");
    console.log(value(row, "recoups_json"));
    console.log("---");
  }

  if (printedRecoups === 0) {
    console.log("(none)");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
