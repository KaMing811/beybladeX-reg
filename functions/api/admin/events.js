import {
  json,
  error,
  readJson,
  cleanText,
  slugify,
  parseCategories,
  adminEvent,
  countsFromRows,
  requireAdmin,
  nowIso,
} from "../../_lib/utils.js";

export async function onRequestGet(context) {
  const denied = await requireAdmin(context);
  if (denied) return denied;

  const events = await context.env.DB.prepare(
    "SELECT * FROM events ORDER BY event_date DESC, id DESC"
  ).all();

  const out = [];
  for (const row of events.results || []) {
    const raw = await context.env.DB.prepare(
      "SELECT status, COUNT(*) AS n FROM registrations WHERE event_id = ? GROUP BY status"
    )
      .bind(row.id)
      .all();
    out.push({ ...adminEvent(row), counts: countsFromRows(raw.results) });
  }
  return json({ ok: true, events: out });
}

export async function onRequestPost(context) {
  const denied = await requireAdmin(context);
  if (denied) return denied;
  const body = await readJson(context.request);
  if (!body) return error("無效資料");

  const title = cleanText(body.title, 80);
  if (!title) return error("請填比賽名稱");
  let slug = slugify(body.slug || title);
  if (!slug) slug = "event-" + Date.now();

  const exists = await context.env.DB.prepare("SELECT id FROM events WHERE slug = ?").bind(slug).first();
  if (exists) return error("Slug 已存在，請換一個");

  const cats = JSON.stringify(parseCategories(body.categories));
  const now = nowIso();

  const result = await context.env.DB.prepare(
    `INSERT INTO events (
      slug, title, subtitle, venue, address, event_date, start_time, end_time,
      description, rules, categories, capacity, entry_fee, currency,
      payme_id, payme_link, fps_id, fps_name, payment_note, whatsapp,
      registration_open, registration_deadline, show_public_list, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      slug,
      title,
      cleanText(body.subtitle, 120),
      cleanText(body.venue, 80),
      cleanText(body.address, 160),
      cleanText(body.event_date, 20) || now.slice(0, 10),
      cleanText(body.start_time, 10),
      cleanText(body.end_time, 10),
      cleanText(body.description, 2000),
      cleanText(body.rules, 2000),
      cats,
      Number(body.capacity) || 32,
      Number(body.entry_fee) || 0,
      cleanText(body.currency, 8) || "HKD",
      cleanText(body.payme_id, 40),
      cleanText(body.payme_link, 200),
      cleanText(body.fps_id, 40),
      cleanText(body.fps_name, 40),
      cleanText(body.payment_note, 400),
      cleanText(body.whatsapp, 30),
      body.registration_open === false || body.registration_open === 0 ? 0 : 1,
      cleanText(body.registration_deadline, 32),
      body.show_public_list ? 1 : 0,
      now,
      now
    )
    .run();

  return json({ ok: true, id: result.meta.last_row_id, slug });
}
