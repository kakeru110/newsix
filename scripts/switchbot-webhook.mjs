#!/usr/bin/env node
// SwitchBotのWebhook登録・確認・削除を行う(初回セットアップ用に手元で一度だけ実行する)。
//
// 使い方:
//   SWITCHBOT_TOKEN=xxx SWITCHBOT_SECRET=yyy \
//     node scripts/switchbot-webhook.mjs setup https://<worker>.workers.dev/hooks/<WEBHOOK_TOKEN>
//   SWITCHBOT_TOKEN=xxx SWITCHBOT_SECRET=yyy node scripts/switchbot-webhook.mjs query
//   SWITCHBOT_TOKEN=xxx SWITCHBOT_SECRET=yyy \
//     node scripts/switchbot-webhook.mjs delete https://<worker>.workers.dev/hooks/<WEBHOOK_TOKEN>

import { createHmac, randomUUID } from 'node:crypto';

const [, , action, arg] = process.argv;
const { SWITCHBOT_TOKEN, SWITCHBOT_SECRET } = process.env;

if (!SWITCHBOT_TOKEN || !SWITCHBOT_SECRET) {
  console.error('環境変数 SWITCHBOT_TOKEN と SWITCHBOT_SECRET を設定してください。');
  process.exit(1);
}
if (!['setup', 'query', 'delete'].includes(action)) {
  console.error('使い方: node scripts/switchbot-webhook.mjs <setup|query|delete> [webhookUrl]');
  process.exit(1);
}
if ((action === 'setup' || action === 'delete') && !arg) {
  console.error(`${action} にはWebhook URLを指定してください。`);
  process.exit(1);
}

const ENDPOINT = {
  setup: 'https://api.switch-bot.com/v1.1/webhook/setupWebhook',
  query: 'https://api.switch-bot.com/v1.1/webhook/queryWebhook',
  delete: 'https://api.switch-bot.com/v1.1/webhook/deleteWebhook',
}[action];

const BODY = {
  setup: { action: 'setupWebhook', url: arg, deviceList: 'ALL' },
  query: { action: 'queryUrl' },
  delete: { action: 'deleteWebhook', url: arg },
}[action];

function authHeaders() {
  const t = Date.now().toString();
  const nonce = randomUUID();
  const sign = createHmac('sha256', SWITCHBOT_SECRET)
    .update(SWITCHBOT_TOKEN + t + nonce)
    .digest('base64');
  return {
    Authorization: SWITCHBOT_TOKEN,
    sign,
    t,
    nonce,
    'Content-Type': 'application/json; charset=utf8',
  };
}

const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: authHeaders(),
  body: JSON.stringify(BODY),
});
const data = await res.json();
console.log(JSON.stringify(data, null, 2));
if (data.statusCode !== 100) {
  process.exit(1);
}
