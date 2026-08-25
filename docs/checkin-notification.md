# 民泊チェックイン通知

15時（JST、変更可）以降にSwitchBotロックが**最初に解錠**されたら、その日1回だけSlackに通知する。

オートロックで施錠まで約10秒しかないため、定期ポーリング方式では取りこぼす確率が高い。
そのため、SwitchBotの**Webhook**（鍵の状態が変わった瞬間にリアルタイムでプッシュされる仕組み）を
**Cloudflare Workers**（無料枠で常時稼働）で受け取る構成にしている。

```
SwitchBotロック → (解錠) → SwitchBot Webhook → Cloudflare Worker → Slack
```

- `cloudflare-worker/` … Webhookを受け取り、Slackに通知するWorker本体
- `scripts/list-switchbot-devices.mjs` … ロックのdeviceId(MACアドレス)を調べる
- `scripts/switchbot-webhook.mjs` … SwitchBot側にWebhook URLを登録/確認/削除する

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
```

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

1. 15時を過ぎたタイミングで実際にロックを解錠してみる
2. Slackに通知が届くか確認する
3. 届かない場合は `npx wrangler tail`(cloudflare-worker配下で実行)でWorkerのログをリアルタイムに確認する

## 設定変更

- 何時から監視するか変えたい場合: `cloudflare-worker/wrangler.toml` の `CHECKIN_HOUR` を変更し、再度 `npx wrangler deploy`
- Webhook URLやSecretを再発行した場合: `scripts/switchbot-webhook.mjs delete` で一度削除してから `setup` し直す

## 制限・注意点

- 通知は1日1回(JSTの日付が変わると自動リセット)。
- `WEBHOOK_TOKEN` はURLの一部としてのみ検証しており、SwitchBot側の署名検証はない。
  そのためこのURLは第三者に知られないよう扱うこと。
- Cloudflare Workers / KVは無料枠の範囲で十分収まる想定(個人の民泊1件分の解錠イベント程度)。
