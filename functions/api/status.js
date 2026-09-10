import { json, error, publicRegistration } from "../_lib/utils.js";

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const token = (url.searchParams.get("token") || "").trim();
  if (!token) return error("缺少 token");

  const row = await env.DB.prepare("SELECT * FROM registrations WHERE token = ?").bind(token).first();
  if (!row) return error("找不到呢份報名", 404);

  const event = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(row.event_id).first();
  return json({ ok: true, registration: publicRegistration(row, event) });
}
