import { ZeroHash, keccak256, toUtf8Bytes } from 'ethers';
import { chain, chainKey, custodyAddress } from './chain.js';
import { registerMerchantOnChain } from './seed.js';
import { passCode, store, uid } from './store.js';
import type { Merchant, Order, Pass, PassType, Product, ProductType, Task, User } from './types.js';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const db = () => store.db;
const nowSec = () => Math.floor(Date.now() / 1000);

export function getUser(id: string | undefined): User {
  const u = db().users.find((x) => x.id === id);
  if (!u) throw new HttpError(401, '请先在右上角选择演示身份');
  return u;
}

export function requireRole(u: User, ...roles: User['role'][]): void {
  if (!roles.includes(u.role)) throw new HttpError(403, `该操作需要${roles.map((r) => ({ player: '玩家', merchant: '商家', admin: '平台运营' })[r]).join('/')}身份`);
}

export function getMerchant(id: string): Merchant {
  const m = db().merchants.find((x) => x.id === id);
  if (!m) throw new HttpError(404, '商家不存在');
  return m;
}

export function merchantOf(u: User): Merchant {
  requireRole(u, 'merchant');
  return getMerchant(u.merchantId!);
}

const PASS_OF: Record<ProductType, PassType> = { onsite: 'Product', shipping: 'Product', ticket: 'Ticket', race_entry: 'RaceEntry' };

/** 订单上链的数据哈希：只包含订单关键字段 + 用户 ID 的哈希，不含任何个人信息 */
export function orderDataHash(o: Order): string {
  const canonical = JSON.stringify({
    orderId: o.id,
    merchantId: o.merchantId,
    productId: o.productId,
    qty: o.qty,
    amountFen: o.amountFen,
    discountFen: o.discountFen,
    payFen: o.payFen,
    paidAt: o.payment?.paidAt ?? 0,
    userHash: keccak256(toUtf8Bytes(`user:${o.userId}`)),
  });
  return keccak256(toUtf8Bytes(canonical));
}

// ---------------------------------------------------------------- 优惠券

export function couponApplicable(userCouponId: string | undefined, userId: string, product: Product, amountFen: number) {
  if (!userCouponId) return { discountFen: 0 };
  const uc = db().userCoupons.find((c) => c.id === userCouponId && c.userId === userId);
  if (!uc) throw new HttpError(400, '优惠券不存在');
  if (uc.status !== 'unused') throw new HttpError(400, '优惠券已使用');
  if (uc.expiresAt < Date.now()) throw new HttpError(400, '优惠券已过期');
  const tpl = db().couponTemplates.find((t) => t.id === uc.templateId)!;
  if (tpl.scopeMerchantId && tpl.scopeMerchantId !== product.merchantId) throw new HttpError(400, '该券不适用于此商家');
  if (amountFen < tpl.minSpendFen) throw new HttpError(400, `未达到使用门槛（满 ${tpl.minSpendFen / 100} 元）`);
  return { discountFen: Math.min(tpl.amountFen, amountFen), uc };
}

export function grantCoupon(userId: string, templateId: string, source: string) {
  const tpl = db().couponTemplates.find((t) => t.id === templateId);
  if (!tpl) return null;
  const uc = { id: uid('uc'), userId, templateId, status: 'unused' as const, source, expiresAt: Date.now() + tpl.validDays * 86400_000, createdAt: Date.now() };
  db().userCoupons.push(uc);
  store.save();
  return { ...uc, title: tpl.title };
}

// ---------------------------------------------------------------- 下单 / 支付 / 发放凭证

