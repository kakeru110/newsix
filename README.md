# newsix

## 民泊チェックイン通知

SwitchBotロックの解錠をWebhookでリアルタイムに検知し、Beds24に本日到着の予約があるときだけ
Cloudflare Workers経由でSlackに通知する仕組みを追加している。
セットアップ手順は [docs/checkin-notification.md](docs/checkin-notification.md) を参照。