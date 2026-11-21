import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.CHAIN_MODE = 'local';
process.env.LOCAL_CHAIN_PORT = '18545';

const { boot, buildApp } = await import('../src/index.js');
const { chain } = await import('../src/chain.js');

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;

const call = async (method: 'GET' | 'POST', url: string, user?: string, body?: unknown) => {
  const res = await app.inject({ method, url, headers: user ? { 'x-demo-user': user } : {}, payload: body as never });
  return { status: res.statusCode, json: res.json() };
};

before(async () => {
  await boot();
  app = await buildApp();
});
after(async () => {
  await app.close();
  await chain.stop();
});

test('链信息：London 硬分叉本地链 + 两个合约已部署', async () => {
  const r = await call('GET', '/api/chain/info');
  assert.equal(r.status, 200);
  assert.equal(r.json.mode, 'local');
  assert.match(r.json.registryAddress, /^0x[0-9a-fA-F]{40}$/);
  assert.match(r.json.passAddress, /^0x[0-9a-fA-F]{40}$/);
});

test('商家闭环：用券下单 -> 模拟支付 -> 订单存证 + 凭证上链 -> 验证 -> 核销 -> 重复核销被拒', async () => {
  const coupons = (await call('GET', '/api/me/coupons', 'p_aning')).json;
  const welcome = coupons.find((c: { templateId: string }) => c.templateId === 'ct_welcome');
  const order = (await call('POST', '/api/orders', 'p_aning', { productId: 'prod_laoyou', qty: 2, userCouponId: welcome.id })).json;
  assert.equal(order.amountFen, 3600);
  assert.equal(order.discountFen, 500);
  assert.equal(order.payFen, 3100);
  const paid = await call('POST', `/api/orders/${order.id}/pay`, 'p_aning');
  assert.equal(paid.status, 200, JSON.stringify(paid.json));
  assert.equal(paid.json.passes.length, 2);
  assert.ok(paid.json.anchorTx);
  assert.equal(paid.json.settlement.commissionFen, 360);
  assert.equal(paid.json.settlement.subsidyFen, 500);
  const code = paid.json.passes[0].code;

  const v = await call('GET', `/api/passes/verify/${code}`);
  assert.equal(v.status, 200);
  assert.ok(v.json.checks.length >= 5);
  assert.ok(v.json.checks.every((c: { ok: boolean }) => c.ok), JSON.stringify(v.json.checks));

  const wrong = await call('POST', '/api/merchant/redeem', 'u_zhuangjin', { code });
  assert.equal(wrong.status, 403);
  const ok = await call('POST', '/api/merchant/redeem', 'u_laoyou', { code });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.status, 'redeemed');
  const again = await call('POST', '/api/merchant/redeem', 'u_laoyou', { code });
  assert.equal(again.status, 400);
  const v2 = await call('GET', `/api/passes/verify/${code}`);
  assert.ok(v2.json.onchain.redeemedAt > 0);

  const tx = await call('GET', `/api/chain/tx/${ok.json.redeemTx}`);
  assert.equal(tx.json.call.method, 'redeem');
  assert.equal(tx.json.events[0].name, 'PassRedeemed');
});

test('快递周边：下单 -> 发货 = 链上履约记录', async () => {
  const order = (await call('POST', '/api/orders', 'p_xiaoyong', { productId: 'prod_keychain', shipping: { receiver: '小邕', phone: '138****0000', address: '南宁市青秀区（示例）' } })).json;
  await call('POST', `/api/orders/${order.id}/pay`, 'p_xiaoyong');
  const shipped = await call('POST', `/api/merchant/orders/${order.id}/ship`, 'u_zhuangjin', { trackingNo: 'SF1234567890' });
  assert.equal(shipped.status, 200, JSON.stringify(shipped.json));
  assert.equal(shipped.json.status, 'fulfilled');
  assert.equal(shipped.json.passes[0].status, 'redeemed');
});

