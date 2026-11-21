import { useEffect, useRef, useState } from 'react';
import { NanningChainBridge, type EventResult, type GameConfig, type Shop } from '@nanning/game-sdk';
import { API_BASE, api } from '../api';
import { useSession } from '../session';
import { Badge, Empty, Section } from '../ui';

interface MapData {
  meta: { origin: { lat: number; lon: number } };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  buildings: { p: number[]; k: number }[];
  roads: { p: number[]; w: number; c: number }[];
  areas: { p: number[]; k: string }[];
  labels: { n: string; x: number; z: number; k: string }[];
}

const AREA_COLOR: Record<string, string> = {
  water: '#1d3b8f', park: '#123d2a', forest: '#0f3a24', grass: '#16432c', pitch: '#185035', plaza: '#2a2140',
  parking: '#211a33', residential: '#1d1530', commercial: '#2a1238', civic: '#211a3a', construction: '#2b2216',
};
const SPEEDS = [
  { label: '步行 4.2 m/s', v: 4.2 },
  { label: '奔跑 9.5 m/s', v: 9.5 },
  { label: '演示加速 60 m/s', v: 60 },
];

export default function GameSim() {
  const { user, userId } = useSession();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [map, setMap] = useState<MapData | null>(null);
  const [cfg, setCfg] = useState<GameConfig | null>(null);
  const [log, setLog] = useState<{ t: number; text: string; kind: string }[]>([]);
  const [pos, setPos] = useState({ x: 147.2, z: -404.8 });
  const [nearShop, setNearShop] = useState<Shop | null>(null);
  const [speedIdx, setSpeedIdx] = useState(2);
  const [progress, setProgress] = useState<any>(null);
  const player = useRef({ x: 147.2, z: -404.8, target: null as null | { x: number; z: number }[] });
  const keys = useRef(new Set<string>());
  const bridgeRef = useRef<NanningChainBridge | null>(null);
  const speedRef = useRef(SPEEDS[2].v);
  speedRef.current = SPEEDS[speedIdx].v;

  const reloadProgress = () => api('/api/me/progress').then(setProgress).catch(() => undefined);

  useEffect(() => {
    fetch('/data/nanning.json').then((r) => r.json()).then(setMap);
  }, []);

  // 用与真实游戏完全相同的 SDK 对接链上服务
  useEffect(() => {
    if (user?.role !== 'player') return;
    const bridge = new NanningChainBridge({
      apiBase: API_BASE,
      playerId: userId,
      webBase: location.origin,
      hudPosition: 'bottom-left',
      onReward: (r: EventResult) => {
        setLog((l) => [...r.rewards.map((x) => ({ t: Date.now(), text: x.text, kind: x.kind })), { t: Date.now(), text: `进入「${r.checkpoint.name}」`, kind: 'enter' }, ...l].slice(0, 40));
        reloadProgress();
      },
      onNearShop: setNearShop,
      onError: (m) => setLog((l) => [{ t: Date.now(), text: m, kind: 'error' }, ...l]),
    });
    bridgeRef.current = bridge;
    bridge.init().then(setCfg);
    bridge.mountHud();
    reloadProgress();
    return () => bridge.unmount();
  }, [userId, user?.role]);

  // 渲染循环
  useEffect(() => {
    if (!map || !canvasRef.current || !wrapRef.current) return;
    const canvas = canvasRef.current;
    const W = wrapRef.current.clientWidth;
    const { minX, maxX, minZ, maxZ } = map.bounds;
    const scale = W / (maxX - minX);
    const H = Math.round((maxZ - minZ) * scale);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const sx = (x: number) => (x - minX) * scale;
    const sz = (z: number) => (z - minZ) * scale;

    // 静态底图（OpenStreetMap 南宁数据，来自《网上南宁》public/data/nanning.json）
    const base = document.createElement('canvas');
    base.width = canvas.width;
    base.height = canvas.height;
    const b = base.getContext('2d')!;
    b.scale(dpr, dpr);
    b.fillStyle = '#120a24';
    b.fillRect(0, 0, W, H);
    const poly = (p: number[]) => {
      b.beginPath();
      for (let i = 0; i < p.length; i += 2) (i ? b.lineTo : b.moveTo).call(b, sx(p[i]), sz(p[i + 1]));
      b.closePath();
    };
    for (const a of map.areas) { poly(a.p); b.fillStyle = AREA_COLOR[a.k] || '#1d1530'; b.fill(); }
    for (const r of [...map.roads].sort((x, y) => y.c - x.c)) {
      b.beginPath();
      for (let i = 0; i < r.p.length; i += 2) (i ? b.lineTo : b.moveTo).call(b, sx(r.p[i]), sz(r.p[i + 1]));
      b.strokeStyle = r.c === 0 ? '#db2777' : r.c === 1 ? '#a21caf' : r.c <= 3 ? '#4c1d95' : '#33204f';
      b.lineWidth = Math.max(0.6, r.w * scale);
      b.lineCap = 'round';
      b.stroke();
    }
    for (const bd of map.buildings) { poly(bd.p); b.fillStyle = bd.k === 3 ? '#7c3aed' : '#2e1065'; b.fill(); }
    b.font = '11px system-ui';
    for (const l of map.labels.filter((x) => x.k !== 'metro')) {
      b.fillStyle = 'rgba(255,255,255,.75)';
      b.fillText(l.n, sx(l.x) + 4, sz(l.z) - 4);
    }

    const ctx = canvas.getContext('2d')!;
    let last = performance.now();
    let raf = 0;
    let uiTimer = 0;
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const pl = player.current;
      let dx = 0, dz = 0;
      const k = keys.current;
      if (k.has('KeyW') || k.has('ArrowUp')) dz -= 1;
      if (k.has('KeyS') || k.has('ArrowDown')) dz += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) dx -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) dx += 1;
      if ((dx || dz) && pl.target) pl.target = null;
      if (!dx && !dz && pl.target?.length) {
        const t = pl.target[0];
        const d = Math.hypot(t.x - pl.x, t.z - pl.z);
        if (d < 2) pl.target.shift();
        else { dx = (t.x - pl.x) / d; dz = (t.z - pl.z) / d; }
      }
      const len = Math.hypot(dx, dz);
      if (len) {
        pl.x = Math.max(minX, Math.min(maxX, pl.x + (dx / len) * speedRef.current * dt));
        pl.z = Math.max(minZ, Math.min(maxZ, pl.z + (dz / len) * speedRef.current * dt));
      }
      bridgeRef.current?.tick(pl.x, pl.z);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(base, 0, 0);
      ctx.scale(dpr, dpr);
      const conf = bridgeRef.current?.config;
      for (const cp of conf?.checkpoints || []) {
        const pulse = 1 + 0.15 * Math.sin(now / 300);
        ctx.beginPath();
        ctx.arc(sx(cp.x), sz(cp.z), Math.max(5, cp.radius * scale) * pulse, 0, Math.PI * 2);
        ctx.strokeStyle = cp.kind === 'metro' ? '#22d3ee' : '#facc15';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = cp.kind === 'metro' ? '#a5f3fc' : '#fde68a';
        ctx.font = 'bold 11px system-ui';
        ctx.fillText(cp.name, sx(cp.x) + 6, sz(cp.z) + 14);
      }
      for (const s of conf?.shops || []) {
        ctx.font = '16px system-ui';
        ctx.fillText(s.kind === 'scenic' ? '🌳' : s.kind === 'event' ? '🏃' : '🏪', sx(s.x) - 8, sz(s.z) - 10);
      }
      ctx.beginPath();
      ctx.arc(sx(pl.x), sz(pl.z), 7, 0, Math.PI * 2);
      ctx.fillStyle = '#f472b6';
      ctx.shadowColor = '#f472b6';
      ctx.shadowBlur = 14;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();

      uiTimer -= dt;
      if (uiTimer <= 0) { uiTimer = 0.2; setPos({ x: pl.x, z: pl.z }); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      player.current.target = [{ x: (e.clientX - rect.left) / scale + minX, z: (e.clientY - rect.top) / scale + minZ }];
      canvas.focus();
    };
    canvas.addEventListener('click', onClick);
    return () => { cancelAnimationFrame(raf); canvas.removeEventListener('click', onClick); };
  }, [map]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (document.activeElement !== canvasRef.current) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) { keys.current.add(e.code); e.preventDefault(); }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const goTo = (ids: string[]) => {
    const pts = ids.map((id) => cfg?.checkpoints.find((c) => c.id === id)).filter(Boolean).map((c) => ({ x: c!.x, z: c!.z }));
    player.current.target = pts;
    canvasRef.current?.focus();
  };
  const teleport = (x: number, z: number) => { player.current.x = x; player.current.z = z; player.current.target = null; canvasRef.current?.focus(); };

  if (user && user.role !== 'player') return <Empty>游戏模拟器需要玩家身份，请在右上角切换到「玩家 · 阿宁」或「玩家 · 小邕」。</Empty>;
  const origin = map?.meta.origin;
  const lat = origin ? origin.lat - pos.z / 110574 : 0;
  const lon = origin ? origin.lon + pos.x / (111320 * Math.cos((origin.lat * Math.PI) / 180)) : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold">游戏模拟器 · 网上南宁地图</h1>
            <p className="text-xs text-slate-500">2D 俯视图，底图与坐标直接使用《网上南宁》的 OpenStreetMap 数据（© OpenStreetMap contributors, ODbL）。打卡逻辑通过与 3D 游戏相同的 <code>NanningChainBridge</code> SDK 上报。</p>
          </div>
          <div className="flex gap-1">
            {SPEEDS.map((s, i) => <button key={s.label} className={`btn ${i === speedIdx ? 'bg-slate-900 text-white' : 'btn-ghost'}`} onClick={() => setSpeedIdx(i)}>{s.label}</button>)}
          </div>
        </div>
        <div ref={wrapRef} className="overflow-hidden rounded-2xl border border-slate-800 bg-[#120a24] shadow-lg">
          {!map && <div className="p-10 text-center text-white/70">正在加载南宁地图数据…</div>}
          <canvas ref={canvasRef} tabIndex={0} className="block cursor-crosshair outline-none" />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span>操作：点击地图上任意位置自动走过去 · 点地图后可用 WASD / 方向键移动</span>
          <span className="ml-auto font-mono">x {pos.x.toFixed(0)} · z {pos.z.toFixed(0)} · {lat.toFixed(5)}°N {lon.toFixed(5)}°E</span>
        </div>
      </div>

      <div className="space-y-4">
        <Section title="快速体验">
          <div className="grid gap-2 text-sm">
            <button className="btn-ghost justify-start whitespace-normal text-left" onClick={() => goTo(['cp_minghu', 'cp_shimen'])}>🌳 走去明湖 → 石门森林公园（景区打卡）</button>
            <button className="btn-ghost justify-start whitespace-normal text-left" onClick={() => goTo(['cp_wanxiang', 'cp_sanqi'])}>🏙️ 走去万象城 → 三祺广场（城市漫游）</button>
            <button className="btn-ghost justify-start whitespace-normal text-left" onClick={() => { teleport(-720, -405); setTimeout(() => goTo(['cp_m_expo', 'cp_m_wanxiang', 'cp_m_cbd']), 50); }}>🏃 跑民族大道线上赛道（需先报名）</button>
            {nearShop ? (
              <button className="btn-primary whitespace-normal" onClick={() => bridgeRef.current?.openShop(nearShop.merchantId)}>🏪 进店：{nearShop.name}（游戏内按 P）</button>
            ) : (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">靠近地图上的 🏪 🌳 🏃 图标可以进店</div>
            )}
            <button className="btn-ghost" onClick={() => bridgeRef.current?.openPage('/me')}>⛓ 我的链上凭证（游戏内按 K）</button>
          </div>
        </Section>

        <Section title="任务进度">
          <div className="space-y-2 text-sm">
            {progress?.tasks.map((t: any) => (
              <div key={t.id} className="flex items-center justify-between gap-2">
                <span>{t.type === 'race' ? '🏃' : '📍'} {t.title}</span>
                {t.progress?.completedAt ? <Badge tone="green">完成</Badge> : <Badge>{t.progress?.visited?.length ?? 0}/{t.checkpointIds.length}</Badge>}
              </div>
            ))}
          </div>
        </Section>

        <Section title="链上事件">
          <div className="max-h-72 space-y-1 overflow-auto text-xs">
            {log.length === 0 && <div className="text-slate-400">走进黄色 / 青色圆圈触发打卡</div>}
            {log.map((l, i) => (
              <div key={i} className={`rounded px-2 py-1 ${l.kind === 'error' ? 'bg-red-50 text-red-700' : l.kind === 'enter' ? 'text-slate-400' : 'bg-violet-50 text-violet-800'}`}>{l.text}</div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
