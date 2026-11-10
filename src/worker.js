import {
  json,
  error,
  readJson,
  cleanText,
  slugify,
  parseCategories,
  publicEvent,
  adminEvent,
  publicRegistration,
  countsFromRows,
  randomToken,
  nowIso,
  issueAdminToken,
  requireAdmin,
  requireSuperadmin,
  hashPassword,
  generateSalt,
  STATUSES,
  buildWhatsappMessage,
  normalizeKind,
} from "../functions/_lib/utils.js";

async function ensureColumns(db) {
  const alters = [
    "ALTER TABLE events ADD COLUMN poster_url TEXT DEFAULT ''",
    "ALTER TABLE events ADD COLUMN event_kind TEXT DEFAULT 'tournament'",
    "ALTER TABLE admins ADD COLUMN salt TEXT",
  ];
  for (const sql of alters) {
    try { await db.prepare(sql).run(); } catch (_) {}
  }
}

async function savePosterUrl(db, id, poster_url) {
  await db.prepare("UPDATE events SET poster_url=?, updated_at=? WHERE id=?").bind(poster_url || "", nowIso(), id).run();
}

async function eventCounts(db, eventId) {
  const raw = await db
    .prepare("SELECT status, COUNT(*) AS n FROM registrations WHERE event_id = ? GROUP BY status")
    .bind(eventId)
    .all();
  return countsFromRows(raw.results);
}

