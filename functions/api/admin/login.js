import { json, error, readJson, cleanText, issueAdminToken } from "../../_lib/utils.js";

export async function onRequestPost({ env, request }) {
  const body = await readJson(request);
  if (!body) return error("無效資料");
  const password = cleanText(body.password, 200);
  const expected = env.ADMIN_PASSWORD || "";
  if (!expected || password !== expected) return error("密碼錯誤", 401);
  const token = await issueAdminToken(env);
  return json({ ok: true, token });
}
