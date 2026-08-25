// 民泊チェックイン検知 Webhook受信 (Cloudflare Workers)
//
// SwitchBotロックのWebhookを受け取り、
//   1) 対象のロックの解錠(UNLOCKED)イベントで
//   2) 15時(JST, CHECKIN_HOURで変更可)以降、かつ
//   3) Beds24に「今日到着」の確定予約がある
// 場合だけ、その日1回だけSlackに通知する。
//
// 通知済みかどうかは Workers KV (STATE) に "notified:YYYY-MM-DD" として保存し、
// JSTの日付をまたぐと自動的に別キーになるので実質的に毎日リセットされる。
// Beds24のアクセストークンも同じKVに "beds24:accessToken" としてキャッシュする。

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(request.url);
    const token = url.pathname.split('/').filter(Boolean).pop();
    if (!env.WEBHOOK_TOKEN || token !== env.WEBHOOK_TOKEN) {
      return new Response('Forbidden', { status: 403 });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    const context = payload.context ?? {};
    const lockState = String(context.lockState ?? '').toUpperCase();
    const deviceMac = normalizeMac(context.deviceMac ?? '');
    const targetMac = normalizeMac(env.SWITCHBOT_LOCK_DEVICE_ID ?? '');

    if (!targetMac || deviceMac !== targetMac) {
      return new Response('ignored (device mismatch)', { status: 200 });
    }
    if (lockState !== 'UNLOCKED') {
      return new Response('ignored (not an unlock event)', { status: 200 });
    }

    const checkinHour = Number(env.CHECKIN_HOUR ?? '15');
    const { dateStr, hour } = jstNow();
    if (hour < checkinHour) {
      return new Response('ignored (before check-in hour)', { status: 200 });
    }

    const stateKey = `notified:${dateStr}`;
    const already = await env.STATE.get(stateKey);
    if (already) {
      return new Response('ignored (already notified today)', { status: 200 });
    }

    let arrivingToday;
    try {
      arrivingToday = await hasArrivalToday(env, dateStr);
    } catch (err) {
      console.error('Beds24確認中にエラー:', err);
      // Beds24が確認できない場合は、通知漏れを避けるため素通しする
      arrivingToday = true;
    }
    if (!arrivingToday) {
      return new Response('ignored (no reservation arriving today)', { status: 200 });
    }

    // 先に確保してから通知する(通知が多少遅延・失敗しても二重送信は防ぐ)
    await env.STATE.put(stateKey, '1', { expirationTtl: 60 * 60 * 36 });

    ctx.waitUntil(
      notifySlack(
        env,
        `🔑 本日${checkinHour}時以降、最初のロック解錠を検知しました。本日到着の予約があるため、チェックインの可能性があります。(${dateStr})`
      )
    );

    return new Response('ok', { status: 200 });
  },
};

function normalizeMac(mac) {
  return mac.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
}

function jstNow() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour === '24' ? '0' : parts.hour),
  };
}

async function notifySlack(env, text) {
  if (!env.SLACK_WEBHOOK_URL) {
    console.warn('SLACK_WEBHOOK_URL が未設定です:', text);
    return;
  }
  const res = await fetch(env.SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    console.error('Slack通知に失敗しました:', res.status, await res.text());
  }
}

// --- Beds24連携 ---

async function hasArrivalToday(env, dateStr) {
  if (!env.BEDS24_REFRESH_TOKEN) {
    console.warn('BEDS24_REFRESH_TOKEN が未設定のため、Beds24確認をスキップします。');
    return true;
  }

  const accessToken = await getBeds24AccessToken(env);

  const params = new URLSearchParams({
    arrivalFrom: dateStr,
    arrivalTo: dateStr,
    status: 'confirmed',
  });
  if (env.BEDS24_PROPERTY_ID) {
    params.set('propertyId', env.BEDS24_PROPERTY_ID);
  }

  const res = await fetch(`https://beds24.com/api/v2/bookings?${params.toString()}`, {
    headers: { accept: 'application/json', token: accessToken },
  });
  if (!res.ok) {
    throw new Error(`Beds24 bookings APIエラー: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return Array.isArray(data.data) && data.data.length > 0;
}

async function getBeds24AccessToken(env) {
  const cacheKey = 'beds24:accessToken';
  const cached = await env.STATE.get(cacheKey);
  if (cached) return cached;

  const res = await fetch('https://beds24.com/api/v2/authentication/token', {
    headers: { accept: 'application/json', refreshToken: env.BEDS24_REFRESH_TOKEN },
  });
  if (!res.ok) {
    throw new Error(`Beds24認証APIエラー: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const expiresIn = Number(data.expiresIn ?? 3600);
  // 期限ぎりぎりで失効しないよう5分早めにキャッシュを切らす
  await env.STATE.put(cacheKey, data.token, { expirationTtl: Math.max(60, expiresIn - 300) });
  return data.token;
}
