# 民泊チェックイン通知

15時（JST）以降に、SwitchBotロックの最初の解錠、またはウェビオ(Webiot)騒音センサーが
しきい値を超えた最初のタイミングのどちらかを検知したら、Slackに1回だけ通知する。

GitHub Actions が5分おき（15:00〜23:55 JST）に `scripts/checkin-notify.mjs` を実行し、
状態は `.state/state.json` に保存する（JSTの日付が変わると自動リセット）。

## 必要な準備

### 1. SwitchBot

1. SwitchBotアプリ → プロフィール → 環境設定 → 「App Version」を連続タップ →
   「開発者向けオプション」を開き、Token / Secret を取得する。
2. 対象ロックのデバイスIDを調べる。
   ```
   curl "https://api.switch-bot.com/v1.1/devices" -H "Authorization: <TOKEN>" ...
   ```
   （署名付きリクエストが必要。手元で一度スクリプトを動かして確認するか、
   参考記事の手順で取得する）

### 2. ウェビオ (Webiot) 騒音センサー

1. ウェビオのコンソールでセンサーを登録し、センサーID（例: `BTXX01`）を確認する。
2. コンソールからAPIキーを発行する。

### 3. Slack

Incoming Webhook を作成し、Webhook URLを取得する。
（Slack App管理画面 → Incoming Webhooks → チャンネルを選んで発行）

## GitHub リポジトリへの設定

**Settings → Secrets and variables → Actions** で以下を設定する。

### Secrets（必須）

| 名前 | 内容 |
|---|---|
| `SWITCHBOT_TOKEN` | SwitchBot 開発者トークン |
| `SWITCHBOT_SECRET` | SwitchBot シークレットキー |
| `SWITCHBOT_LOCK_DEVICE_ID` | 対象ロックのデバイスID |
| `WEBIOT_API_KEY` | ウェビオ APIキー |
| `WEBIOT_SENSOR_ID` | ウェビオ センサーID |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL |

どれか片方（SwitchBot or ウェビオ）だけ設定しても動作する。未設定の側はスキップされる。

### Variables（任意、未設定時はデフォルト値）

| 名前 | デフォルト | 内容 |
|---|---|---|
| `CHECKIN_HOUR` | `15` | 何時(JST)以降を監視するか |
| `NOISE_THRESHOLD_DB` | `45` | この値(dB)以上でチェックイン検知とみなす |

## 動作確認

Actions タブ → 「民泊チェックイン通知」→ **Run workflow** から手動実行できる。

- `dry_run: true` … Slackへは送らずログにのみ出力する
- `force: true` … 15時前でも実行する（テスト用）

両方 `true` にして実行し、ログにSwitchBot/ウェビオの取得値が出ることを確認するとよい。

## 制限・注意点

- 検知は5分間隔のポーリングのため、実際の解錠/騒音発生から最大5分程度の通知遅延がある。
- 通知は1日1回（ロック・騒音それぞれ別トリガーとして最大2回/日）。
- ウェビオ側はWebhookでのリアルタイム連携を推奨しているが、常時稼働のサーバーが
  ないためここではポーリング方式にしている。将来的に常時稼働環境（自宅サーバー等）を
  用意する場合は、Webhookを受け取ってすぐ通知する方式に切り替えるとより速い。
