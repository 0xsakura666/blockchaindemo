export type Role = 'player' | 'merchant' | 'admin';
export type MerchantKind = 'merchant' | 'scenic' | 'event';
export type ProductType = 'onsite' | 'shipping' | 'ticket' | 'race_entry';
export type PassType = 'Product' | 'Ticket' | 'RaceEntry' | 'FinisherCert' | 'CheckinBadge';

export const PASS_TYPE_INDEX: Record<PassType, number> = {
  Product: 0,
  Ticket: 1,
  RaceEntry: 2,
  FinisherCert: 3,
  CheckinBadge: 4,
};

export interface User {
  id: string;
  name: string;
  role: Role;
  merchantId?: string;
  chainAddress: string;
  avatar: string;
}

export interface Merchant {
  id: string;
  name: string;
  kind: MerchantKind;
  category: string;
  intro: string;
  address: string;
  licenseNo: string;
  contact: string;
  status: 'pending' | 'active' | 'suspended' | 'rejected';
  commissionBps: number; // 平台抽佣（万分比）
  chainKey: string; // bytes32
  chainAccount: string;
  registerTx?: string;
  metaHash?: string;
  /** 游戏内位置（网上南宁坐标：x 向东、z 向南，单位米） */
  location?: { x: number; z: number; label: string };
  createdAt: number;
}

export interface Product {
  id: string;
  merchantId: string;
  title: string;
  type: ProductType;
  priceFen: number;
  stock: number;
  validDays: number; // 0 = 不过期
  description: string;
  emoji: string;
  active: boolean;
  eventId?: string;
  createdAt: number;
}

export interface Order {
  id: string;
  userId: string;
  productId: string;
  merchantId: string;
  qty: number;
  amountFen: number; // 原价合计
  discountFen: number; // 平台券抵扣（平台补差）
  payFen: number; // 玩家实付
  userCouponId?: string;
  status: 'pending' | 'paid' | 'fulfilled' | 'refunded';
  payment?: { channel: 'mock'; tradeNo: string; paidAt: number };
  settlement?: { commissionFen: number; merchantFen: number; subsidyFen: number };
  shipping?: { receiver: string; phone: string; address: string; trackingNo?: string };
  chainOrderId: string; // bytes32
  dataHash?: string;
  anchorTx?: string;
  passIds: string[];
  source: 'web' | 'game';
  createdAt: number;
}

export interface Pass {
  id: string;
  code: string;
  userId: string;
  orderId?: string;
  taskId?: string;
  passType: PassType;
  merchantId: string | null;
  title: string;
  tokenId?: number;
  orderHash: string;
  mintTx?: string;
  status: 'minting' | 'active' | 'redeemed' | 'failed';
  validUntil: number; // unix 秒，0 = 不过期
  redeemedAt?: number;
  redeemTx?: string;
  createdAt: number;
}

export interface CouponTemplate {
  id: string;
  title: string;
  amountFen: number;
  minSpendFen: number;
  scopeMerchantId: string | null; // null = 全平台
  validDays: number;
  note: string;
}

export interface UserCoupon {
  id: string;
  userId: string;
  templateId: string;
  status: 'unused' | 'used';
  source: string;
  expiresAt: number; // ms
  usedOrderId?: string;
  createdAt: number;
}

export interface Checkpoint {
  id: string;
  name: string;
  x: number;
  z: number;
  radius: number;
  kind: 'landmark' | 'metro' | 'water' | 'shop';
}

export interface Task {
  id: string;
  title: string;
  type: 'checkin' | 'race';
  description: string;
  checkpointIds: string[]; // race 类型必须按顺序到达
  merchantId: string | null;
  rewardBadge: boolean;
  rewardCouponTemplateId?: string;
  eventId?: string;
}

export interface TaskProgress {
  userId: string;
  taskId: string;
  visited: string[];
  startedAt?: number;
  completedAt?: number;
  durationSec?: number;
}

export interface RaceEvent {
  id: string;
  merchantId: string;
  title: string;
  date: string;
  onlineTaskId: string;
  entryProductId: string;
  finisherCouponTemplateId?: string;
}

export interface RaceResult {
  userId: string;
  eventId: string;
  onlineDurationSec?: number;
  onlineFinishedAt?: number;
  offlineCheckinAt?: number;
  certPassId?: string;
}

export interface ChainTx {
  id: string;
  kind: 'registerMerchant' | 'setStatus' | 'anchorOrder' | 'mintPass' | 'redeem' | 'deploy';
  ref: string;
  summary: string;
  status: 'queued' | 'sent' | 'confirmed' | 'failed';
  hash?: string;
  blockNumber?: number;
  gasUsed?: string;
  error?: string;
  createdAt: number;
  confirmedAt?: number;
}

export interface GameEventLog {
  id: string;
  userId: string;
  type: string;
  checkpointId?: string;
  x?: number;
  z?: number;
  result: string;
  createdAt: number;
}

export interface DB {
  users: User[];
  merchants: Merchant[];
  products: Product[];
  orders: Order[];
  passes: Pass[];
  couponTemplates: CouponTemplate[];
  userCoupons: UserCoupon[];
  checkpoints: Checkpoint[];
  tasks: Task[];
  taskProgress: TaskProgress[];
  events: RaceEvent[];
  raceResults: RaceResult[];
  chainTxs: ChainTx[];
  gameEvents: GameEventLog[];
  meta: { seededAt: number; registryAddress?: string; passAddress?: string; chainId?: number };
}
