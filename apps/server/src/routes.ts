import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { chain } from './chain.js';
import { config } from './config.js';
import { seed } from './seed.js';
import * as svc from './services.js';
import { store } from './store.js';

const userOf = (req: FastifyRequest) => svc.getUser((req.headers['x-demo-user'] as string) || undefined);
const db = () => store.db;

function publicOrder(o: (typeof store.db.orders)[number]) {
  const product = db().products.find((p) => p.id === o.productId);
  const merchant = db().merchants.find((m) => m.id === o.merchantId);
  const passes = o.passIds.map((id) => db().passes.find((p) => p.id === id)).filter(Boolean);
  const buyer = db().users.find((u) => u.id === o.userId);
  return { ...o, productTitle: product?.title, productEmoji: product?.emoji, productType: product?.type, merchantName: merchant?.name, buyerName: buyer?.name, passes };
}

function couponsOf(userId: string) {
  return db().userCoupons
    .filter((c) => c.userId === userId)
    .map((c) => ({ ...c, template: db().couponTemplates.find((t) => t.id === c.templateId) }));
}

export async function registerRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------ 公共
  app.get('/api/health', async () => ({ ok: true, chainReady: chain.ready }));

  app.get('/api/chain/info', async () => chain.info());

  app.get('/api/chain/tx/:hash', async (req) => {
    const { hash } = req.params as { hash: string };
    const tx = await chain.describeTx(hash);
    if (!tx) throw new svc.HttpError(404, '交易不存在');
    const rec = db().chainTxs.find((t) => t.hash === hash);
    return { ...tx, summary: rec?.summary };
  });

  app.get('/api/chain/txs', async () => db().chainTxs.slice(0, 100));

  app.get('/api/demo/users', async () => db().users.map((u) => ({ id: u.id, name: u.name, role: u.role, merchantId: u.merchantId, avatar: u.avatar })));

  app.get('/api/me', async (req) => {
    const u = userOf(req);
    return { ...u, merchant: u.merchantId ? db().merchants.find((m) => m.id === u.merchantId) : undefined };
  });

  app.get('/api/merchants', async () =>
    db().merchants.filter((m) => m.status === 'active').map((m) => ({ ...m, products: db().products.filter((p) => p.merchantId === m.id && p.active) })));

  app.get('/api/products', async () =>
    db().products.filter((p) => p.active && db().merchants.find((m) => m.id === p.merchantId)?.status === 'active')
      .map((p) => ({ ...p, merchantName: db().merchants.find((m) => m.id === p.merchantId)?.name })));

  app.get('/api/passes/verify/:code', async (req) => svc.verifyPass((req.params as { code: string }).code));

  // ERC-1155 元数据（合约 uri 指向这里）
  app.get('/api/passes/meta/:tokenId', async (req) => {
    const tokenId = Number(String((req.params as { tokenId: string }).tokenId).replace(/^0+/, '') || 0);
    const pass = db().passes.find((p) => p.tokenId === tokenId || p.tokenId === parseInt(String((req.params as { tokenId: string }).tokenId), 16));
    if (!pass) throw new svc.HttpError(404, 'not found');
    return { name: pass.title, description: '网上南宁 · 不可转让电子凭证（权益记录，非代币，不可交易）', properties: { passType: pass.passType, code: pass.code } };
  });

  // ------------------------------------------------------------ 玩家
  app.post('/api/orders', async (req) => svc.createOrder(userOf(req), req.body as never));
  app.post('/api/orders/:id/pay', async (req) => publicOrder(await svc.payOrder(userOf(req), (req.params as { id: string }).id)));
  app.get('/api/me/orders', async (req) => {
    const u = userOf(req);
    return db().orders.filter((o) => o.userId === u.id).map(publicOrder);
  });
  app.get('/api/me/passes', async (req) => {
    const u = userOf(req);
    return db().passes.filter((p) => p.userId === u.id).map((p) => ({ ...p, merchantName: db().merchants.find((m) => m.id === p.merchantId)?.name ?? '网上南宁平台' }));
  });
  app.get('/api/me/coupons', async (req) => couponsOf(userOf(req).id));
  app.get('/api/me/progress', async (req) => {
    const u = userOf(req);
    return {
      tasks: db().tasks.map((t) => ({ ...t, progress: db().taskProgress.find((p) => p.userId === u.id && p.taskId === t.id) ?? null })),
      races: db().events.map((e) => ({ ...e, result: db().raceResults.find((r) => r.userId === u.id && r.eventId === e.id) ?? null })),
    };
  });

  // ------------------------------------------------------------ 游戏对接
  app.get('/api/game/config', async () => ({
    coordinateSystem: '网上南宁地图坐标：原点 22.812°N 108.386°E，x 向东、z 向南，单位米（与 public/data/nanning.json 一致）',
    checkpoints: db().checkpoints,
    tasks: db().tasks,
    shops: db().merchants.filter((m) => m.status === 'active' && m.location).map((m) => ({ merchantId: m.id, name: m.name, kind: m.kind, ...m.location })),
  }));

  app.post('/api/game/events', async (req) => {
    if (config.gameHmacSecret) {
      // 正式对接：游戏服务器用共享密钥对请求体签名，防止客户端伪造打卡
      const sig = String(req.headers['x-game-signature'] || '');
      const expected = createHmac('sha256', config.gameHmacSecret).update(JSON.stringify(req.body)).digest('hex');
      if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new svc.HttpError(401, '游戏事件签名无效');
    }
    const body = req.body as { playerId?: string; type: string; checkpointId?: string; x?: number; z?: number };
    const u = svc.getUser(body.playerId || (req.headers['x-demo-user'] as string));
    return svc.handleGameEvent(u, body);
  });

  // ------------------------------------------------------------ 商家后台
  app.post('/api/merchants/apply', async (req) => svc.applyMerchant(req.body as never));
  app.get('/api/merchant/overview', async (req) => {
    const m = svc.merchantOf(userOf(req));
    const orders = db().orders.filter((o) => o.merchantId === m.id).map(publicOrder);
    return { merchant: m, products: db().products.filter((p) => p.merchantId === m.id), orders };
  });
  app.post('/api/merchant/products', async (req) => svc.upsertProduct(userOf(req), req.body as never));
  app.post('/api/merchant/redeem', async (req) => svc.redeemPass(userOf(req), String((req.body as { code: string }).code || '')));
  app.post('/api/merchant/orders/:id/ship', async (req) => publicOrder(await svc.shipOrder(userOf(req), (req.params as { id: string }).id, String((req.body as { trackingNo: string }).trackingNo || ''))));
  app.get('/api/merchant/reconcile', async (req) => svc.reconcile(svc.merchantOf(userOf(req)).id));

  // ------------------------------------------------------------ 平台运营
  const admin = (req: FastifyRequest) => {
    const u = userOf(req);
    svc.requireRole(u, 'admin');
    return u;
  };
  app.get('/api/admin/overview', async (req) => {
    admin(req);
    return {
      stats: svc.adminStats(),
      merchants: db().merchants,
      couponTemplates: db().couponTemplates,
      tasks: db().tasks,
      orders: db().orders.slice(0, 50).map(publicOrder),
      gameEvents: db().gameEvents.slice(0, 50),
    };
  });
  app.post('/api/admin/merchants/:id/:action', async (req) => {
    admin(req);
    const { id, action } = req.params as { id: string; action: 'approve' | 'reject' | 'suspend' | 'resume' };
    return svc.reviewMerchant(id, action);
  });
  app.post('/api/admin/passes/:id/retry', async (req) => {
    admin(req);
    return svc.retryPass((req.params as { id: string }).id);
  });
  app.post('/api/admin/coupons/grant', async (req) => {
    admin(req);
    const { userId, templateId } = req.body as { userId: string; templateId: string };
    svc.getUser(userId);
    return svc.grantCoupon(userId, templateId, '平台运营发放');
  });
  app.post('/api/admin/reset', async (req) => {
    admin(req);
    if (config.chainMode === 'bsn') throw new svc.HttpError(400, 'BSN 模式下不允许重置（链上数据不可删除）');
    store.reset();
    // 旧合约里商家已登记过：local 模式下重新部署一套新合约，再重新灌入演示数据
    await chain.useContracts();
    await seed();
    return { ok: true };
  });
}
