import {
  json,
  error,
  readJson,
  cleanText,
  slugify,
  parseCategories,
  adminEvent,
  requireAdmin,
  nowIso,
} from "../../../_lib/utils.js";

export async function onRequestPut(context) {
  const denied = await requireAdmin(context);
  if (denied) return denied;
  const id = Number(context.params.id);
  const body = await readJson(context.request);
  if (!body) return error("無效資料");

  const existing = await context.env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
  if (!existing) return error("找不到比賽", 404);

  const title = cleanText(body.title, 80) || existing.title;
  let slug = slugify(body.slug || existing.slug);
  if (!slug) slug = existing.slug;

  const clash = await context.env.DB.prepare(
    "SELECT id FROM events WHERE slug = ? AND id != ?"
  )
    .bind(slug, id)
    .first();
  if (clash) return error("Slug 已存在");

  await context.env.DB.prepare(
    `UPDATE events SET
      slug=?, title=?, subtitle=?, venue=?, address=?, event_date=?, start_time=?, end_time=?,
      description=?, rules=?, categories=?, capacity=?, entry_fee=?, currency=?,
      payme_id=?, payme_link=?, fps_id=?, fps_name=?, payment_note=?, whatsapp=?,
      registration_open=?, registration_deadline=?, show_public_list=?, updated_at=?
     WHERE id=?`
  )
    .bind(
      slug,
      title,
      cleanText(body.subtitle, 120),
      cleanText(body.venue, 80),
      cleanText(body.address, 160),
      cleanText(body.event_date, 20) || existing.event_date,
      cleanText(body.start_time, 10),
      cleanText(body.end_time, 10),
      cleanText(body.description, 2000),
      cleanText(body.rules, 2000),
      JSON.stringify(parseCategories(body.categories)),
      Number(body.capacity) || existing.capacity,
      Number(body.entry_fee ?? existing.entry_fee),
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
      nowIso(),
      id
    )
    .run();

  const row = await context.env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
  return json({ ok: true, event: adminEvent(row) });
}

export async function onRequestDelete(context) {
  const denied = await requireAdmin(context);
  if (denied) return denied;
  const id = Number(context.params.id);
  await context.env.DB.prepare("DELETE FROM registrations WHERE event_id = ?").bind(id).run();
  await context.env.DB.prepare("DELETE FROM events WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
