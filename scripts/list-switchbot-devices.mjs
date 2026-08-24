#!/usr/bin/env node
// SwitchBotに登録されているデバイス一覧とdeviceIdを表示する。
// ロックのdeviceIdを確認するために一度だけ手元で実行する用途。
//
// 使い方:
//   SWITCHBOT_TOKEN=xxx SWITCHBOT_SECRET=yyy node scripts/list-switchbot-devices.mjs

import { createHmac, randomUUID } from 'node:crypto';

const { SWITCHBOT_TOKEN, SWITCHBOT_SECRET } = process.env;

if (!SWITCHBOT_TOKEN || !SWITCHBOT_SECRET) {
  console.error('環境変数 SWITCHBOT_TOKEN と SWITCHBOT_SECRET を設定してください。');
  process.exit(1);
}

const t = Date.now().toString();
const nonce = randomUUID();
const sign = createHmac('sha256', SWITCHBOT_SECRET)
  .update(SWITCHBOT_TOKEN + t + nonce)
  .digest('base64');

const res = await fetch('https://api.switch-bot.com/v1.1/devices', {
  headers: {
    Authorization: SWITCHBOT_TOKEN,
    sign,
    t,
    nonce,
    'Content-Type': 'application/json; charset=utf8',
  },
});

const data = await res.json();
if (data.statusCode !== 100) {
  console.error('取得失敗:', JSON.stringify(data, null, 2));
  process.exit(1);
}

console.log('=== デバイス一覧 ===');
for (const d of data.body.deviceList) {
  console.log(`${d.deviceName}\t${d.deviceType}\tdeviceId: ${d.deviceId}`);
}