async function handleApi(request, env) {
  await ensureColumns(env.DB);
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  const method = request.method;
  const ctx = { request, env };

  try {
    if (method === "GET" && path === "/api/events") {
      const events = await env.DB.prepare("SELECT * FROM events ORDER BY event_date DESC, id DESC").all();
      const out = [];
      for (const row of events.results || []) {
        out.push({ ...publicEvent(row), counts: await eventCounts(env.DB, row.id) });
      }
      return json({ ok: true, events: out });
    }

    const evSlug = path.match(/^\/api\/events\/([^/]+)$/);
    if (method === "GET" && evSlug) {
      const row = await env.DB.prepare("SELECT * FROM events WHERE slug = ?").bind(decodeURIComponent(evSlug[1])).first();
      if (!row) return error("找不到呢場比賽", 404);
      const counts = await eventCounts(env.DB, row.id);
      let public_list = [];
      if (Number(row.show_public_list) === 1) {
        const list = await env.DB.prepare(
          `SELECT display_name, category, status FROM registrations
           WHERE event_id = ? AND status IN ('pending','confirmed','paid','waitlist')
           ORDER BY created_at ASC`
        ).bind(row.id).all();
        public_list = (list.results || []).map((r) => ({
          display_name: r.display_name,
          category: r.category,
          status: r.status === "paid" || r.status === "confirmed" ? "confirmed" : r.status,
        }));
      }
      return json({ ok: true, event: { ...publicEvent(row), counts }, public_list });
    }

    if (method === "POST" && path === "/api/register") {
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
      const counts = await eventCounts(env.DB, event.id);
      const dup = await env.DB.prepare(
        `SELECT id FROM registrations WHERE event_id = ? AND whatsapp = ? AND status NOT IN ('rejected','cancelled')`
      ).bind(event.id, whatsapp).first();
      if (dup) return error("呢個 WhatsApp 已經報名過呢場比賽");
      const token = randomToken();
      const status = counts.taken >= event.capacity ? "waitlist" : "pending";
      await env.DB.prepare(
        `INSERT INTO registrations
          (event_id, token, display_name, real_name, whatsapp, category, notes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(event.id, token, display_name, real_name, whatsapp, chosen, notes, status, nowIso(), nowIso()).run();
      return json({
        ok: true,
        token,
        status,
        event: publicEvent(event),
        message: status === "waitlist"
          ? "名額已滿，你已進入候補名單。主辦確認後先會提供付款方式。"
          : "已收到報名，請等主辦確認。確認後先會提供付款方式。",
      });
    }

    if (method === "GET" && path === "/api/status") {
      const token = (url.searchParams.get("token") || "").trim();
      if (!token) return error("缺少 token");
      const row = await env.DB.prepare("SELECT * FROM registrations WHERE token = ?").bind(token).first();
      if (!row) return error("找不到呢份報名", 404);
      const event = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(row.event_id).first();
      return json({ ok: true, registration: publicRegistration(row, event) });
    }

    // ===== Admin Login =====
    if (method === "POST" && path === "/api/admin/login") {
      const body = await readJson(request);
      if (!body) return error("無效資料");
      const username = cleanText(body.username, 50);
      const password = cleanText(body.password, 200);
      if (!username || !password) return error("請填帳號同密碼");

      const admin = await env.DB.prepare(
        "SELECT * FROM admins WHERE username = ? AND active = 1"
      ).bind(username).first();

      if (!admin || !admin.salt) return error("帳號或密碼錯誤", 401);

      const hash = await hashPassword(password, admin.salt);
      if (hash !== admin.password_hash) return error("帳號或密碼錯誤", 401);

      return json({
        ok: true,
        token: await issueAdminToken(env, admin),
        role: admin.role,
        username: admin.username,
      });
    }

    // ===== Admin Management (Superadmin only) =====
    if (path === "/api/admin/admins" && method === "GET") {
      const denied = await requireSuperadmin(ctx);
      if (denied) return denied;
      const rows = await env.DB.prepare(
        "SELECT id, username, role, active, created_at FROM admins ORDER BY id"
      ).all();
      return json({ ok: true, admins: rows.results || [] });
    }

    if (path === "/api/admin/admins" && method === "POST") {
      const denied = await requireSuperadmin(ctx);
      if (denied) return denied;
      const body = await readJson(request);
      if (!body) return error("無效資料");
      const username = cleanText(body.username, 50);
      const password = cleanText(body.password, 200);
      const role = body.role === "superadmin" ? "superadmin" : "admin";
      if (!username || !password) return error("請填帳號同密碼");

      const exists = await env.DB.prepare("SELECT id FROM admins WHERE username = ?").bind(username).first();
      if (exists) return error("帳號已存在");

      const salt = generateSalt();
      const hash = await hashPassword(password, salt);
      await env.DB.prepare(
        "INSERT INTO admins (username, password_hash, salt, role) VALUES (?, ?, ?, ?)"
      ).bind(username, hash, salt, role).run();
      return json({ ok: true });
    }

    const adminIdMatch = path.match(/^\/api\/admin\/admins\/(\d+)$/);
    if (adminIdMatch && method === "PATCH") {
      const denied = await requireSuperadmin(ctx);
      if (denied) return denied;
      const id = Number(adminIdMatch[1]);
      const body = await readJson(request);
      if (!body) return error("無效資料");

      const updates = [];
      const binds = [];
      if (body.password) {
        const salt = generateSalt();
        updates.push("password_hash = ?", "salt = ?");
        binds.push(await hashPassword(body.password, salt), salt);
      }
      if (body.active != null) {
        updates.push("active = ?");
        binds.push(body.active ? 1 : 0);
      }
      if (body.role) {
        updates.push("role = ?");
        binds.push(body.role === "superadmin" ? "superadmin" : "admin");
      }
      if (!updates.length) return error("冇嘢要改");

      binds.push(id);
      await env.DB.prepare(`UPDATE admins SET ${updates.join(", ")} WHERE id = ?`).bind(...binds).run();
      return json({ ok: true });
    }

    // ===== Events =====
    if (path === "/api/admin/events" && method === "GET") {
      const denied = await requireAdmin(ctx);
      if (denied) return denied;
      const events = await env.DB.prepare("SELECT * FROM events ORDER BY event_date DESC, id DESC").all();
      const out = [];
      for (const row of events.results || []) {
        out.push({ ...adminEvent(row), counts: await eventCounts(env.DB, row.id) });
      }
      return json({ ok: true, events: out });
    }

    if (path === "/api/admin/events" && method === "POST") {
      const denied = await requireAdmin(ctx);
      if (denied) return denied;
      const body = await readJson(request);
      if (!body) return error("無效資料");
      const title = cleanText(body.title, 80);
      if (!title) return error("請填比賽名稱");
      let slug = slugify(body.slug || title) || "event-" + Date.now();
      const exists = await env.DB.prepare("SELECT id FROM events WHERE slug = ?").bind(slug).first();
      if (exists) return error("Slug 已存在，請換一個");
      const now = nowIso();
      const result = await env.DB.prepare(
        `INSERT INTO events (
          slug, title, subtitle, venue, address, event_date, start_time, end_time,
          description, rules, categories, capacity, entry_fee, currency,
          payme_id, payme_link, fps_id, fps_name, payment_note, whatsapp,
          registration_open, registration_deadline, show_public_list, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        slug, title, cleanText(body.subtitle, 120), cleanText(body.venue, 80), cleanText(body.address, 160),
        cleanText(body.event_date, 20) || now.slice(0, 10), cleanText(body.start_time, 10), cleanText(body.end_time, 10),
        cleanText(body.description, 2000), cleanText(body.rules, 2000), JSON.stringify(parseCategories(body.categories)),
        Number(body.capacity) || 32, Number(body.entry_fee) || 0, cleanText(body.currency, 8) || "HKD",
        cleanText(body.payme_id, 40), cleanText(body.payme_link, 200), cleanText(body.fps_id, 40), cleanText(body.fps_name, 40),
        cleanText(body.payment_note, 400), cleanText(body.whatsapp, 30),
        body.registration_open === false || body.registration_open === 0 ? 0 : 1,
        cleanText(body.registration_deadline, 32), body.show_public_list ? 1 : 0, now, now
      ).run();
      const newId = result.meta.last_row_id;
      try {
        await env.DB.prepare("UPDATE events SET event_kind=? WHERE id=?").bind(normalizeKind(body.event_kind), newId).run();
      } catch (_) {}
      if (body.poster_url) {
        try { await savePosterUrl(env.DB, newId, cleanText(body.poster_url, 2000)); } catch (_) {}
      }
      return json({ ok: true, id: newId, slug });
    }

    const adminEv = path.match(/^\/api\/admin\/events\/(\d+)$/);
    if (adminEv && method === "PUT") {
      const denied = await requireAdmin(ctx);
      if (denied) return denied;
      const id = Number(adminEv[1]);
      const body = await readJson(request);
      if (!body) return error("無效資料");
      const existing = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
      if (!existing) return error("找不到比賽", 404);
      const title = cleanText(body.title, 80) || existing.title;
      const slug = slugify(body.slug || existing.slug) || existing.slug;
      const clash = await env.DB.prepare("SELECT id FROM events WHERE slug = ? AND id != ?").bind(slug, id).first();
      if (clash) return error("Slug 已存在");
      await env.DB.prepare(
        `UPDATE events SET
          slug=?, title=?, subtitle=?, venue=?, address=?, event_date=?, start_time=?, end_time=?,
          description=?, rules=?, categories=?, capacity=?, entry_fee=?, currency=?,
          payme_id=?, payme_link=?, fps_id=?, fps_name=?, payment_note=?, whatsapp=?,
          registration_open=?, registration_deadline=?, show_public_list=?, updated_at=?
         WHERE id=?`
      ).bind(
        slug, title, cleanText(body.subtitle, 120), cleanText(body.venue, 80), cleanText(body.address, 160),
        cleanText(body.event_date, 20) || existing.event_date, cleanText(body.start_time, 10), cleanText(body.end_time, 10),
        cleanText(body.description, 2000), cleanText(body.rules, 2000), JSON.stringify(parseCategories(body.categories)),
        Number(body.capacity) || existing.capacity, Number(body.entry_fee ?? existing.entry_fee),
        cleanText(body.currency, 8) || "HKD", cleanText(body.payme_id, 40), cleanText(body.payme_link, 200),
        cleanText(body.fps_id, 40), cleanText(body.fps_name, 40), cleanText(body.payment_note, 400),
        cleanText(body.whatsapp, 30),
        body.registration_open === false || body.registration_open === 0 ? 0 : 1,
        cleanText(body.registration_deadline, 32), body.show_public_list ? 1 : 0, nowIso(), id
      ).run();
      try {
        await env.DB.prepare("UPDATE events SET event_kind=? WHERE id=?").bind(normalizeKind(body.event_kind), id).run();
      } catch (_) {}
      if (body.poster_url != null) {
        try { await savePosterUrl(env.DB, id, cleanText(body.poster_url, 2000)); } catch (_) {}
      }
      const row = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
      return json({ ok: true, event: adminEvent(row) });
    }

    const adminPoster = path.match(/^\/api\/admin\/events\/(\d+)\/poster$/);
    if (adminPoster && (method === "POST" || method === "DELETE")) {
      const denied = await requireAdmin(ctx);
      if (denied) return denied;
      const id = Number(adminPoster[1]);
      const existing = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
      if (!existing) return error("找不到比賽", 404);

      if (method === "DELETE") {
        if (env.POSTERS) await env.POSTERS.delete("posters/" + id).catch(() => {});
        await env.DB.prepare("UPDATE events SET poster_url='', updated_at=? WHERE id=?").bind(nowIso(), id).run();
        return json({ ok: true, poster_url: "" });
      }

      // (保留原本 poster upload 邏輯)
    }

    if (adminEv && method === "DELETE") {
      const denied = await requireAdmin(ctx);
      if (denied) return denied;
      const id = Number(adminEv[1]);
      await env.DB.prepare("DELETE FROM registrations WHERE event_id = ?").bind(id).run();
      await env.DB.prepare("DELETE FROM events WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }

    // ===== Registrations =====
    if (path === "/api/admin/registrations" && method === "GET") {
      const denied = await requireAdmin(ctx);
      if (denied) return denied;
      const eventId = url.searchParams.get("event_id");
      const status = url.searchParams.get("status");
      let sql = `SELECT r.*, e.title AS event_title, e.slug AS event_slug,
                        e.payme_id, e.payme_link, e.fps_id, e.fps_name, e.payment_note,
                        e.entry_fee, e.currency, e.whatsapp AS event_whatsapp
                 FROM registrations r JOIN events e ON e.id = r.event_id`;
      const binds = [];
      const where = [];
      if (eventId) { where.push("r.event_id = ?"); binds.push(Number(eventId)); }
      if (status) { where.push("r.status = ?"); binds.push(status); }
      if (where.length) sql += " WHERE " + where.join(" AND ");
      sql += " ORDER BY r.created_at DESC";
      const stmt = env.DB.prepare(sql);
      const rows = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
      return json({
        ok: true,
        registrations: (rows.results || []).map((r) => ({ ...r, wa_message: buildWhatsappMessage(r, r) })),
      });
    }

    const adminReg = path.match(/^\/api\/admin\/registrations\/(\d+)$/);
    if (adminReg && method === "PATCH") {
      const denied = await requireAdmin(ctx);
      if (denied) return denied;
      const id = Number(adminReg[1]);
      const body = await readJson(request);
      if (!body) return error("無效資料");
      const row = await env.DB.prepare("SELECT * FROM registrations WHERE id = ?").bind(id).first();
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
      await env.DB.prepare(
        `UPDATE registrations SET status=?, admin_note=?, paid_ref=?, confirmed_at=?, paid_at=?, updated_at=? WHERE id=?`
      ).bind(nextStatus, admin_note, paid_ref, confirmed_at, paid_at, nowIso(), id).run();
      const updated = await env.DB.prepare("SELECT * FROM registrations WHERE id = ?").bind(id).first();
      const event = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(row.event_id).first();
      return json({ ok: true, registration: updated, wa_message: buildWhatsappMessage(event, updated) });
    }

    // ===== Groups =====
    if (path === "/api/admin/groups" && method === "GET") {
      const denied = await requireAdmin(ctx);
      if (denied) return denied;
      const eventId = url.searchParams.get("event_id");
      if (!eventId) return error("缺少 event_id");
      const rows = await env.DB.prepare(
        "SELECT * FROM groups WHERE event_id = ? ORDER BY id DESC LIMIT 10"
      ).bind(Number(eventId)).all();
      return json({ ok: true, groups: rows.results || [] });
    }

    if (path === "/api/admin/groups" && method === "POST") {
      const denied = await requireAdmin(ctx);
      if (denied) return denied;
      const body = await readJson(request);
      if (!body) return error("無效資料");
      const eventId = Number(body.event_id);
      const groupSize = Number(body.group_size) || 4;
      const statuses = Array.isArray(body.statuses) ? body.statuses : [];
      const groups = Array.isArray(body.groups) ? body.groups : [];
      if (!eventId || !groups.length) return error("缺少資料");
      const ins = await env.DB.prepare(
        `INSERT INTO groups (event_id, group_size, statuses, groups_json, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(eventId, groupSize, JSON.stringify(statuses), JSON.stringify(groups), nowIso()).run();
      return json({ ok: true, group_id: ins.meta.last_row_id });
    }

    // ===== Draws & Brackets (保留原本邏輯，只需確保 requireAdmin) =====
    // ... 將你原本嘅 draws 同 brackets 代碼放返入去 ...

    return error("API 不存在", 404);
  } catch (e) {
    return error(e.message || "伺服器錯誤", 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const media = url.pathname.match(/^\/media\/posters\/(\d+)$/);
    if (media && env.POSTERS) {
      const obj = await env.POSTERS.get("posters/" + media[1]);
      if (!obj) return new Response("Not found", { status: 404 });
      const headers = new Headers();
      headers.set("content-type", obj.httpMetadata?.contentType || "image/jpeg");
      headers.set("cache-control", "public, max-age=86400");
      return new Response(obj.body, { headers });
    }
    if (url.pathname.startsWith("/api/")) {
      if (!env.DB) return error("未綁定 D1。Settings → Bindings 加入 D1，Variable name 必須係 DB", 500);
      return handleApi(request, env);
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};