export function createOrder(u: User, input: { productId: string; qty?: number; userCouponId?: string; shipping?: Order['shipping']; source?: 'web' | 'game' }): Order {
  requireRole(u, 'player');
  const product = db().products.find((p) => p.id === input.productId);
  if (!product || !product.active) throw new HttpError(404, '商品不存在或已下架');
  const merchant = getMerchant(product.merchantId);
  if (merchant.status !== 'active') throw new HttpError(400, '商家暂停营业');
  const qty = Math.max(1, Math.min(5, Math.floor(input.qty || 1)));
  if (product.type === 'race_entry' && qty !== 1) throw new HttpError(400, '赛事报名每人限 1 份');
  if (product.type === 'race_entry' && db().passes.some((p) => p.userId === u.id && p.passType === 'RaceEntry' && p.title === product.title && p.status !== 'failed')) {
    throw new HttpError(400, '你已经报名过这场赛事');
  }
  if (product.stock < qty) throw new HttpError(400, '库存不足');
  if (product.type === 'shipping' && (!input.shipping?.receiver || !input.shipping?.address)) throw new HttpError(400, '快递商品需要填写收货信息');
  const amountFen = product.priceFen * qty;
  const { discountFen } = couponApplicable(input.userCouponId, u.id, product, amountFen);
  const id = uid('ord');
  const order: Order = {
    id,
    userId: u.id,
    productId: product.id,
    merchantId: product.merchantId,
    qty,
    amountFen,
    discountFen,
    payFen: amountFen - discountFen,
    userCouponId: input.userCouponId,
    status: 'pending',
    shipping: product.type === 'shipping' ? input.shipping : undefined,
    chainOrderId: chainKey('order', id),
    passIds: [],
    source: input.source || 'web',
    createdAt: Date.now(),
  };
  db().orders.unshift(order);
  store.save();
  return order;
}

/**
 * 模拟支付：正式环境替换为「微信支付 · 平台收付通」——资金直接进入商家二级商户号，
 * 平台通过分账接口抽佣、通过补差接口补贴优惠券，平台不沉淀资金。
 */
export async function payOrder(u: User, orderId: string): Promise<Order> {
  const order = db().orders.find((o) => o.id === orderId && o.userId === u.id);
  if (!order) throw new HttpError(404, '订单不存在');
  if (order.status !== 'pending') throw new HttpError(400, '订单已支付');
  const product = db().products.find((p) => p.id === order.productId)!;
  const merchant = getMerchant(order.merchantId);
  // 重新校验券
  const { discountFen, uc } = couponApplicable(order.userCouponId, u.id, product, order.amountFen);
  if (discountFen !== order.discountFen) throw new HttpError(400, '优惠券状态已变化，请重新下单');
  if (product.stock < order.qty) throw new HttpError(400, '库存不足');

  product.stock -= order.qty;
  if (uc) {
    uc.status = 'used';
    uc.usedOrderId = order.id;
  }
  const commissionFen = Math.round((order.amountFen * merchant.commissionBps) / 10000);
  order.payment = { channel: 'mock', tradeNo: `MOCK${Date.now()}${Math.floor(Math.random() * 1000)}`, paidAt: Date.now() };
  order.settlement = { commissionFen, merchantFen: order.amountFen - commissionFen, subsidyFen: order.discountFen };
  order.status = 'paid';
  order.dataHash = orderDataHash(order);
  store.save();

  // 1) 订单哈希存证
  try {
    const r = await chain.anchorOrder(order.chainOrderId, merchant.chainKey, order.dataHash, order.id);
    order.anchorTx = r.receipt.hash;
  } catch (e) {
    console.error('anchorOrder failed', e);
  }
  // 2) 每份商品发放一张不可转让凭证
  const passType = PASS_OF[product.type];
  const validUntil = product.validDays ? nowSec() + product.validDays * 86400 : 0;
  for (let i = 0; i < order.qty; i++) {
    const pass = await issuePass({ user: u, passType, merchant, title: product.title, orderHash: order.dataHash, validUntil, orderId: order.id });
    order.passIds.push(pass.id);
  }
  store.save();
  return order;
}

