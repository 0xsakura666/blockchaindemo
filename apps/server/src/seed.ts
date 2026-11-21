import { keccak256, toUtf8Bytes } from 'ethers';
import { chain, chainKey, custodyAddress } from './chain.js';
import { store } from './store.js';
import type { Checkpoint, CouponTemplate, Merchant, Product, RaceEvent, Task, User } from './types.js';

const now = () => Date.now();

/**
 * 游戏打卡点：坐标直接取自《网上南宁》地图数据 public/data/nanning.json 的 labels
 * （以 22.812°N, 108.386°E 为原点的米制坐标，x 向东、z 向南）。
 */
export const CHECKPOINTS: Checkpoint[] = [
  { id: 'cp_wanxiang', name: '万象城', x: 288, z: -256.1, radius: 60, kind: 'landmark' },
  { id: 'cp_sanqi', name: '三祺广场', x: 683.8, z: -266.9, radius: 60, kind: 'landmark' },
  { id: 'cp_minghu', name: '明湖', x: -180.6, z: 146, radius: 80, kind: 'water' },
  { id: 'cp_shimen', name: '石门森林公园', x: -449.2, z: 229.4, radius: 90, kind: 'landmark' },
  { id: 'cp_expo', name: '南宁国际会展中心', x: -1060.9, z: 39.3, radius: 90, kind: 'landmark' },
  { id: 'cp_m_expo', name: 'Ⓜ 会展中心站（起点）', x: -681.5, z: -405.9, radius: 45, kind: 'metro' },
  { id: 'cp_m_wanxiang', name: 'Ⓜ 万象城站（中途点）', x: 147.2, z: -404.8, radius: 45, kind: 'metro' },
  { id: 'cp_m_cbd', name: 'Ⓜ 东盟商务区站（终点）', x: 905.6, z: -399.7, radius: 45, kind: 'metro' },
];

