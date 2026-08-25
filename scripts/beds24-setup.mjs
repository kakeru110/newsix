#!/usr/bin/env node
// Beds24のinvite codeをrefreshTokenに交換する(初回セットアップ用に手元で一度だけ実行する)。
//
// 使い方:
//   node scripts/beds24-setup.mjs <invite code>
//
// invite codeはBeds24管理画面の SETTINGS > ACCOUNT > ACCESS (API) で、
// 「bookings」の読み取りスコープを付けて発行する。

const [, , inviteCode] = process.argv;

if (!inviteCode) {
  console.error('使い方: node scripts/beds24-setup.mjs <invite code>');
  process.exit(1);
}

const res = await fetch('https://beds24.com/api/v2/authentication/setup', {
  headers: { accept: 'application/json', code: inviteCode },
});
const data = await res.json();

if (!res.ok) {
  console.error('取得失敗:', JSON.stringify(data, null, 2));
  process.exit(1);
}

console.log('=== 取得結果 ===');
console.log(JSON.stringify(data, null, 2));
console.log('');
console.log('refreshToken を控えて、以下でCloudflareに登録してください:');
console.log('  cd cloudflare-worker && npx wrangler secret put BEDS24_REFRESH_TOKEN');