async function issuePass(p: { user: User; passType: PassType; merchant: Merchant | null; title: string; orderHash: string; validUntil: number; orderId?: string; taskId?: string }): Promise<Pass> {
  const pass: Pass = {
    id: uid('pass'),
    code: passCode(),
    userId: p.user.id,
    orderId: p.orderId,
    taskId: p.taskId,
    passType: p.passType,
    merchantId: p.merchant?.id ?? null,
    title: p.title,
    orderHash: p.orderHash,
    status: 'minting',
    validUntil: p.validUntil,
    createdAt: Date.now(),
  };
  db().passes.unshift(pass);
  store.save();
  try {
    const r = await chain.mintPass(p.user.chainAddress, p.passType, p.merchant?.chainKey ?? ZeroHash, p.orderHash, p.validUntil, p.title);
    pass.tokenId = r.tokenId;
    pass.mintTx = r.receipt.hash;
    pass.status = 'active';
  } catch (e) {
    console.error('mintPass failed', e);
    pass.status = 'failed';
  }
  store.save();
  return pass;
}

export async function retryPass(passId: string): Promise<Pass> {
  const pass = db().passes.find((p) => p.id === passId);
  if (!pass || pass.status !== 'failed') throw new HttpError(400, '只有失败的凭证可以重试');
  const user = getUser(pass.userId);
  const merchant = pass.merchantId ? getMerchant(pass.merchantId) : null;
  pass.status = 'minting';
  try {
    const r = await chain.mintPass(user.chainAddress, pass.passType, merchant?.chainKey ?? ZeroHash, pass.orderHash, pass.validUntil, pass.title);
    pass.tokenId = r.tokenId;
    pass.mintTx = r.receipt.hash;
    pass.status = 'active';
  } catch {
    pass.status = 'failed';
  }
  store.save();
  return pass;
}

// ---------------------------------------------------------------- 核销 / 发货

export async function redeemPass(u: User, code: string): Promise<Pass> {
  const merchant = merchantOf(u);
  const pass = db().passes.find((p) => p.code === code.trim().toUpperCase());
  if (!pass) throw new HttpError(404, '核销码不存在');
  if (pass.merchantId !== merchant.id) throw new HttpError(403, '这不是本店的凭证');
  if (pass.status === 'redeemed') throw new HttpError(400, '该凭证已核销过');
  if (pass.status !== 'active' || !pass.tokenId) throw new HttpError(400, '凭证尚未上链成功');
  if (!['Product', 'Ticket', 'RaceEntry'].includes(pass.passType)) throw new HttpError(400, '证书/徽章不可核销');
  if (pass.validUntil && pass.validUntil < nowSec()) throw new HttpError(400, '凭证已过期');
  const r = await chain.redeem(pass.tokenId, merchant.chainKey, pass.title);
  pass.status = 'redeemed';
  pass.redeemedAt = Date.now();
  pass.redeemTx = r.receipt.hash;
  if (pass.orderId) {
    const order = db().orders.find((o) => o.id === pass.orderId);
    if (order && order.passIds.every((id) => db().passes.find((x) => x.id === id)?.status === 'redeemed')) order.status = 'fulfilled';
  }
  if (pass.passType === 'RaceEntry') {
    const ev = db().events.find((e) => e.merchantId === merchant.id);
    if (ev) {
      const rr = raceResult(pass.userId, ev.id);
      rr.offlineCheckinAt = Date.now();
      await maybeAwardFinisher(pass.userId, ev.id);
    }
  }
  store.save();
  return pass;
}

export async function shipOrder(u: User, orderId: string, trackingNo: string): Promise<Order> {
  const merchant = merchantOf(u);
  const order = db().orders.find((o) => o.id === orderId && o.merchantId === merchant.id);
  if (!order) throw new HttpError(404, '订单不存在');
  if (!order.shipping) throw new HttpError(400, '该订单不是快递商品');
  if (!trackingNo?.trim()) throw new HttpError(400, '请填写快递单号');
  order.shipping.trackingNo = trackingNo.trim();
  // 发货 = 履约：在链上核销对应的商品凭证，留下不可篡改的履约记录
  for (const pid of order.passIds) {
    const pass = db().passes.find((p) => p.id === pid);
    if (pass && pass.status === 'active') await redeemPass(u, pass.code);
  }
  order.status = 'fulfilled';
  store.save();
  return order;
}

// ---------------------------------------------------------------- 赛事

function raceResult(userId: string, eventId: string) {
  let rr = db().raceResults.find((r) => r.userId === userId && r.eventId === eventId);
  if (!rr) {
    rr = { userId, eventId };
    db().raceResults.push(rr);
  }
  return rr;
}

