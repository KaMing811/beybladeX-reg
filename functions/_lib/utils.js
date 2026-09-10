export const STATUSES = ["pending", "confirmed", "paid", "waitlist", "rejected", "cancelled"];
export const PAYMENT_VISIBLE = new Set(["confirmed", "paid"]);

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });
}

export function error(message, status = 400) {
  return json({ ok: false, error: message }, status);
}

export function nowIso() {
  return new Date().toISOString();
}

export function slugify(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function randomToken() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function parseCategories(raw) {
  if (!raw) return ["公開組"];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed.map(String);
  } catch {}
  return String(raw)
    .split(/[,，|/]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function publicEvent(row) {
  if (!row) return null;
  const deadline = row.registration_deadline || "";
  const openFlag = Number(row.registration_open) === 1;
  const notExpired = !deadline || new Date(deadline).getTime() >= Date.now();
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle || "",
    venue: row.venue || "",
    address: row.address || "",
    event_date: row.event_date,
    start_time: row.start_time || "",
    end_time: row.end_time || "",
    description: row.description || "",
    rules: row.rules || "",
    categories: parseCategories(row.categories),
    capacity: row.capacity,
    entry_fee: row.entry_fee,
    currency: row.currency || "HKD",
    whatsapp: row.whatsapp || "",
    registration_open: openFlag && notExpired,
    registration_deadline: deadline,
    show_public_list: Number(row.show_public_list) === 1,
  };
}

export function adminEvent(row) {
  if (!row) return null;
  return {
    ...publicEvent(row),
    registration_open: Number(row.registration_open) === 1,
    payme_id: row.payme_id || "",
    payme_link: row.payme_link || "",
    fps_id: row.fps_id || "",
    fps_name: row.fps_name || "",
    payment_note: row.payment_note || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function paymentBlock(eventRow) {
  return {
    entry_fee: eventRow.entry_fee,
    currency: eventRow.currency || "HKD",
    payme_id: eventRow.payme_id || "",
    payme_link: eventRow.payme_link || "",
    fps_id: eventRow.fps_id || "",
    fps_name: eventRow.fps_name || "",
    payment_note: eventRow.payment_note || "",
  };
}

export function publicRegistration(row, eventRow) {
  const showPay = PAYMENT_VISIBLE.has(row.status);
  return {
    token: row.token,
    display_name: row.display_name,
    category: row.category || "",
    status: row.status,
    admin_note: row.admin_note || "",
    created_at: row.created_at,
    confirmed_at: row.confirmed_at,
    paid_at: row.paid_at,
    event: publicEvent(eventRow),
    payment: showPay ? paymentBlock(eventRow) : null,
  };
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function issueAdminToken(env) {
  const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = `admin.${exp}`;
  const sig = await hmac(env.ADMIN_SECRET || env.ADMIN_PASSWORD || "dev", payload);
  return `${payload}.${sig}`;
}

export async function verifyAdminToken(env, token) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [role, exp, sig] = parts;
  if (role !== "admin") return false;
  if (Number(exp) < Date.now()) return false;
  const payload = `${role}.${exp}`;
  const expect = await hmac(env.ADMIN_SECRET || env.ADMIN_PASSWORD || "dev", payload);
  if (expect.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expect.length; i++) diff |= expect.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

export async function requireAdmin(context) {
  const header = context.request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const ok = await verifyAdminToken(context.env, token);
  if (!ok) return error("未授權，請重新登入後台", 401);
  return null;
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function cleanText(v, max = 200) {
  return String(v ?? "").trim().slice(0, max);
}

export function countsFromRows(rows) {
  const counts = { total: 0, pending: 0, confirmed: 0, paid: 0, waitlist: 0, rejected: 0, cancelled: 0 };
  for (const r of rows || []) {
    counts.total += r.n;
    if (counts[r.status] != null) counts[r.status] += r.n;
  }
  counts.taken = (counts.confirmed || 0) + (counts.paid || 0);
  return counts;
}

export function buildWhatsappMessage(eventRow, reg) {
  const fee = `${eventRow.currency || "HKD"} ${eventRow.entry_fee || 0}`;
  const pay = [];
  if (eventRow.payme_id) pay.push(`PayMe：${eventRow.payme_id}`);
  if (eventRow.payme_link) pay.push(`PayMe 連結：${eventRow.payme_link}`);
  if (eventRow.fps_id) pay.push(`FPS：${eventRow.fps_id}${eventRow.fps_name ? "（" + eventRow.fps_name + "）" : ""}`);
  const payText = pay.length ? pay.join("\n") : "付款詳情請睇報名頁。";
  return [
    `你好 ${reg.display_name}，你已獲確認參加「${eventRow.title}」。`,
    `組別：${reg.category || "—"}`,
    `報名費：${fee}`,
    payText,
    eventRow.payment_note || "請喺轉帳備註填寫你嘅 Belader 名稱，轉完回覆呢個訊息。",
    `查詢報名：打開網站「我的報名」，Token：${reg.token}`,
  ].join("\n");
}
