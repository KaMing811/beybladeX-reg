import { json, publicEvent, countsFromRows } from "../_lib/utils.js";

export async function onRequestGet({ env }) {
  const events = await env.DB.prepare(
    "SELECT * FROM events ORDER BY event_date ASC, id ASC"
  ).all();

  const out = [];
  for (const row of events.results || []) {
    const raw = await env.DB.prepare(
      "SELECT status, COUNT(*) AS n FROM registrations WHERE event_id = ? GROUP BY status"
    )
      .bind(row.id)
      .all();
    const counts = countsFromRows(raw.results);
    out.push({ ...publicEvent(row), counts });
  }
  return json({ ok: true, events: out });
}
