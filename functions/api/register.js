import {
  json,
  error,
  readJson,
  cleanText,
  randomToken,
  publicEvent,
  parseCategories,
  nowIso,
  countsFromRows,
} from "../_lib/utils.js";

export async function onRequestPost({ env, request }) {
  const body = await readJson(request);
  if (!body) return error("無效資料");

  if (cleanText(body.website, 80)) return error("無法提交", 400);

  const slug = cleanText(body.slug, 80);
  const display_name = cleanText(body.display_name, 40);
  const real_name = cleanText(body.real_name, 40);
  const whatsapp = cleanText(body.whatsapp, 30).replace(/\s+/g, "");
  const category = cleanText(body.category, 40);
  const notes = cleanText(body.notes, 300);

  if (!slug) return error("缺少比賽");
  if (!display_name) return error("請填 Belader 名稱");
  if (!whatsapp || whatsapp.length < 8) return error("請填有效 WhatsApp 電話");

  const event = await env.DB.prepare("SELECT * FROM events WHERE slug = ?").bind(slug).first();
  if (!event) return error("找不到呢場比賽", 404);

  const deadline = event.registration_deadline;
  const open = Number(event.registration_open) === 1 && (!deadline || new Date(deadline).getTime() >= Date.now());
  if (!open) return error("呢場比賽已截止報名");

  const cats = parseCategories(event.categories);
  const chosen = category || cats[0];
  if (cats.length && !cats.includes(chosen)) return error("組別無效");

  const raw = await env.DB.prepare(
    "SELECT status, COUNT(*) AS n FROM registrations WHERE event_id = ? GROUP BY status"
  )
    .bind(event.id)
    .all();
  const counts = countsFromRows(raw.results);
  const taken = counts.taken;

  const dup = await env.DB.prepare(
    `SELECT id FROM registrations
     WHERE event_id = ? AND whatsapp = ? AND status NOT IN ('rejected','cancelled')`
  )
    .bind(event.id, whatsapp)
    .first();
  if (dup) return error("呢個 WhatsApp 已經報名過呢場比賽");

  const token = randomToken();
  const status = taken >= event.capacity ? "waitlist" : "pending";

  await env.DB.prepare(
    `INSERT INTO registrations
      (event_id, token, display_name, real_name, whatsapp, category, notes, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(event.id, token, display_name, real_name, whatsapp, chosen, notes, status, nowIso(), nowIso())
    .run();

  return json({
    ok: true,
    token,
    status,
    event: publicEvent(event),
    message:
      status === "waitlist"
        ? "名額已滿，你已進入候補名單。主辦確認後先會提供付款方式。"
        : "已收到報名，請等主辦確認。確認後先會提供付款方式。",
  });
}
