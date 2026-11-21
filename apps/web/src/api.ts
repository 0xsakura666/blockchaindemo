export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

const KEY = 'nanning-demo-user';

export function currentUserId(): string {
  const fromQuery = new URLSearchParams(location.search).get('as');
  if (fromQuery) localStorage.setItem(KEY, fromQuery);
  return localStorage.getItem(KEY) || 'p_aning';
}

export function setCurrentUserId(id: string) {
  localStorage.setItem(KEY, id);
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; user?: string } = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', 'x-demo-user': opts.user ?? currentUserId() },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 HTTP ${res.status}`);
  return data as T;
}

export const yuan = (fen: number) => `¥${(fen / 100).toFixed(fen % 100 === 0 ? 0 : 2)}`;
export const short = (h?: string, n = 6) => (h ? `${h.slice(0, n + 2)}…${h.slice(-4)}` : '—');
export const time = (ms?: number) => (ms ? new Date(ms).toLocaleString('zh-CN', { hour12: false }) : '—');

export const PASS_LABEL: Record<string, string> = {
  Product: '商品凭证',
  Ticket: '门票',
  RaceEntry: '参赛凭证',
  FinisherCert: '完赛证书',
  CheckinBadge: '打卡徽章',
};
export const TYPE_LABEL: Record<string, string> = { onsite: '到店核销', shipping: '快递到家', ticket: '门票', race_entry: '赛事报名' };
export const KIND_LABEL: Record<string, string> = { merchant: '商家', scenic: '景区', event: '赛事主办方' };
export const STATUS_LABEL: Record<string, string> = {
  pending: '待支付', paid: '已支付', fulfilled: '已履约', refunded: '已退款',
  minting: '上链中', active: '有效', redeemed: '已核销', failed: '上链失败',
};
