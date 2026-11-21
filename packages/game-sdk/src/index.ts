/**
 * 网上南宁 × BSN 链上凭证 —— 游戏对接 SDK（零依赖，单文件，可直接复制进游戏仓库）
 *
 * 用法（以 Cyber Nanning / 网上南宁 的 main.ts 为例）：
 *
 *   const bridge = new NanningChainBridge({ apiBase: 'https://<demo 服务>', playerId: 'p_aning' });
 *   await bridge.init();          // 拉取打卡点、任务、商家位置
 *   bridge.mountHud();            // 右上角显示奖励提示、P 键打开附近商家
 *   // 在渲染循环里：
 *   bridge.tick(player.position.x, player.position.z);
 *
 * 坐标系与游戏地图数据 public/data/nanning.json 一致：原点 22.812°N 108.386°E，x 向东、z 向南，单位米。
 */

export interface Checkpoint { id: string; name: string; x: number; z: number; radius: number; kind: string }
export interface Shop { merchantId: string; name: string; kind: string; x: number; z: number; label: string }
export interface Task { id: string; title: string; type: 'checkin' | 'race'; description: string; checkpointIds: string[] }
export interface GameConfig { checkpoints: Checkpoint[]; tasks: Task[]; shops: Shop[] }
export interface Reward { kind: 'badge' | 'coupon' | 'race' | 'cert' | 'info'; text: string; passCode?: string }
export interface EventResult { checkpoint: Checkpoint; rewards: Reward[]; shop: { merchantId: string; name: string } | null }

export interface BridgeOptions {
  /** demo 服务地址，例如 https://nanning-chain.up.railway.app（同域可传 ''） */
  apiBase: string;
  /** 玩家 ID。演示环境用种子玩家 p_aning / p_xiaoyong；正式环境应由游戏服务器换取并签名上报 */
  playerId: string;
  /** 商城/凭证页面地址，默认与 apiBase 相同 */
  webBase?: string;
  /** 额外请求头（例如正式环境的 x-game-signature 由游戏服务器代理时添加） */
  headers?: Record<string, string>;
  onReward?: (result: EventResult) => void;
  onNearShop?: (shop: Shop | null) => void;
  onError?: (message: string) => void;
  /** 提示层位置，默认右上角（3D 游戏）；2D 模拟器用左下角避免挡住侧栏 */
  hudPosition?: 'top-right' | 'bottom-left';
}

const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

export class NanningChainBridge {
  config: GameConfig = { checkpoints: [], tasks: [], shops: [] };
  nearShop: Shop | null = null;
  private inside = new Set<string>();
  private pending = new Set<string>();
  private hud: HTMLDivElement | null = null;
  private overlay: HTMLDivElement | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(private readonly opts: BridgeOptions) {}

  private url(path: string) {
    return `${this.opts.apiBase.replace(/\/$/, '')}${path}`;
  }

  private get webBase() {
    return (this.opts.webBase ?? this.opts.apiBase).replace(/\/$/, '');
  }

  async init(): Promise<GameConfig> {
    const res = await fetch(this.url('/api/game/config'));
    if (!res.ok) throw new Error(`加载链上任务配置失败 HTTP ${res.status}`);
    this.config = await res.json();
    return this.config;
  }

  /** 每帧（或每 200ms）调用：检测进入打卡点 / 靠近商家 */
  tick(x: number, z: number): void {
    for (const cp of this.config.checkpoints) {
      const isIn = dist(x, z, cp.x, cp.z) <= cp.radius;
      if (isIn && !this.inside.has(cp.id)) {
        this.inside.add(cp.id);
        void this.report(cp, x, z);
      } else if (!isIn && dist(x, z, cp.x, cp.z) > cp.radius + 10) {
        this.inside.delete(cp.id); // 10 米迟滞，避免在边界来回触发
      }
    }
    let shop: Shop | null = null;
    for (const s of this.config.shops) if (dist(x, z, s.x, s.z) < 90) shop = s;
    if (shop?.merchantId !== this.nearShop?.merchantId) {
      this.nearShop = shop;
      this.opts.onNearShop?.(shop);
      this.renderShopHint();
    }
  }

