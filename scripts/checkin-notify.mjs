#!/usr/bin/env node
// 民泊チェックイン検知 → Slack通知
//
// 15時(JST, CHECKIN_HOUR で変更可)以降、
//   1) SwitchBotロックが最初に解錠された
//   2) ウェビオ騒音センサーがしきい値を最初に超えた
// のいずれかを検知した時点で、その日1回だけSlackに通知する。
//
// 状態は .state/state.json に保存し、JSTの日付が変わったらリセットする。

import { createHmac, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const STATE_PATH = path.join(process.cwd(), '.state', 'state.json');

const env = process.env;
const CHECKIN_HOUR = Number(env.CHECKIN_HOUR ?? '15');
const NOISE_THRESHOLD_DB = Number(env.NOISE_THRESHOLD_DB ?? '45');
const DRY_RUN = env.DRY_RUN === 'true';
const FORCE = env.FORCE === 'true';

function jstParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour === '24' ? '0' : parts.hour),
    minute: Number(parts.minute),
  };
}

async function loadState(todayStr) {
  const empty = { date: todayStr, lockNotified: false, noiseNotified: false };
  try {
    const raw = await readFile(STATE_PATH, 'utf8');
    const state = JSON.parse(raw);
    if (state.date !== todayStr) return empty;
    return { ...empty, ...state };
  } catch {
    return empty;
  }
}

async function saveState(state) {
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

async function notifySlack(text) {
  if (!env.SLACK_WEBHOOK_URL) {
    console.warn('SLACK_WEBHOOK_URL が未設定のため通知をスキップしました:', text);
    return;
  }
  if (DRY_RUN) {
    console.log('[DRY_RUN] Slack通知(送信スキップ):', text);
    return;
  }
  const res = await fetch(env.SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`Slack通知に失敗しました: ${res.status} ${await res.text()}`);
  }
  console.log('Slack通知を送信しました:', text);
}

async function fetchSwitchBotLockState() {
  const { SWITCHBOT_TOKEN, SWITCHBOT_SECRET, SWITCHBOT_LOCK_DEVICE_ID } = env;
  if (!SWITCHBOT_TOKEN || !SWITCHBOT_SECRET || !SWITCHBOT_LOCK_DEVICE_ID) {
    console.warn('SwitchBotの環境変数が未設定のため、ロック確認をスキップします。');
    return null;
  }
  const t = Date.now().toString();
  const nonce = randomUUID();
  const sign = createHmac('sha256', SWITCHBOT_SECRET)
    .update(SWITCHBOT_TOKEN + t + nonce)
    .digest('base64');

  const res = await fetch(
    `https://api.switch-bot.com/v1.1/devices/${SWITCHBOT_LOCK_DEVICE_ID}/status`,
    {
      headers: {
        Authorization: SWITCHBOT_TOKEN,
        sign,
        t,
        nonce,
        'Content-Type': 'application/json; charset=utf8',
      },
    }
  );
  if (!res.ok) {
    throw new Error(`SwitchBot APIエラー: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  if (data.statusCode !== 100) {
    throw new Error(`SwitchBot APIエラー: ${JSON.stringify(data)}`);
  }
  return data.body?.lockState ?? null; // "locked" | "unlocked"
}

async function fetchWebiotDecibel() {
  const { WEBIOT_API_KEY, WEBIOT_SENSOR_ID } = env;
  if (!WEBIOT_API_KEY || !WEBIOT_SENSOR_ID) {
    console.warn('ウェビオの環境変数が未設定のため、騒音確認をスキップします。');
    return null;
  }
  const res = await fetch(
    `https://api.webiot.io/api/sensors/${WEBIOT_SENSOR_ID}/average_decibel`,
    { headers: { Authorization: `Bearer ${WEBIOT_API_KEY}` } }
  );
  if (!res.ok) {
    throw new Error(`ウェビオ APIエラー: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const value = Number(data.value);
  const rawUnixtime = Number(data.unixtime);
  const unixtimeMs = rawUnixtime > 1e12 ? rawUnixtime : rawUnixtime * 1000;
  const ageMinutes = (Date.now() - unixtimeMs) / 60000;
  if (Number.isFinite(ageMinutes) && ageMinutes > 10) {
    console.warn(`ウェビオのデータが古い可能性があります(${ageMinutes.toFixed(1)}分前)。`);
  }
  return value;
}

async function main() {
  const now = jstParts();
  console.log(`現在時刻(JST): ${now.dateStr} ${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')}`);

  if (!FORCE && now.hour < CHECKIN_HOUR) {
    console.log(`まだ${CHECKIN_HOUR}時前のため終了します。`);
    return;
  }

  const state = await loadState(now.dateStr);
  let changed = state.date !== now.dateStr;
  state.date = now.dateStr;

  let hadError = false;

  if (!state.lockNotified) {
    try {
      const lockState = await fetchSwitchBotLockState();
      console.log('SwitchBotロック状態:', lockState);
      if (lockState === 'unlocked') {
        await notifySlack(
          `🔑 本日${CHECKIN_HOUR}時以降、最初のロック解錠を検知しました。チェックインの可能性があります。(${now.dateStr})`
        );
        state.lockNotified = true;
        changed = true;
      }
    } catch (err) {
      console.error('SwitchBot確認中にエラー:', err.message);
      hadError = true;
    }
  }

  if (!state.noiseNotified) {
    try {
      const db = await fetchWebiotDecibel();
      if (db !== null) {
        console.log(`騒音値: ${db}dB (しきい値: ${NOISE_THRESHOLD_DB}dB)`);
        if (db >= NOISE_THRESHOLD_DB) {
          await notifySlack(
            `🔊 本日${CHECKIN_HOUR}時以降、しきい値(${NOISE_THRESHOLD_DB}dB)を超える音を検知しました(実測 ${db}dB)。チェックインの可能性があります。(${now.dateStr})`
          );
          state.noiseNotified = true;
          changed = true;
        }
      }
    } catch (err) {
      console.error('ウェビオ確認中にエラー:', err.message);
      hadError = true;
    }
  }

  if (changed) {
    await saveState(state);
    console.log('状態を保存しました:', state);
  } else {
    console.log('状態に変化はありませんでした。');
  }

  if (hadError) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('予期しないエラー:', err);
  process.exitCode = 1;
});
