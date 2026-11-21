import { NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from './api';
import { SessionProvider, useSession } from './session';
import Home from './pages/Home';
import Shop from './pages/Shop';
import Me from './pages/Me';
import GameSim from './pages/GameSim';
import MerchantPage from './pages/Merchant';
import Admin from './pages/Admin';
import Verify from './pages/Verify';
import Explorer, { TxDetail } from './pages/Explorer';
import Apply from './pages/Apply';

function ChainPill() {
  const [info, setInfo] = useState<any>(null);
  useEffect(() => {
    const load = () => api('/api/chain/info').then(setInfo).catch(() => setInfo(null));
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);
  if (!info) return <span className="rounded-full bg-red-500/20 px-3 py-1 text-xs text-red-200">链服务未连接</span>;
  return (
    <NavLink to="/explorer" className="rounded-full bg-white/10 px-3 py-1 text-xs text-cyan-200 hover:bg-white/20" title={info.network}>
      ⛓ {info.mode === 'bsn' ? 'BSN 武汉链' : '本地演示链'} · chainId {info.chainId} · 区块 #{info.blockNumber}
    </NavLink>
  );
}

function UserSwitcher() {
  const { users, userId, switchUser } = useSession();
  const nav = useNavigate();
  const groups = [
    { role: 'player', label: '玩家' },
    { role: 'merchant', label: '商家 / 景区 / 主办方' },
    { role: 'admin', label: '平台运营' },
  ];
  return (
    <select
      className="rounded-lg border-0 bg-white/10 px-2 py-1.5 text-sm text-white focus:outline-none"
      value={userId}
      onChange={(e) => {
        const u = users.find((x) => x.id === e.target.value);
        switchUser(e.target.value);
        nav(u?.role === 'merchant' ? '/merchant' : u?.role === 'admin' ? '/admin' : '/shop');
      }}
    >
      {groups.map((g) => (
        <optgroup key={g.role} label={g.label} className="text-slate-900">
          {users.filter((u) => u.role === g.role).map((u) => (
            <option key={u.id} value={u.id} className="text-slate-900">{u.avatar} {u.name}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function Shell() {
  const { user, embed, userId } = useSession();
  const link = ({ isActive }: { isActive: boolean }) => `rounded-lg px-3 py-1.5 text-sm ${isActive ? 'bg-white/15 text-white' : 'text-white/75 hover:text-white'}`;
  return (
    <div className="min-h-screen" key={userId}>
      {!embed && (
        <header className="sticky top-0 z-40 bg-gradient-to-r from-[#1c0b2a] via-[#2a0f45] to-[#120a2a] shadow-lg">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
            <NavLink to="/" className="mr-2 flex items-center gap-2 font-bold text-white">
              <span className="bg-gradient-to-r from-pink-400 to-cyan-300 bg-clip-text text-transparent">网上南宁</span>
              <span className="text-xs font-normal text-white/60">× BSN 链上凭证 Demo</span>
            </NavLink>
            <nav className="flex flex-wrap gap-1">
              <NavLink to="/shop" className={link}>商城</NavLink>
              <NavLink to="/game" className={link}>游戏模拟器</NavLink>
              {user?.role === 'player' && <NavLink to="/me" className={link}>我的凭证</NavLink>}
              {user?.role === 'merchant' && <NavLink to="/merchant" className={link}>商家后台</NavLink>}
              {user?.role === 'admin' && <NavLink to="/admin" className={link}>运营后台</NavLink>}
              <NavLink to="/verify" className={link}>凭证查询</NavLink>
              <NavLink to="/explorer" className={link}>区块浏览器</NavLink>
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <ChainPill />
              <UserSwitcher />
            </div>
          </div>
          <div className="bg-amber-400/90 py-1 text-center text-xs text-amber-950">
            演示环境：所有支付均为<b>模拟支付</b>，不产生真实资金往来；商家与赛事为示例数据。链上只记录凭证、核销与订单哈希，不发币。
          </div>
        </header>
      )}
      <main className={embed ? 'p-4' : 'mx-auto max-w-7xl px-4 py-6'}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/shop" element={<Shop />} />
          <Route path="/shop/:merchantId" element={<Shop />} />
          <Route path="/embed/shop/:merchantId" element={<Shop />} />
          <Route path="/me" element={<Me />} />
          <Route path="/game" element={<GameSim />} />
          <Route path="/merchant" element={<MerchantPage />} />
          <Route path="/merchant/apply" element={<Apply />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/verify" element={<Verify />} />
          <Route path="/verify/:code" element={<Verify />} />
          <Route path="/explorer" element={<Explorer />} />
          <Route path="/explorer/tx/:hash" element={<TxDetail />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}