  private async report(cp: Checkpoint, x: number, z: number) {
    if (this.pending.has(cp.id)) return;
    this.pending.add(cp.id);
    try {
      const res = await fetch(this.url('/api/game/events'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-demo-user': this.opts.playerId, ...(this.opts.headers || {}) },
        body: JSON.stringify({ playerId: this.opts.playerId, type: 'enter_checkpoint', checkpointId: cp.id, x, z }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const result = data as EventResult;
      this.opts.onReward?.(result);
      for (const r of result.rewards) this.toast(r);
    } catch (e) {
      const msg = (e as Error).message;
      this.opts.onError?.(msg);
      this.toast({ kind: 'info', text: `上链服务异常：${msg}` });
    } finally {
      this.pending.delete(cp.id);
    }
  }

  // ------------------------------------------------------------------ 可选的 DOM HUD

  /** 挂载右上角提示层；P 打开附近商家商城，K 打开“我的链上凭证”，Esc 关闭 */
  mountHud(parent: HTMLElement = document.body): void {
    if (this.hud) return;
    const hud = document.createElement('div');
    const where = this.opts.hudPosition === 'bottom-left' ? 'bottom:16px;left:16px;flex-direction:column-reverse;' : 'top:72px;right:16px;flex-direction:column;';
    hud.style.cssText = `position:fixed;${where}z-index:50;display:flex;gap:8px;width:300px;pointer-events:none;font:13px/1.45 system-ui,"PingFang SC","Microsoft YaHei",sans-serif`;
    parent.appendChild(hud);
    this.hud = hud;
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.code === 'KeyP' && this.nearShop) this.openShop(this.nearShop.merchantId);
      else if (e.code === 'KeyK') this.openPage('/me');
      else if (e.code === 'Escape') this.closeOverlay();
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  unmount(): void {
    this.hud?.remove();
    this.hud = null;
    this.closeOverlay();
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
  }

  toast(r: Reward): void {
    if (!this.hud) return;
    const colors: Record<Reward['kind'], string> = { badge: '#a855f7', coupon: '#f59e0b', race: '#22d3ee', cert: '#10b981', info: '#64748b' };
    const el = document.createElement('div');
    el.style.cssText = `background:rgba(15,10,30,.88);color:#fff;border-left:4px solid ${colors[r.kind]};padding:8px 12px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.4);transition:opacity .4s`;
    el.textContent = (r.kind === 'info' ? '' : '⛓ ') + r.text;
    this.hud.appendChild(el);
    setTimeout(() => (el.style.opacity = '0'), 5200);
    setTimeout(() => el.remove(), 5700);
  }

  private shopHint: HTMLDivElement | null = null;
  private renderShopHint() {
    if (!this.hud) return;
    if (!this.nearShop) {
      this.shopHint?.remove();
      this.shopHint = null;
      return;
    }
    if (!this.shopHint) {
      this.shopHint = document.createElement('div');
      this.shopHint.style.cssText = 'background:linear-gradient(90deg,#be185d,#7c3aed);color:#fff;padding:8px 12px;border-radius:8px;font-weight:600';
      this.hud.prepend(this.shopHint);
    }
    this.shopHint.textContent = `🏪 附近：${this.nearShop.name} —— 按 P 进店`;
  }

  openShop(merchantId: string): void {
    this.openPage(`/embed/shop/${merchantId}`);
  }

  /** 以浮层 iframe 打开 demo 前端页面（商城 / 我的凭证），玩家身份通过 ?as= 传入 */
  openPage(path: string): void {
    this.closeOverlay();
    document.exitPointerLock?.();
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center';
    const frame = document.createElement('iframe');
    const sep = path.includes('?') ? '&' : '?';
    frame.src = `${this.webBase}${path}${sep}as=${encodeURIComponent(this.opts.playerId)}&embed=1`;
    frame.style.cssText = 'width:min(960px,94vw);height:min(720px,88vh);border:0;border-radius:14px;background:#fff';
    const close = document.createElement('button');
    close.textContent = '关闭 (Esc)';
    close.style.cssText = 'position:absolute;top:16px;right:16px;padding:6px 14px;border-radius:8px;border:0;background:#fff;cursor:pointer';
    close.onclick = () => this.closeOverlay();
    wrap.append(frame, close);
    wrap.onclick = (e) => e.target === wrap && this.closeOverlay();
    document.body.appendChild(wrap);
    this.overlay = wrap;
  }

  closeOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
  }
}