async function maybeAwardFinisher(userId: string, eventId: string) {
  const ev = db().events.find((e) => e.id === eventId)!;
  const rr = raceResult(userId, eventId);
  if (rr.certPassId || !rr.onlineFinishedAt || !rr.offlineCheckinAt) return null;
  const user = getUser(userId);
  const merchant = getMerchant(ev.merchantId);
  const hash = keccak256(toUtf8Bytes(JSON.stringify({ eventId, userHash: keccak256(toUtf8Bytes(`user:${userId}`)), online: rr.onlineDurationSec, offline: rr.offlineCheckinAt })));
  const cert = await issuePass({ user, passType: 'FinisherCert', merchant, title: `${ev.title} · 完赛证书（线上 ${formatDuration(rr.onlineDurationSec || 0)}）`, orderHash: hash, validUntil: 0 });
  rr.certPassId = cert.id;
  const coupon = ev.finisherCouponTemplateId ? grantCoupon(userId, ev.finisherCouponTemplateId, `${ev.title} 完赛奖励`) : null;
  store.save();
  return { cert, coupon };
}

export function formatDuration(sec: number) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}分${String(s).padStart(2, '0')}秒`;
}

// ---------------------------------------------------------------- 游戏事件（打卡 / 赛道）

const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

export interface GameReward { kind: 'badge' | 'coupon' | 'race' | 'cert' | 'info'; text: string; passCode?: string }

export async function handleGameEvent(u: User, ev: { type: string; checkpointId?: string; x?: number; z?: number }) {
  requireRole(u, 'player');
  const rewards: GameReward[] = [];
  const log = (result: string) => {
    db().gameEvents.unshift({ id: uid('ge'), userId: u.id, type: ev.type, checkpointId: ev.checkpointId, x: ev.x, z: ev.z, result, createdAt: Date.now() });
    if (db().gameEvents.length > 300) db().gameEvents.length = 300;
  };
  if (ev.type !== 'enter_checkpoint') throw new HttpError(400, '未知事件类型');
  const cp = db().checkpoints.find((c) => c.id === ev.checkpointId);
  if (!cp) throw new HttpError(404, '打卡点不存在');
  // 基础防作弊：服务端复核坐标是否在打卡点范围内（正式环境应由游戏服务器签名上报）
  if (typeof ev.x === 'number' && typeof ev.z === 'number' && dist(ev.x, ev.z, cp.x, cp.z) > cp.radius * 1.5) {
    log('rejected: out of range');
    throw new HttpError(400, `坐标不在「${cp.name}」范围内`);
  }

  for (const task of db().tasks.filter((t) => t.checkpointIds.includes(cp.id))) {
    let prog = db().taskProgress.find((p) => p.userId === u.id && p.taskId === task.id);
    if (!prog) {
      prog = { userId: u.id, taskId: task.id, visited: [] };
      db().taskProgress.push(prog);
    }
    if (task.type === 'checkin') {
      if (prog.completedAt) continue;
      if (!prog.visited.includes(cp.id)) {
        prog.visited.push(cp.id);
        rewards.push({ kind: 'info', text: `「${task.title}」打卡 ${prog.visited.length}/${task.checkpointIds.length}：${cp.name}` });
      }
      if (task.checkpointIds.every((id) => prog!.visited.includes(id))) {
        prog.completedAt = Date.now();
        rewards.push(...(await rewardTask(u, task)));
      }
    } else if (task.type === 'race') {
      rewards.push(...(await handleRaceCheckpoint(u, task, prog, cp.id)));
    }
  }
  const shop = db().merchants.find((m) => m.status === 'active' && m.location && dist(m.location.x, m.location.z, cp.x, cp.z) < 120);
  log(rewards.map((r) => r.text).join(' | ') || 'no-op');
  store.save();
  return { checkpoint: cp, rewards, shop: shop ? { merchantId: shop.id, name: shop.name } : null };
}

async function rewardTask(u: User, task: Task): Promise<GameReward[]> {
  const out: GameReward[] = [{ kind: 'info', text: `完成任务「${task.title}」！` }];
  const merchant = task.merchantId ? getMerchant(task.merchantId) : null;
  if (task.rewardBadge) {
    const hash = keccak256(toUtf8Bytes(JSON.stringify({ taskId: task.id, userHash: keccak256(toUtf8Bytes(`user:${u.id}`)), at: Date.now() })));
    const badge = await issuePass({ user: u, passType: 'CheckinBadge', merchant, title: `${task.title} · 打卡徽章`, orderHash: hash, validUntil: 0, taskId: task.id });
    out.push({ kind: 'badge', text: `获得链上徽章：${badge.title}`, passCode: badge.code });
  }
  if (task.rewardCouponTemplateId) {
    const c = grantCoupon(u.id, task.rewardCouponTemplateId, task.title);
    if (c) out.push({ kind: 'coupon', text: `获得优惠券：${c.title}` });
  }
  return out;
}

async function handleRaceCheckpoint(u: User, task: Task, prog: NonNullable<ReturnType<typeof db>['taskProgress'][number]>, cpId: string): Promise<GameReward[]> {
  const ev = db().events.find((e) => e.id === task.eventId)!;
  const product = db().products.find((p) => p.id === ev.entryProductId)!;
  const entered = db().passes.some((p) => p.userId === u.id && p.passType === 'RaceEntry' && p.title === product.title && (p.status === 'active' || p.status === 'redeemed'));
  if (!entered) return [{ kind: 'info', text: `你还没有报名「${ev.title}」，先去商城报名再来跑赛道` }];
  const rr = raceResult(u.id, ev.id);
  if (rr.onlineFinishedAt) return [];
  const idx = task.checkpointIds.indexOf(cpId);
  if (idx === 0) {
    prog.visited = [cpId];
    prog.startedAt = Date.now();
    return [{ kind: 'race', text: '线上赛道计时开始！沿民族大道向东跑' }];
  }
  if (!prog.startedAt) return [{ kind: 'info', text: '请先到起点「会展中心站」开始计时' }];
  const expected = task.checkpointIds[prog.visited.length];
  if (cpId !== expected) return prog.visited.includes(cpId) ? [] : [{ kind: 'info', text: '请按赛道顺序通过检查点' }];
  prog.visited.push(cpId);
  if (prog.visited.length < task.checkpointIds.length) return [{ kind: 'race', text: `通过检查点 ${prog.visited.length}/${task.checkpointIds.length}` }];
  prog.completedAt = Date.now();
  prog.durationSec = Math.max(1, Math.round((prog.completedAt - prog.startedAt) / 1000));
  rr.onlineFinishedAt = prog.completedAt;
  rr.onlineDurationSec = prog.durationSec;
  const out: GameReward[] = [{ kind: 'race', text: `线上赛道完成！用时 ${formatDuration(prog.durationSec)}${rr.offlineCheckinAt ? '' : '；记得线下现场签到领取完赛证书'}` }];
  const award = await maybeAwardFinisher(u.id, ev.id);
  if (award) {
    out.push({ kind: 'cert', text: `获得链上完赛证书：${award.cert.title}`, passCode: award.cert.code });
    if (award.coupon) out.push({ kind: 'coupon', text: `获得优惠券：${award.coupon.title}` });
  }
  return out;
}

// ---------------------------------------------------------------- 验证 / 对账

const maskName = (n: string) => {
  const core = n.split('·').pop()!.trim();
  return `${core.slice(0, 1)}${'*'.repeat(Math.max(1, core.length - 1))}`;
};

export async function verifyPass(code: string) {
  const pass = db().passes.find((p) => p.code === code.trim().toUpperCase());
  if (!pass) throw new HttpError(404, '凭证不存在');
  const merchant = pass.merchantId ? getMerchant(pass.merchantId) : null;
  const holder = getUser(pass.userId);
  let onchain = null;
  let checks: { label: string; ok: boolean }[] = [];
  if (pass.tokenId) {
    onchain = await chain.readPass(pass.tokenId);
    checks = [
      { label: '链上持有人 = 平台为该玩家托管的地址', ok: onchain.holder.toLowerCase() === holder.chainAddress.toLowerCase() },
      { label: '链上发放方 = 该商家的登记 ID', ok: onchain.merchantId === (merchant?.chainKey ?? ZeroHash) },
      { label: '链上关联数据哈希 = 平台订单/任务哈希', ok: onchain.orderHash === pass.orderHash },
      { label: '链上核销状态与平台记录一致', ok: (onchain.redeemedAt > 0) === (pass.status === 'redeemed') },
    ];
    if (pass.orderId) {
      const order = db().orders.find((o) => o.id === pass.orderId)!;
      const anchor = await chain.readOrderAnchor(order.chainOrderId);
      checks.push({ label: '订单存证哈希（链上）= 重新计算的订单哈希', ok: anchor === orderDataHash(order) });
    }
  }
  return {
    pass: { ...pass, userId: undefined, holderName: maskName(holder.name) },
    merchant: merchant ? { id: merchant.id, name: merchant.name, chainKey: merchant.chainKey } : null,
    onchain,
    checks,
  };
}

export async function reconcile(merchantId: string) {
  const merchant = getMerchant(merchantId);
  const orders = db().orders.filter((o) => o.merchantId === merchantId && o.status !== 'pending');
  const rows: { orderId: string; product?: string; amountFen: number; payFen: number; subsidyFen: number; commissionFen: number; merchantFen: number; localHash: string; chainHash: string; match: boolean; anchorTx?: string; paidAt?: number }[] = [];
  for (const o of orders) {
    const onchain = await chain.readOrderAnchor(o.chainOrderId);
    rows.push({
      orderId: o.id,
      product: db().products.find((p) => p.id === o.productId)?.title,
      amountFen: o.amountFen,
      payFen: o.payFen,
      subsidyFen: o.settlement?.subsidyFen ?? 0,
      commissionFen: o.settlement?.commissionFen ?? 0,
      merchantFen: o.settlement?.merchantFen ?? 0,
      localHash: orderDataHash(o),
      chainHash: onchain,
      match: onchain === orderDataHash(o),
      anchorTx: o.anchorTx,
      paidAt: o.payment?.paidAt,
    });
  }
  const sum = (k: 'amountFen' | 'payFen' | 'subsidyFen' | 'commissionFen' | 'merchantFen') => rows.reduce((s, r) => s + (r[k] as number), 0);
  return {
    merchant: { id: merchant.id, name: merchant.name, commissionBps: merchant.commissionBps },
    totals: { orders: rows.length, amountFen: sum('amountFen'), payFen: sum('payFen'), subsidyFen: sum('subsidyFen'), commissionFen: sum('commissionFen'), merchantFen: sum('merchantFen'), mismatches: rows.filter((r) => !r.match).length },
    rows,
  };
}

// ---------------------------------------------------------------- 商家入驻 / 审核

export function applyMerchant(input: { name: string; kind: Merchant['kind']; category: string; intro: string; address: string; licenseNo: string; contact: string }) {
  if (!input.name?.trim() || !input.licenseNo?.trim()) throw new HttpError(400, '请填写店名和营业执照号');
  const id = uid('mer');
  const m: Merchant = {
    id,
    name: input.name.trim(),
    kind: ['merchant', 'scenic', 'event'].includes(input.kind) ? input.kind : 'merchant',
    category: input.category || '其他',
    intro: input.intro || '',
    address: input.address || '',
    licenseNo: input.licenseNo.replace(/^(.{4}).*(.{4})$/, '$1****$2'),
    contact: input.contact || '',
    status: 'pending',
    commissionBps: 1000,
    chainKey: chainKey('merchant', id),
    chainAccount: custodyAddress(`merchant:${id}`),
    createdAt: Date.now(),
  };
  const user: User = { id: uid('u'), name: `${m.name} 店长`, role: 'merchant', merchantId: id, avatar: '🏪', chainAddress: custodyAddress(`user:${id}`) };
  db().merchants.push(m);
  db().users.push(user);
  store.save();
  return { merchant: m, user };
}

export async function reviewMerchant(merchantId: string, action: 'approve' | 'reject' | 'suspend' | 'resume') {
  const m = getMerchant(merchantId);
  if (action === 'approve') {
    if (m.status !== 'pending') throw new HttpError(400, '只有待审核商家可以通过');
    await registerMerchantOnChain(m);
    m.status = 'active';
  } else if (action === 'reject') {
    if (m.status !== 'pending') throw new HttpError(400, '只有待审核商家可以驳回');
    m.status = 'rejected';
  } else if (action === 'suspend') {
    if (m.status !== 'active') throw new HttpError(400, '只有营业中的商家可以暂停');
    await chain.setMerchantStatus(m.chainKey, 'suspended', m.name);
    m.status = 'suspended';
  } else {
    if (m.status !== 'suspended') throw new HttpError(400, '只有已暂停商家可以恢复');
    await chain.setMerchantStatus(m.chainKey, 'active', m.name);
    m.status = 'active';
  }
  store.save();
  return m;
}

export function upsertProduct(u: User, input: Partial<Product> & { id?: string }) {
  const merchant = merchantOf(u);
  if (merchant.status !== 'active') throw new HttpError(400, '商家审核通过后才能上架商品');
  const types: ProductType[] = merchant.kind === 'event' ? ['race_entry'] : merchant.kind === 'scenic' ? ['ticket', 'onsite', 'shipping'] : ['onsite', 'shipping'];
  if (input.id) {
    const p = db().products.find((x) => x.id === input.id && x.merchantId === merchant.id);
    if (!p) throw new HttpError(404, '商品不存在');
    if (input.title !== undefined) p.title = String(input.title).slice(0, 40);
    if (input.priceFen !== undefined) p.priceFen = Math.max(1, Math.round(Number(input.priceFen)));
    if (input.stock !== undefined) p.stock = Math.max(0, Math.round(Number(input.stock)));
    if (input.validDays !== undefined) p.validDays = Math.max(0, Math.round(Number(input.validDays)));
    if (input.description !== undefined) p.description = String(input.description).slice(0, 200);
    if (input.active !== undefined) p.active = Boolean(input.active);
    if (input.emoji) p.emoji = String(input.emoji).slice(0, 4);
    store.save();
    return p;
  }
  const type = input.type as ProductType;
  if (!types.includes(type)) throw new HttpError(400, `该类型商家只能上架：${types.join(' / ')}`);
  if (!input.title || !input.priceFen) throw new HttpError(400, '请填写商品名和价格');
  const p: Product = {
    id: uid('prod'),
    merchantId: merchant.id,
    title: String(input.title).slice(0, 40),
    type,
    priceFen: Math.max(1, Math.round(Number(input.priceFen))),
    stock: Math.max(0, Math.round(Number(input.stock ?? 100))),
    validDays: Math.max(0, Math.round(Number(input.validDays ?? (type === 'shipping' ? 0 : 30)))),
    description: String(input.description || '').slice(0, 200),
    emoji: String(input.emoji || '🛍️').slice(0, 4),
    active: true,
    createdAt: Date.now(),
  };
  db().products.push(p);
  store.save();
  return p;
}

export function adminStats() {
  const paid = db().orders.filter((o) => o.status !== 'pending');
  const sum = (f: (o: Order) => number) => paid.reduce((s, o) => s + f(o), 0);
  return {
    gmvFen: sum((o) => o.amountFen),
    playerPaidFen: sum((o) => o.payFen),
    commissionFen: sum((o) => o.settlement?.commissionFen ?? 0),
    subsidyFen: sum((o) => o.settlement?.subsidyFen ?? 0),
    orders: paid.length,
    passes: db().passes.length,
    redeemed: db().passes.filter((p) => p.status === 'redeemed').length,
    merchantsActive: db().merchants.filter((m) => m.status === 'active').length,
    merchantsPending: db().merchants.filter((m) => m.status === 'pending').length,
    chainTxConfirmed: db().chainTxs.filter((t) => t.status === 'confirmed').length,
    chainTxFailed: db().chainTxs.filter((t) => t.status === 'failed').length,
  };
}
