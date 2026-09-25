# aoctravel-push

曼谷拳旅手冊的推播發送端（Cloudflare Worker）。

- `worker.js` — 已打包好的程式（含 Web Push 加密函式庫），**不要手改**；要改請改 TIM 那邊的 `worker.src.js` 再重新打包。
- `wrangler.jsonc` — 部署設定：Worker 名稱、KV 綁定（SUBS）、兩個公開變數。

機密值（`VAPID_PRIVATE`、`NOTIFY_TOKEN`）只存在 Cloudflare 的 Secrets 裡，不會出現在這個 repo。

## 這個資料夾怎麼上線
Cloudflare 的 aoctravel-push Worker 已連到這個 GitHub repo，根目錄設為 `push-worker`。
只要把改好的檔案上傳到 GitHub，Cloudflare 會自動重新部署。
