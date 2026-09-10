import { json, error, publicEvent, countsFromRows } from "../../_lib/utils.js";

export async function onRequestGet({ env, params }) {
  const row = await env.DB.prepare("SELECT * FROM events WHERE slug = ?")
    .bind(params.slug)
    .first();
  if (!row) return error("找不到呢場比賽", 404);

  const raw = await env.DB.prepare(
    "SELECT status, COUNT(*) AS n FROM registrations WHERE event_id = ? GROUP BY status"
  )
    .bind(row.id)
    .all();
  const counts = countsFromRows(raw.results);

  let public_list = [];
  if (Number(row.show_public_list) === 1) {
    const list = await env.DB.prepare(
      `SELECT display_name, category, status, created_at
       FROM registrations
       WHERE event_id = ? AND status IN ('pending','confirmed','paid','waitlist')
       ORDER BY created_at ASC`
    )
      .bind(row.id)
      .all();
    public_list = (list.results || []).map((r) => ({
      display_name: r.display_name,
      category: r.category,
      status: r.status === "paid" || r.status === "confirmed" ? "confirmed" : r.status,
    }));
  }

  return json({
    ok: true,
    event: { ...publicEvent(row), counts },
    public_list,
  });
}