export async function seed(): Promise<void> {
  const db = store.db;
  const t = now();

  const merchants: Omit<Merchant, 'chainKey' | 'chainAccount' | 'createdAt'>[] = [
    { id: 'mer_laoyou', name: '老友粉 · 三祺店（示例商家）', kind: 'merchant', category: '餐饮', intro: '南宁老友粉，酸辣鲜香。游戏内下单，到店出示核销码即可。', address: '青秀区 三祺广场一层（示例）', licenseNo: '9145****0001', contact: '0771-****001', status: 'active', commissionBps: 1000, location: { x: 683.8, z: -266.9, label: '三祺广场' } },
    { id: 'mer_zhuangjin', name: '壮锦文创 · 万象城店（示例商家）', kind: 'merchant', category: '文创周边', intro: '朱槿花、壮锦纹样等南宁文创周边，下单后快递到家。', address: '青秀区 万象城 L2（示例）', licenseNo: '9145****0002', contact: '0771-****002', status: 'active', commissionBps: 1000, location: { x: 288, z: -256.1, label: '万象城' } },
    { id: 'mer_shimen', name: '石门森林公园（示例景区）', kind: 'scenic', category: '景区', intro: '城市森林公园与明湖。游戏里打卡可领门票优惠，现场扫码入园。', address: '青秀区 石门森林公园（示例）', licenseNo: '1245****0003', contact: '0771-****003', status: 'active', commissionBps: 500, location: { x: -449.2, z: 229.4, label: '石门森林公园' } },
    { id: 'mer_marathon', name: '南宁马拉松组委会（示例主办方）', kind: 'event', category: '赛事', intro: '线上民族大道赛道 + 线下现场签到，双线完成可获链上完赛证书。', address: '南宁国际会展中心（示例）', licenseNo: '5345****0004', contact: '0771-****004', status: 'active', commissionBps: 300, location: { x: -1060.9, z: 39.3, label: '南宁国际会展中心' } },
    { id: 'mer_tea', name: '邕州茶语（示例商家）', kind: 'merchant', category: '茶饮', intro: '六堡茶、茉莉花茶。等待平台审核入驻。', address: '青秀区 民族大道（示例）', licenseNo: '9245****0005', contact: '0771-****005', status: 'pending', commissionBps: 1000 },
  ];
  db.merchants = merchants.map((m) => ({ ...m, chainKey: chainKey('merchant', m.id), chainAccount: custodyAddress(`merchant:${m.id}`), createdAt: t }));

  const users: Omit<User, 'chainAddress'>[] = [
    { id: 'p_aning', name: '玩家 · 阿宁', role: 'player', avatar: '🧑‍🚀' },
    { id: 'p_xiaoyong', name: '玩家 · 小邕', role: 'player', avatar: '🧑‍🎤' },
    { id: 'u_laoyou', name: '老友粉店长', role: 'merchant', merchantId: 'mer_laoyou', avatar: '🍜' },
    { id: 'u_zhuangjin', name: '壮锦文创店长', role: 'merchant', merchantId: 'mer_zhuangjin', avatar: '🧵' },
    { id: 'u_shimen', name: '石门森林公园售票处', role: 'merchant', merchantId: 'mer_shimen', avatar: '🌳' },
    { id: 'u_marathon', name: '马拉松组委会', role: 'merchant', merchantId: 'mer_marathon', avatar: '🏃' },
    { id: 'u_tea', name: '邕州茶语老板（入驻待审核）', role: 'merchant', merchantId: 'mer_tea', avatar: '🍵' },
    { id: 'u_admin', name: '网上南宁 · 平台运营', role: 'admin', avatar: '🛡️' },
  ];
  db.users = users.map((u) => ({ ...u, chainAddress: custodyAddress(`user:${u.id}`) }));

  const products: Omit<Product, 'createdAt'>[] = [
    { id: 'prod_laoyou', merchantId: 'mer_laoyou', title: '招牌老友粉（到店核销）', type: 'onsite', priceFen: 1800, stock: 500, validDays: 30, description: '酸笋 + 豆豉 + 猪肉，经典老友味。', emoji: '🍜', active: true },
    { id: 'prod_ningmeng', merchantId: 'mer_laoyou', title: '柠檬鸭双人套餐（到店核销）', type: 'onsite', priceFen: 3800, stock: 200, validDays: 30, description: '南宁柠檬鸭 + 两份米饭。', emoji: '🦆', active: true },
    { id: 'prod_keychain', merchantId: 'mer_zhuangjin', title: '朱槿花钥匙扣（快递）', type: 'shipping', priceFen: 2900, stock: 300, validDays: 0, description: '南宁市花朱槿，金属珐琅工艺。', emoji: '🌺', active: true },
    { id: 'prod_tshirt', merchantId: 'mer_zhuangjin', title: '网上南宁限定 T 恤（快递）', type: 'shipping', priceFen: 8900, stock: 100, validDays: 0, description: '赛博南宁夜景印花。', emoji: '👕', active: true },
    { id: 'prod_boat', merchantId: 'mer_shimen', title: '明湖游船票（现场扫码）', type: 'ticket', priceFen: 3000, stock: 1000, validDays: 90, description: '凭链上门票凭证现场扫码登船。', emoji: '🚣', active: true },
    { id: 'prod_bag', merchantId: 'mer_shimen', title: '景区限定帆布袋（游客中心自提）', type: 'onsite', priceFen: 4500, stock: 200, validDays: 60, description: '石门森林公园插画帆布袋。', emoji: '👜', active: true },
    { id: 'prod_marathon', merchantId: 'mer_marathon', title: '南宁马拉松 · 欢乐跑报名（线上+线下）', type: 'race_entry', priceFen: 9900, stock: 2000, validDays: 120, description: '报名后获得链上参赛凭证：游戏内跑完民族大道赛道 + 现场签到，即获完赛证书。', emoji: '🏅', active: true, eventId: 'ev_marathon' },
  ];
  db.products = products.map((p) => ({ ...p, createdAt: t }));

  const coupons: CouponTemplate[] = [
    { id: 'ct_welcome', title: '新人券：满 20 减 5', amountFen: 500, minSpendFen: 2000, scopeMerchantId: null, validDays: 30, note: '平台出资，全平台通用' },
    { id: 'ct_scenic', title: '明湖打卡奖励：景区满 30 减 10', amountFen: 1000, minSpendFen: 3000, scopeMerchantId: 'mer_shimen', validDays: 30, note: '完成「石门森林公园 · 明湖探索」获得' },
    { id: 'ct_finisher', title: '完赛奖励：老友粉满 18 减 8', amountFen: 800, minSpendFen: 1800, scopeMerchantId: 'mer_laoyou', validDays: 30, note: '马拉松线上 + 线下双线完赛获得' },
  ];
  db.couponTemplates = coupons;

  db.checkpoints = CHECKPOINTS;
  const tasks: Task[] = [
    { id: 'task_scenic', title: '石门森林公园 · 明湖探索', type: 'checkin', description: '在游戏里走到明湖和石门森林公园，获得链上打卡徽章和景区门票优惠券。', checkpointIds: ['cp_minghu', 'cp_shimen'], merchantId: 'mer_shimen', rewardBadge: true, rewardCouponTemplateId: 'ct_scenic' },
    { id: 'task_city', title: '城市漫游 · 东盟商务区', type: 'checkin', description: '走到万象城和三祺广场，获得平台漫游徽章。', checkpointIds: ['cp_wanxiang', 'cp_sanqi'], merchantId: null, rewardBadge: true },
    { id: 'task_race', title: '南宁马拉松 · 民族大道线上赛道', type: 'race', description: '从会展中心站出发，经万象城站，跑到东盟商务区站（按顺序）。需先报名。', checkpointIds: ['cp_m_expo', 'cp_m_wanxiang', 'cp_m_cbd'], merchantId: 'mer_marathon', rewardBadge: false, eventId: 'ev_marathon' },
  ];
  db.tasks = tasks;

  const events: RaceEvent[] = [
    { id: 'ev_marathon', merchantId: 'mer_marathon', title: '2026 南宁马拉松 · 欢乐跑（示例）', date: '2026-12-13（示例日期）', onlineTaskId: 'task_race', entryProductId: 'prod_marathon', finisherCouponTemplateId: 'ct_finisher' },
  ];
  db.events = events;

  for (const u of db.users.filter((x) => x.role === 'player')) {
    db.userCoupons.push({ id: `uc_welcome_${u.id}`, userId: u.id, templateId: 'ct_welcome', status: 'unused', source: '新人礼包', expiresAt: t + 30 * 86400_000, createdAt: t });
  }
  db.meta.seededAt = t;
  store.save();

  // 已审核通过的商家登记上链
  for (const m of db.merchants.filter((x) => x.status === 'active')) {
    await registerMerchantOnChain(m);
  }
}

export function merchantMetaHash(m: Merchant): string {
  return keccak256(toUtf8Bytes(JSON.stringify({ id: m.id, name: m.name, kind: m.kind, licenseNo: m.licenseNo, address: m.address })));
}

export async function registerMerchantOnChain(m: Merchant): Promise<void> {
  m.metaHash = merchantMetaHash(m);
  const r = await chain.registerMerchant(m.chainKey, m.kind, m.chainAccount, m.metaHash, m.name);
  m.registerTx = r.receipt.hash;
  store.save();
}
