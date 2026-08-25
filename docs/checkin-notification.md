# 民泊チェックイン通知

15時（JST、変更可）以降にSwitchBotロックが**最初に解錠**され、かつ**Beds24に本日到着の確定予約がある**場合だけ、その日1回Slackに通知する。清掃で解錠した日、連泊2日目に中から解錠した日、予約が無い日には通知しない。

オートロックで施錠まで約10秒しかないため、定期ポーリング方式では取りこぼす確率が高い。
そのため、SwitchBotの**Webhook**（鍵の状態が変わった瞬間にリアルタイムでプッシュされる仕組み）を
**Cloudflare Workers**（無料枠で常時稼働）で受け取る構成にしている。予約の有無は、解錠イベントを
受け取った瞬間にBeds24 APIへ問い合わせて確認する。

```
SwitchBotロック → (解錠) → SwitchBot Webhook → Cloudflare Worker → Beds24 API(本日到着の予約確認) → Slack
```

- `cloudflare-worker/` … Webhookを受け取り、Beds24に照会し、Slackに通知するWorker本体
- `scripts/list-switchbot-devices.mjs` … ロックのdeviceId(MACアドレス)を調べる
- `scripts/switchbot-webhook.mjs` … SwitchBot側にWebhook URLを登録/確認/削除する
- `scripts/beds24-setup.mjs` … Beds24のinvite codeをrefreshTokenに交換する(初回のみ)

## 1. SwitchBotのToken/Secretを取得する

1. SwitchBotアプリ → プロフィール → 環境設定 → 「App Version」を連続タップ
2. 「開発者向けオプション」が現れるので開く → `Token` / `Secret` をコピー

## 2. ロックのdeviceId(MACアドレス)を確認する

手元のPC(Node.js 18以上)で、このリポジトリをcloneして以下を実行する。

```bash
SWITCHBOT_TOKEN=<Token> SWITCHBOT_SECRET=<Secret> \
  node scripts/list-switchbot-devices.mjs
```

対象ロックの `deviceId` をメモする。

## 3. Cloudflareの準備

無料のCloudflareアカウントを作成し、`cloudflare-worker/` ディレクトリで以下を行う。

```bash
cd cloudflare-worker
npm install
npx wrangler login          # ブラウザでCloudflareにログイン
npx wrangler kv namespace create STATE
```

最後のコマンドで表示される `id` を `wrangler.toml` の `REPLACE_WITH_KV_NAMESPACE_ID` に書き込む。

続けて、Webhook受信URLの推測防止用トークンを自分で決めて（例: `openssl rand -hex 16`
で生成したランダムな文字列）、Secretとして登録する。

```bash
npx wrangler secret put WEBHOOK_TOKEN
npx wrangler secret put SWITCHBOT_LOCK_DEVICE_ID   # 手順2でメモしたdeviceId
npx wrangler secret put SLACK_WEBHOOK_URL          # 手順4で取得するSlack Webhook URL
npx wrangler secret put BEDS24_REFRESH_TOKEN       # 手順4.5で取得するrefreshToken
```

Beds24で複数物件を1アカウントで管理している場合は、`wrangler.toml` の
`BEDS24_PROPERTY_ID` に対象物件のpropertyIdを設定する(1物件のみなら空のままでよい)。

デプロイする。

```bash
npx wrangler deploy
```

成功すると `https://minpaku-checkin-notify.<あなたのサブドメイン>.workers.dev` のようなURLが表示される。
これに `/hooks/<WEBHOOK_TOKEN>` を付けたものが、実際にSwitchBotへ登録するWebhook URLになる。

例: `https://minpaku-checkin-notify.example.workers.dev/hooks/9f2c...(WEBHOOK_TOKENの値)`

## 4. Slack Incoming Webhookを作る

1. https://api.slack.com/apps → **Create New App** → **From scratch**
2. アプリ名・ワークスペースを選択
3. 左メニュー「Incoming Webhooks」→ オンにする
4. 「Add New Webhook to Workspace」→ 通知したいチャンネルを選んで許可
5. `https://hooks.slack.com/services/...` のURLをコピーし、手順3で `SLACK_WEBHOOK_URL` として登録する

(手順3と4は前後してもよいが、`wrangler secret put SLACK_WEBHOOK_URL` はここで実行する)

## 4.5. Beds24のrefreshTokenを取得する

1. Beds24管理画面 → **SETTINGS → ACCOUNT → ACCESS(API)** → invite codeを発行する
   (スコープは `bookings` の読み取りを含める)
2. 手元のPCで交換する。

   ```bash
   node scripts/beds24-setup.mjs <発行されたinvite code>
   ```

   表示された `refreshToken` を、手順3の `wrangler secret put BEDS24_REFRESH_TOKEN` で登録する。
3. 複数物件を管理している場合は、対象物件のpropertyId(Beds24管理画面や `GET /properties` で確認できる)を
   `wrangler.toml` の `BEDS24_PROPERTY_ID` に設定し、`npx wrangler deploy` し直す。

## 5. SwitchBotにWebhook URLを登録する

手元のPCで、手順3で確認したWorkerのURL(`/hooks/<WEBHOOK_TOKEN>`付き)を指定して実行する。

```bash
SWITCHBOT_TOKEN=<Token> SWITCHBOT_SECRET=<Secret> \
  node scripts/switchbot-webhook.mjs setup https://minpaku-checkin-notify.example.workers.dev/hooks/<WEBHOOK_TOKEN>
```

`statusCode: 100` が返れば登録成功。登録内容の確認は:

```bash
SWITCHBOT_TOKEN=<Token> SWITCHBOT_SECRET=<Secret> \
  node scripts/switchbot-webhook.mjs query
```

## 動作確認

1. Beds24側で当日到着(status: confirmed)のテスト予約を1件作る、または実際の予約日に合わせる
2. 15時を過ぎたタイミングで実際にロックを解錠してみる
3. Slackに通知が届くか確認する
4. 届かない場合は `npx wrangler tail`(cloudflare-worker配下で実行)でWorkerのログをリアルタイムに確認する
   (`ignored (no reservation arriving today)` と出ていればBeds24側で当日到着の確定予約が見つからなかった、という意味)

## 設定変更

- 何時から監視するか変えたい場合: `cloudflare-worker/wrangler.toml` の `CHECKIN_HOUR` を変更し、再度 `npx wrangler deploy`
- Webhook URLやSecretを再発行した場合: `scripts/switchbot-webhook.mjs delete` で一度削除してから `setup` し直す
- 予約ステータスの判定条件(現在は `confirmed` のみ)を変えたい場合は `cloudflare-worker/src/index.js` の
  `hasArrivalToday` 内の `status: 'confirmed'` を調整する

## 制限・注意点

- 通知は1日1回(JSTの日付が変わると自動リセット)。
- `WEBHOOK_TOKEN` はURLの一部としてのみ検証しており、SwitchBot側の署名検証はない。
  そのためこのURLは第三者に知られないよう扱うこと。
- Beds24 APIが一時的に応答しない場合は、通知漏れを避けるため「予約ありとみなして通知する」フェイルオープン
  仕様にしている(誤検知が増える可能性より、本物のチェックインを見逃す方を避けるため)。
- Cloudflare Workers / KVは無料枠の範囲で十分収まる想定(個人の民泊1件分の解錠イベント程度)。
