# Beyblade 比賽報名系統（免費、可重用）

Cloudflare Pages + D1 + Pages Functions。

流程：

1. 玩家報名 → 狀態 `pending`（或滿額則 `waitlist`）
2. 後台 Admin 按「確認」→ `confirmed`
3. 玩家用 Token 打開「我的報名」先見到 PayMe / FPS
4. Admin 對到數後按「已收款」→ `paid`

付款資料**永遠唔會**出現喺公開比賽頁。

## 一、安裝

需要：[Node.js](https://nodejs.org/) 同 Cloudflare 帳號（免費，唔使信用卡）。

```bash
cd beyblade-reg
npm install
npx wrangler login
```

## 二、建立 D1 資料庫

```bash
npx wrangler d1 create beyblade-reg
```

將輸出嘅 `database_id` 填入 `wrangler.toml` 嘅 `REPLACE_WITH_YOUR_D1_ID`。

套用資料表：

```bash
npm run db:remote
```

可選示範比賽：

```bash
npm run db:seed
```

## 三、設定密碼（正式環境）

唔好用檔案入面嘅預設值。去：

Cloudflare Dashboard → Workers & Pages → 你嘅 project → Settings → Environment variables

加：

- `ADMIN_PASSWORD`  後台密碼
- `ADMIN_SECRET`    一串好長嘅亂數（簽發登入 token 用）

`wrangler.toml` 入面嘅 `[vars]` 只係方便本地。

## 四、部署

```bash
npx wrangler pages project create beyblade-reg
npm run deploy
```

之後綁 D1：Dashboard → 該 Pages 專案 → Settings → Bindings → D1 → binding 名稱必須係 `DB`，揀 `beyblade-reg`。

或者用 Git 連接：把成個資料夾 push 上 GitHub，Pages 設定 build output 為 `public`（呢個專案冇 build 步驟）。

## 五、本地測試

```bash
npx wrangler d1 create beyblade-reg --local
# 若 local 已存在可跳過 create
npx wrangler d1 execute beyblade-reg --local --file=schema/schema.sql
npx wrangler d1 execute beyblade-reg --local --file=schema/seed.sql
npm run dev
```

打開終端機顯示嘅 localhost。

- 公開站：`/`
- 報名頁：`/event.html?slug=2026-hk-open`
- 我的報名：`/status.html`
- 後台：`/admin.html`（預設密碼 `change-me-now`）

## 六、每場新比賽點用

1. 登入 `/admin.html`
2. 「開新比賽」
3. 填日期、名額、組別、PayMe / FPS（呢啲只有確認後先俾玩家睇）
4. 儲存，把 `/event.html?slug=你的slug` 丟去 WhatsApp 群

## 七、狀態一覽

| 狀態 | 意思 | 玩家見唔見到付款 |
|---|---|---|
| pending | 等確認 | 否 |
| waitlist | 名額滿，候補 | 否 |
| confirmed | 已批准 | 是 |
| paid | 已收款，正式入場 | 是 |
| rejected | 未獲接納 | 否 |
| cancelled | 取消 | 否 |

滿額後新報名會自動變候補，唔會佔確認名額。確認 + 已付款先計入名額。
