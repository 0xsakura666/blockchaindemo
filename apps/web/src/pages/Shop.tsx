import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, KIND_LABEL, TYPE_LABEL, yuan } from '../api';
import { useSession } from '../session';
import { Badge, Empty, ErrorText, Modal, PassCard, useAsync } from '../ui';

export default function Shop() {
  const { merchantId } = useParams();
  const { user, embed } = useSession();
  const { data: merchants, error, reload } = useAsync<any[]>(() => api('/api/merchants'));
  const [buying, setBuying] = useState<any>(null);
  const list = merchants || [];
  const shown = merchantId ? list.filter((m) => m.id === merchantId) : list;

  return (
    <div className="space-y-5">
      {!embed && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">网上南宁 · 城市商城</h1>
            <p className="text-sm text-slate-500">商家、景区、赛事都在这里。游戏里靠近商家按 P 也能打开对应店铺。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/shop" className={`btn-ghost ${!merchantId ? 'ring-2 ring-violet-400' : ''}`}>全部</Link>
            {list.map((m) => (
              <Link key={m.id} to={`/shop/${m.id}`} className={`btn-ghost ${merchantId === m.id ? 'ring-2 ring-violet-400' : ''}`}>{m.name.replace(/（.*?）/, '')}</Link>
            ))}
          </div>
        </div>
      )}
      <ErrorText error={error} />
      {user && user.role !== 'player' && (
        <div className="rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-800">当前身份是「{user.name}」，下单请在右上角切换到玩家身份。</div>
      )}
      {shown.map((m) => (
        <section key={m.id} className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">{m.name}</h2>
                <Badge tone={m.kind === 'scenic' ? 'green' : m.kind === 'event' ? 'cyan' : 'pink'}>{KIND_LABEL[m.kind]}</Badge>
                <Badge>{m.category}</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-500">{m.intro}</p>
              <p className="mt-1 text-xs text-slate-400">📍 {m.address}{m.location ? ` · 游戏内位置：${m.location.label}` : ''}</p>
            </div>
            <div className="text-right text-xs text-slate-400">
              链上登记 ✅<br />
              <Link className="text-violet-600 hover:underline" to={`/explorer/tx/${m.registerTx}`}>查看登记交易</Link>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {m.products.map((p: any) => (
              <div key={p.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-start justify-between">
                  <div className="text-3xl">{p.emoji}</div>
                  <Badge tone="violet">{TYPE_LABEL[p.type]}</Badge>
                </div>
                <div className="mt-2 font-medium">{p.title}</div>
                <div className="mt-1 line-clamp-2 text-xs text-slate-500">{p.description}</div>
                <div className="mt-3 flex items-center justify-between">
                  <div className="text-lg font-bold text-pink-600">{yuan(p.priceFen)}</div>
                  <button className="btn-primary" disabled={user?.role !== 'player' || p.stock <= 0} onClick={() => setBuying({ product: p, merchant: m })}>
                    {p.stock > 0 ? '购买' : '售罄'}
                  </button>
                </div>
                <div className="mt-1 text-[11px] text-slate-400">库存 {p.stock}{p.validDays ? ` · 凭证有效期 ${p.validDays} 天` : ''}</div>
              </div>
            ))}
          </div>
        </section>
      ))}
      {merchants && shown.length === 0 && <Empty>没有找到这家店铺</Empty>}
      {buying && <Checkout {...buying} onClose={() => { setBuying(null); reload(); }} />}
    </div>
  );
}

