import { json, requireAdmin, buildWhatsappMessage } from "../../_lib/utils.js";

export async function onRequestGet(context) {
  const denied = await requireAdmin(context);
  if (denied) return denied;
  const url = new URL(context.request.url);
  const eventId = url.searchParams.get("event_id");
  const status = url.searchParams.get("status");

  let sql = `SELECT r.*, e.title AS event_title, e.slug AS event_slug,
                    e.payme_id, e.payme_link, e.fps_id, e.fps_name, e.payment_note,
                    e.entry_fee, e.currency, e.whatsapp AS event_whatsapp
             FROM registrations r
             JOIN events e ON e.id = r.event_id`;
  const binds = [];
  const where = [];
  if (eventId) {
    where.push("r.event_id = ?");
    binds.push(Number(eventId));
  }
  if (status) {
    where.push("r.status = ?");
    binds.push(status);
  }
  if (where.length) sql += " WHERE " + where.join(" AND ");
  sql += " ORDER BY r.created_at DESC";

  const stmt = context.env.DB.prepare(sql);
  const rows = binds.length ? await stmt.bind(...binds).all() : await stmt.all();

  const list = (rows.results || []).map((r) => ({
    ...r,
    wa_message: buildWhatsappMessage(r, r),
  }));

  return json({ ok: true, registrations: list });
}
