// 民泊チェックイン検知 Webhook受信 (Cloudflare Workers)
//
// SwitchBotロックのWebhookを受け取り、15時(JST, CHECKIN_HOURで変更可)以降に
// 最初に解錠(UNLOCKED)されたイベントだけSlackに通知する。
// 通知済みかどうかは Workers KV (STATE) に "notified:YYYY-MM-DD" として保存し、
// JSTの日付をまたぐと自動的に別キーになるので実質的に毎日リセットされる。

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

    // 先に確保してから通知する(通知が多少遅延・失敗しても二重送信は防ぐ)
    await env.STATE.put(stateKey, '1', { expirationTtl: 60 * 60 * 36 });

    ctx.waitUntil(
      notifySlack(
        env,
        `🔑 本日${checkinHour}時以降、最初のロック解錠を検知しました。チェックインの可能性があります。(${dateStr})`
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