function Checkout({ product, merchant, onClose }: { product: any; merchant: any; onClose: () => void }) {
  const [qty, setQty] = useState(1);
  const [couponId, setCouponId] = useState('');
  const [shipping, setShipping] = useState({ receiver: '阿宁', phone: '138****0000', address: '南宁市青秀区民族大道（示例地址）' });
  const [step, setStep] = useState<'form' | 'paying' | 'done'>('form');
  const [order, setOrder] = useState<any>(null);
  const [error, setError] = useState('');
  const { data: coupons } = useAsync<any[]>(() => api('/api/me/coupons'));
  const amount = product.priceFen * qty;
  const usable = useMemo(
    () => (coupons || []).filter((c) => c.status === 'unused' && c.expiresAt > Date.now() && (!c.template.scopeMerchantId || c.template.scopeMerchantId === merchant.id)),
    [coupons, merchant.id],
  );
  const coupon = usable.find((c) => c.id === couponId);
  const discount = coupon && amount >= coupon.template.minSpendFen ? Math.min(coupon.template.amountFen, amount) : 0;

  const submit = async () => {
    setError('');
    setStep('paying');
    try {
      const o = await api('/api/orders', { body: { productId: product.id, qty, userCouponId: discount ? couponId : undefined, shipping: product.type === 'shipping' ? shipping : undefined } });
      const paid = await api(`/api/orders/${o.id}/pay`, { body: {} });
      setOrder(paid);
      setStep('done');
    } catch (e) {
      setError((e as Error).message);
      setStep('form');
    }
  };

  return (
    <Modal open onClose={onClose} title={step === 'done' ? '支付成功 · 凭证已上链' : `购买：${product.title}`}>
      {step !== 'done' ? (
        <div className="space-y-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="label">数量</span>
            <input type="number" min={1} max={product.type === 'race_entry' ? 1 : 5} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(product.type === 'race_entry' ? 1 : 5, Number(e.target.value) || 1)))} className="input w-24" />
          </div>
          <div>
            <div className="label mb-1">平台优惠券（平台出资补差，商家照常收全款）</div>
            <select className="input" value={couponId} onChange={(e) => setCouponId(e.target.value)}>
              <option value="">不使用</option>
              {usable.map((c) => (
                <option key={c.id} value={c.id} disabled={amount < c.template.minSpendFen}>
                  {c.template.title}{amount < c.template.minSpendFen ? '（未满门槛）' : ''}
                </option>
              ))}
            </select>
          </div>
          {product.type === 'shipping' && (
            <div className="grid gap-2">
              <div className="label">收货信息（仅存平台数据库，不上链）</div>
              <input className="input" value={shipping.receiver} onChange={(e) => setShipping({ ...shipping, receiver: e.target.value })} placeholder="收货人" />
              <input className="input" value={shipping.phone} onChange={(e) => setShipping({ ...shipping, phone: e.target.value })} placeholder="手机号" />
              <input className="input" value={shipping.address} onChange={(e) => setShipping({ ...shipping, address: e.target.value })} placeholder="地址" />
            </div>
          )}
          <div className="rounded-xl bg-slate-50 p-3">
            <Row k="商品原价" v={yuan(amount)} />
            <Row k="平台券抵扣" v={`-${yuan(discount)}`} />
            <Row k="实付" v={<b className="text-lg text-pink-600">{yuan(amount - discount)}</b>} />
          </div>
          <ErrorText error={error} />
          <button className="btn-primary w-full py-2" disabled={step === 'paying'} onClick={submit}>
            {step === 'paying' ? '支付并上链中…' : `模拟支付 ${yuan(amount - discount)}`}
          </button>
          <p className="text-center text-[11px] text-slate-400">正式环境替换为微信支付「平台收付通」，资金直接进入商家二级商户号</p>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="rounded-xl bg-emerald-50 p-3 text-emerald-800">
            订单 {order.id} 已支付（模拟交易号 {order.payment.tradeNo}），订单哈希已在链上存证，并为你发放了 {order.passes.length} 张不可转让凭证。
          </div>
          {order.passes.map((p: any) => <PassCard key={p.id} pass={{ ...p, merchantName: merchant.name }} />)}
          <div className="flex gap-2">
            <Link to="/me" className="btn-dark flex-1">查看我的凭证</Link>
            <button className="btn-ghost flex-1" onClick={onClose}>继续逛</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex items-center justify-between py-0.5"><span className="text-slate-500">{k}</span><span>{v}</span></div>
);
