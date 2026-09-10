import {
  json,
  error,
  readJson,
  cleanText,
  requireAdmin,
  STATUSES,
  nowIso,
  buildWhatsappMessage,
} from "../../../_lib/utils.js";

export async function onRequestPatch(context) {
  const denied = await requireAdmin(context);
  if (denied) return denied;
  const id = Number(context.params.id);
  const body = await readJson(context.request);
  if (!body) return error("無效資料");

  const row = await context.env.DB.prepare("SELECT * FROM registrations WHERE id = ?").bind(id).first();
  if (!row) return error("找不到報名", 404);

  const nextStatus = body.status ? cleanText(body.status, 20) : row.status;
  if (!STATUSES.includes(nextStatus)) return error("狀態無效");

  const admin_note = body.admin_note != null ? cleanText(body.admin_note, 300) : row.admin_note;
  const paid_ref = body.paid_ref != null ? cleanText(body.paid_ref, 80) : row.paid_ref;

  let confirmed_at = row.confirmed_at;
  let paid_at = row.paid_at;
  if (nextStatus === "confirmed" && !confirmed_at) confirmed_at = nowIso();
  if (nextStatus === "paid") {
    paid_at = nowIso();
    if (!confirmed_at) confirmed_at = nowIso();
  }

  await context.env.DB.prepare(
    `UPDATE registrations
     SET status=?, admin_note=?, paid_ref=?, confirmed_at=?, paid_at=?, updated_at=?
     WHERE id=?`
  )
    .bind(nextStatus, admin_note, paid_ref, confirmed_at, paid_at, nowIso(), id)
    .run();

  const updated = await context.env.DB.prepare("SELECT * FROM registrations WHERE id = ?").bind(id).first();
  const event = await context.env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(row.event_id).first();

  return json({
    ok: true,
    registration: updated,
    wa_message: buildWhatsappMessage(event, updated),
  });
}