test('景区打卡：坐标校验 + 两个打卡点 -> 链上徽章 + 景区优惠券', async () => {
  const far = await call('POST', '/api/game/events', 'p_aning', { type: 'enter_checkpoint', checkpointId: 'cp_minghu', x: 900, z: -400 });
  assert.equal(far.status, 400);
  const a = await call('POST', '/api/game/events', 'p_aning', { type: 'enter_checkpoint', checkpointId: 'cp_minghu', x: -180, z: 150 });
  assert.equal(a.status, 200);
  const b = await call('POST', '/api/game/events', 'p_aning', { type: 'enter_checkpoint', checkpointId: 'cp_shimen', x: -450, z: 230 });
  const kinds = b.json.rewards.map((r: { kind: string }) => r.kind);
  assert.ok(kinds.includes('badge'), JSON.stringify(b.json));
  assert.ok(kinds.includes('coupon'));
  assert.equal(b.json.shop.merchantId, 'mer_shimen');
});

test('马拉松：未报名提示 -> 报名 -> 线上按顺序跑完 -> 线下签到 -> 完赛证书', async () => {
  const before = await call('POST', '/api/game/events', 'p_aning', { type: 'enter_checkpoint', checkpointId: 'cp_m_expo', x: -681, z: -405 });
  assert.match(before.json.rewards[0].text, /还没有报名/);
  const order = (await call('POST', '/api/orders', 'p_aning', { productId: 'prod_marathon' })).json;
  const paid = (await call('POST', `/api/orders/${order.id}/pay`, 'p_aning')).json;
  const entryCode = paid.passes[0].code;
  for (const [id, x, z] of [['cp_m_expo', -681, -405], ['cp_m_wanxiang', 147, -404], ['cp_m_cbd', 905, -399]] as const) {
    const r = await call('POST', '/api/game/events', 'p_aning', { type: 'enter_checkpoint', checkpointId: id, x, z });
    assert.equal(r.status, 200);
  }
  const prog = (await call('GET', '/api/me/progress', 'p_aning')).json;
  assert.ok(prog.races[0].result.onlineFinishedAt);
  await call('POST', '/api/merchant/redeem', 'u_marathon', { code: entryCode });
  const passes = (await call('GET', '/api/me/passes', 'p_aning')).json;
  assert.ok(passes.some((p: { passType: string; status: string }) => p.passType === 'FinisherCert' && p.status === 'active'));
  const dup = await call('POST', '/api/orders', 'p_aning', { productId: 'prod_marathon' });
  assert.equal(dup.status, 400);
});

test('对账：所有已支付订单的链上存证哈希都与平台记录一致', async () => {
  const r = await call('GET', '/api/merchant/reconcile', 'u_laoyou');
  assert.equal(r.status, 200);
  assert.ok(r.json.totals.orders >= 1);
  assert.equal(r.json.totals.mismatches, 0);
});

test('平台审核：待审核商家通过 -> 链上登记 -> 可上架商品；非管理员不能审核', async () => {
  const denied = await call('POST', '/api/admin/merchants/mer_tea/approve', 'p_aning');
  assert.equal(denied.status, 403);
  const before = await call('POST', '/api/merchant/products', 'u_tea', { title: '六堡茶', type: 'onsite', priceFen: 2000 });
  assert.equal(before.status, 400);
  const ok = await call('POST', '/api/admin/merchants/mer_tea/approve', 'u_admin');
  assert.equal(ok.status, 200);
  assert.equal(ok.json.status, 'active');
  assert.ok(ok.json.registerTx);
  const p = await call('POST', '/api/merchant/products', 'u_tea', { title: '六堡茶', type: 'onsite', priceFen: 2000 });
  assert.equal(p.status, 200);
  const stats = (await call('GET', '/api/admin/overview', 'u_admin')).json.stats;
  assert.equal(stats.chainTxFailed, 0);
});
