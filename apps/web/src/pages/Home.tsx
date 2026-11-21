import { Link } from 'react-router-dom';
import { api, short } from '../api';
import { useAsync } from '../ui';

const layers = [
  { icon: '🪙', title: '金币（游戏币）', desc: '只用于游戏内虚拟道具，不能兑换实物、门票或商家商品，不能提现。', tone: 'from-slate-700 to-slate-500' },
  { icon: '¥', title: '人民币直付', desc: '游戏内看到 ¥ 价格直接付款。正式环境走微信支付「平台收付通」：钱直接进商家账户，平台按笔分账抽佣，不建资金池。Demo 中为模拟支付。', tone: 'from-pink-600 to-rose-500' },
  { icon: '🎟️', title: '平台优惠券', desc: '做游戏任务获得（打卡、赛道完赛），下单抵扣；差额由平台补给商家（补差）。不能用钱买、不能转让。', tone: 'from-amber-500 to-orange-500' },
  { icon: '⛓', title: '链上凭证（BSN 武汉链）', desc: '门票、商品凭证、参赛凭证、完赛证书、打卡徽章。不可转让、不是币、没有价格；核销记录与订单哈希公开可查。', tone: 'from-violet-600 to-cyan-500' },
];

const scenes = [
  { icon: '🍜', title: '商家入驻 · 游戏内购买 · 到店核销', steps: ['商家提交入驻 → 平台审核 → 链上登记', '玩家在游戏/商城下单（可用券）', '支付后订单哈希存证 + 发放凭证', '到店出示核销码 → 链上核销'], to: '/shop/mer_laoyou' },
  { icon: '🏅', title: '马拉松 · 线上 + 线下', steps: ['报名获得链上参赛凭证', '游戏里按顺序跑完民族大道赛道', '现场扫码签到（核销参赛凭证）', '双线完成 → 链上完赛证书 + 商家券'], to: '/game' },
  { icon: '🌳', title: '景区 · 门票 + 周边 + 打卡', steps: ['游戏里走到明湖、石门森林公园', '获得链上打卡徽章 + 门票优惠券', '用券买明湖游船票 → 门票凭证', '现场扫码登船'], to: '/game' },
];

export default function Home() {
  const { data: info } = useAsync(() => api('/api/chain/info'));
  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-[#1c0b2a] via-[#3b0f5c] to-[#0b1a3a] p-8 text-white shadow-xl">
        <div className="text-sm text-cyan-200">网上南宁 · 现实驱动的新元宇宙</div>
        <h1 className="mt-2 text-3xl font-bold leading-tight md:text-4xl">游戏里的凭证，现实里的商家敢认</h1>
        <p className="mt-3 max-w-3xl text-white/80">
          商家、景区、赛事主办方入驻《网上南宁》，玩家在游戏里购买门票、周边和到店商品，打卡、跑赛道领取权益。
          所有凭证与核销记录写入 <b>BSN 武汉链</b>，多方按同一份账本对账，平台不能单方面篡改。
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/game" className="btn-primary px-5 py-2">进入游戏模拟器</Link>
          <Link to="/shop" className="btn bg-white/10 px-5 py-2 text-white hover:bg-white/20">逛商城</Link>
          <Link to="/explorer" className="btn bg-white/10 px-5 py-2 text-white hover:bg-white/20">看链上记录</Link>
        </div>
        {info && (
          <div className="mt-6 grid gap-2 text-xs text-white/70 md:grid-cols-3">
            <div>网络：{info.network}</div>
            <div>NanningRegistry：<span className="font-mono">{short(info.registryAddress, 8)}</span></div>
            <div>NanningPass：<span className="font-mono">{short(info.passAddress, 8)}</span></div>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">合规的「三层价值」设计（替代 1:1 人民币代币）</h2>
        <div className="grid gap-4 md:grid-cols-4">
          {layers.map((l) => (
            <div key={l.title} className="card overflow-hidden">
              <div className={`bg-gradient-to-r ${l.tone} px-4 py-3 text-white`}><span className="mr-2 text-xl">{l.icon}</span><b>{l.title}</b></div>
              <p className="p-4 text-sm text-slate-600">{l.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">三个场景，一套链上凭证</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {scenes.map((s) => (
            <Link to={s.to} key={s.title} className="card block p-5 transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="text-2xl">{s.icon}</div>
              <div className="mt-2 font-semibold">{s.title}</div>
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-600">
                {s.steps.map((x) => <li key={x}>{x}</li>)}
              </ol>
            </Link>
          ))}
        </div>
      </section>

      <section className="card p-5 text-sm text-slate-600">
        <b className="text-slate-900">如何体验：</b> 右上角切换演示身份 ——
        「玩家 · 阿宁」去商城下单或在游戏模拟器里打卡；切到「老友粉店长」输入核销码核销；切到「平台运营」审核「邕州茶语」入驻、查看上链队列。
        每一步都会产生真实的 EVM 交易，可在「区块浏览器」查看解码后的合约调用与事件。
      </section>
    </div>
  );
}
