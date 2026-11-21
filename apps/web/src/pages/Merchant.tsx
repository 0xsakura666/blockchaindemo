import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, KIND_LABEL, PASS_LABEL, short, time, TYPE_LABEL, yuan } from '../api';
import { useSession } from '../session';
import { Badge, Empty, ErrorText, Section, StatusBadge, Toast, TxLink, useAsync } from '../ui';

export default function MerchantPage() {
  const { user } = useSession();
  const [tab, setTab] = useState<'redeem' | 'orders' | 'products' | 'reconcile'>('redeem');
  const [toast, setToast] = useState('');
  const ov = useAsync<any>(() => api('/api/merchant/overview'), [tab]);
  if (user && user.role !== 'merchant') return <Empty>商家后台需要商家身份，请在右上角切换。没有店铺？<Link className="text-violet-600" to="/merchant/apply">提交入驻申请</Link></Empty>;
  const m = ov.data?.merchant;
  return (
    <div className="space-y-4">
      <ErrorText error={ov.error} />
      {m && (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <div className="flex items-center gap-2"><h1 className="text-xl font-bold">{m.name}</h1><Badge tone="pink">{KIND_LABEL[m.kind]}</Badge><MerchantStatus s={m.status} /></div>
            <div className="mt-1 text-xs text-slate-500">链上登记 ID <span className="mono">{short(m.chainKey, 10)}</span> · 托管链账户 <span className="mono">{short(m.chainAccount, 8)}</span> · 平台抽佣 {m.commissionBps / 100}%</div>
            {m.registerTx && <div className="mt-1 text-xs">登记交易 <TxLink hash={m.registerTx} /></div>}
          </div>
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
            {([['redeem', '扫码核销'], ['orders', '订单'], ['products', '商品管理'], ['reconcile', '链上对账']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={`btn ${tab === k ? 'bg-white shadow text-slate-900' : 'text-slate-600'}`}>{l}</button>
            ))}
          </div>
        </div>
      )}
      {m?.status === 'pending' && <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">入驻申请审核中。请切换到「平台运营」身份，在运营后台点「通过」——通过后商家会被登记到链上，才能上架商品。</div>}
      {m?.status === 'suspended' && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-800">店铺已被平台暂停，链上状态为 Suspended，暂停期间不能发放和核销凭证。</div>}
      {m && tab === 'redeem' && <Redeem onDone={(t) => { setToast(t); ov.reload(); }} />}
      {m && tab === 'orders' && <Orders orders={ov.data.orders} onShip={(t) => { setToast(t); ov.reload(); }} />}
      {m && tab === 'products' && <Products merchant={m} products={ov.data.products} onSaved={(t) => { setToast(t); ov.reload(); }} />}
      {m && tab === 'reconcile' && <Reconcile />}
      <Toast msg={toast} onDone={() => setToast('')} />
    </div>
  );
}

const MerchantStatus = ({ s }: { s: string }) => (
  <Badge tone={s === 'active' ? 'green' : s === 'pending' ? 'amber' : 'red'}>{({ active: '营业中', pending: '待审核', suspended: '已暂停', rejected: '已驳回' } as Record<string, string>)[s]}</Badge>
);

function Redeem({ onDone }: { onDone: (t: string) => void }) {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const preview = async () => {
    setError(''); setResult(null);
    try { setResult(await api(`/api/passes/verify/${encodeURIComponent(code.trim().replace(/.*\/verify\//, ''))}`)); } catch (e) { setError((e as Error).message); }
  };
  const redeem = async () => {
    setBusy(true); setError('');
    try {
      const p = await api('/api/merchant/redeem', { body: { code: code.trim().replace(/.*\/verify\//, '') } });
      onDone(`核销成功，链上交易 ${short(p.redeemTx)}`);
      setResult(await api(`/api/passes/verify/${p.code}`));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Section title="扫码 / 输码核销">
      <div className="flex flex-wrap gap-2">
        <input className="input max-w-sm font-mono uppercase" placeholder="输入玩家出示的核销码，如 NN-7K3QX9（或粘贴二维码链接）" value={code} onChange={(e) => setCode(e.target.value)} />
        <button className="btn-ghost" onClick={preview} disabled={!code}>先验真</button>
        <button className="btn-primary" onClick={redeem} disabled={!code || busy}>{busy ? '上链中…' : '确认核销'}</button>
      </div>
      <p className="mt-2 text-xs text-slate-500">核销会调用合约 <code>NanningPass.redeem()</code>，链上校验：凭证属于本店、未核销、未过期、本店处于营业状态。核销记录不可撤销、所有人可查。</p>
      <div className="mt-3"><ErrorText error={error} /></div>
      {result && (
        <div className="mt-3 rounded-xl border p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2"><b>{result.pass.title}</b><Badge tone="violet">{PASS_LABEL[result.pass.passType]}</Badge><StatusBadge status={result.pass.status} /></div>
          <div className="mt-1 text-xs text-slate-500">持有人：{result.pass.holderName} · Token #{result.pass.tokenId} · 发放方：{result.merchant?.name}</div>
          <ul className="mt-2 space-y-0.5 text-xs">{result.checks.map((c: any) => <li key={c.label}>{c.ok ? '✅' : '❌'} {c.label}</li>)}</ul>
        </div>
      )}
    </Section>
  );
}

function Orders({ orders, onShip }: { orders: any[]; onShip: (t: string) => void }) {
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const ship = async (id: string) => {
    setError('');
    try { await api(`/api/merchant/orders/${id}/ship`, { body: { trackingNo: tracking[id] || '' } }); onShip('已发货，链上履约记录已写入'); } catch (e) { setError((e as Error).message); }
  };
  return (
    <Section title={`订单（${orders.length}）`}>
      <ErrorText error={error} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500"><tr><th className="py-2">商品</th><th>买家</th><th>原价</th><th>平台补差</th><th>平台抽佣</th><th>商家应收</th><th>状态</th><th>凭证</th><th>操作</th></tr></thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-t align-top">
                <td className="py-2">{o.productEmoji} {o.productTitle} ×{o.qty}<div className="text-[11px] text-slate-400">{o.id} · {time(o.createdAt)}</div></td>
                <td className="text-xs">{o.buyerName}</td>
                <td>{yuan(o.amountFen)}</td>
                <td className="text-amber-600">{yuan(o.settlement?.subsidyFen ?? 0)}</td>
                <td className="text-slate-500">{yuan(o.settlement?.commissionFen ?? 0)}</td>
                <td className="font-semibold text-emerald-700">{yuan(o.settlement?.merchantFen ?? 0)}</td>
                <td><StatusBadge status={o.status} /></td>
                <td className="text-xs">{o.passes.map((p: any) => <div key={p.id}><span className="font-mono">{p.code}</span> <StatusBadge status={p.status} /></div>)}</td>
                <td className="text-xs">
                  {o.productType === 'shipping' && o.status === 'paid' ? (
                    <div className="flex gap-1">
                      <input className="input w-32" placeholder="快递单号" value={tracking[o.id] || ''} onChange={(e) => setTracking({ ...tracking, [o.id]: e.target.value })} />
                      <button className="btn-dark" onClick={() => ship(o.id)}>发货</button>
                    </div>
                  ) : o.shipping?.trackingNo ? `快递 ${o.shipping.trackingNo}` : <TxLink hash={o.anchorTx} label="存证" />}
                  {o.shipping && <div className="mt-1 text-[11px] text-slate-400">{o.shipping.receiver} · {o.shipping.address}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {orders.length === 0 && <Empty>还没有订单。切换到玩家身份去商城下单试试。</Empty>}
      </div>
      <p className="mt-3 text-xs text-slate-500">结算口径：商家应收 = 原价 − 平台抽佣；玩家使用的平台券由平台补差，不影响商家收入。正式环境由微信支付平台收付通分账接口完成。</p>
    </Section>
  );
}

function Products({ merchant, products, onSaved }: { merchant: any; products: any[]; onSaved: (t: string) => void }) {
  const types = merchant.kind === 'event' ? ['race_entry'] : merchant.kind === 'scenic' ? ['ticket', 'onsite', 'shipping'] : ['onsite', 'shipping'];
  const [form, setForm] = useState<any>({ title: '', type: types[0], price: '', stock: 100, validDays: 30, description: '', emoji: '🛍️' });
  const [error, setError] = useState('');
  const save = async () => {
    setError('');
    try {
      await api('/api/merchant/products', { body: { ...form, priceFen: Math.round(Number(form.price) * 100) } });
      setForm({ ...form, title: '', price: '', description: '' });
      onSaved('商品已上架');
    } catch (e) { setError((e as Error).message); }
  };
  const toggle = async (p: any) => {
    await api('/api/merchant/products', { body: { id: p.id, active: !p.active } });
    onSaved(p.active ? '已下架' : '已上架');
  };
  const edit = async (p: any, field: string, value: number) => {
    await api('/api/merchant/products', { body: { id: p.id, [field]: value } });
    onSaved('已保存');
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Section title="在售商品">
        <div className="space-y-2">
          {products.map((p) => (
            <div key={p.id} className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${p.active ? '' : 'opacity-60'}`}>
              <span className="text-2xl">{p.emoji}</span>
              <div className="min-w-0 flex-1"><div className="font-medium">{p.title}</div><div className="text-xs text-slate-500">{TYPE_LABEL[p.type]} · 有效期 {p.validDays || '不限'}{p.validDays ? ' 天' : ''}</div></div>
              <label className="text-xs text-slate-500">价格 ¥<input className="input ml-1 inline w-20" type="number" defaultValue={p.priceFen / 100} onBlur={(e) => Number(e.target.value) * 100 !== p.priceFen && edit(p, 'priceFen', Math.round(Number(e.target.value) * 100))} /></label>
              <label className="text-xs text-slate-500">库存<input className="input ml-1 inline w-20" type="number" defaultValue={p.stock} onBlur={(e) => Number(e.target.value) !== p.stock && edit(p, 'stock', Number(e.target.value))} /></label>
              <button className="btn-ghost" onClick={() => toggle(p)}>{p.active ? '下架' : '上架'}</button>
            </div>
          ))}
          {products.length === 0 && <Empty>还没有商品</Empty>}
        </div>
      </Section>
      <Section title="上架新商品">
        <div className="space-y-2 text-sm">
          <input className="input" placeholder="商品名称" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, validDays: e.target.value === 'shipping' ? 0 : 30 })}>
            {types.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
          <div className="grid grid-cols-3 gap-2">
            <input className="input" placeholder="价格（元）" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            <input className="input" placeholder="库存" type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })} />
            <input className="input" placeholder="有效天数" type="number" value={form.validDays} onChange={(e) => setForm({ ...form, validDays: Number(e.target.value) })} />
          </div>
          <input className="input" placeholder="图标 emoji" value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} />
          <textarea className="input" rows={3} placeholder="商品描述" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <ErrorText error={error} />
          <button className="btn-primary w-full" onClick={save} disabled={merchant.status !== 'active'}>上架</button>
          <p className="text-xs text-slate-500">价格以人民币标价，玩家直接支付；不支持用游戏金币购买实物或门票。</p>
        </div>
      </Section>
    </div>
  );
}

function Reconcile() {
  const r = useAsync<any>(() => api('/api/merchant/reconcile'));
  if (!r.data) return <Section title="链上对账"><ErrorText error={r.error} />{r.loading && '读取链上数据中…'}</Section>;
  const t = r.data.totals;
  return (
    <Section title="链上对账（逐笔读取 NanningPass.orderAnchors 与平台记录比对）" extra={<button className="btn-ghost" onClick={r.reload}>重新对账</button>}>
      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[['订单数', t.orders], ['原价合计', yuan(t.amountFen)], ['玩家实付', yuan(t.payFen)], ['平台补差', yuan(t.subsidyFen)], ['平台抽佣', yuan(t.commissionFen)], ['商家应收', yuan(t.merchantFen)]].map(([k, v]) => (
          <div key={k as string} className="rounded-xl bg-slate-50 p-3"><div className="label">{k}</div><div className="text-lg font-semibold">{v}</div></div>
        ))}
      </div>
      <div className={`mb-3 rounded-lg px-3 py-2 text-sm ${t.mismatches ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{t.mismatches ? `发现 ${t.mismatches} 笔不一致！` : '✅ 全部订单的链上存证哈希与平台记录一致'}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-slate-500"><tr><th className="py-2">订单</th><th>商品</th><th>原价</th><th>平台记录哈希</th><th>链上哈希</th><th>一致</th><th>存证交易</th></tr></thead>
          <tbody>
            {r.data.rows.map((x: any) => (
              <tr key={x.orderId} className="border-t"><td className="py-1.5">{x.orderId}</td><td>{x.product}</td><td>{yuan(x.amountFen)}</td><td className="mono">{short(x.localHash, 8)}</td><td className="mono">{short(x.chainHash, 8)}</td><td>{x.match ? '✅' : '❌'}</td><td><TxLink hash={x.anchorTx} /></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
