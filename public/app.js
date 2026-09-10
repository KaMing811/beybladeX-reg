export const STATUS_LABEL = {
  pending: "待確認",
  confirmed: "已確認，待付款",
  paid: "已付款",
  waitlist: "候補",
  rejected: "未獲接納",
  cancelled: "已取消",
};

export function $(sel, root = document) {
  return root.querySelector(sel);
}

export async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && typeof opts.body !== "string") {
    headers["content-type"] = "application/json";
    opts.body = JSON.stringify(opts.body);
  }
  const token = localStorage.getItem("beyx_admin");
  if (token) headers.authorization = "Bearer " + token;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || "請求失敗");
  return data;
}

export function fmtDate(d, t1 = "", t2 = "") {
  if (!d) return "日期待定";
  const time = [t1, t2].filter(Boolean).join("–");
  return time ? `${d} ${time}` : d;
}

export function feeText(ev) {
  if (!ev) return "";
  if (!ev.entry_fee) return "免費";
  return `${ev.currency || "HKD"} ${ev.entry_fee}`;
}

export function statusPill(status) {
  return `<span class="pill ${status}">${STATUS_LABEL[status] || status}</span>`;
}

export function nav(extra = "") {
  return `<div class="nav">
    <a class="brand" href="/"><span class="spin"></span> BEYX REG</a>
    <div>${extra}<a class="btn ghost" href="/status.html">我的報名</a></div>
  </div>`;
}
