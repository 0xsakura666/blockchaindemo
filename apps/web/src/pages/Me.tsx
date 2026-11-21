import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, time, TYPE_LABEL, yuan } from '../api';
import { useSession } from '../session';
import { Badge, Empty, ErrorText, PassCard, Section, StatusBadge, TxLink, useAsync } from '../ui';

const fmt = (sec?: number) => (sec ? `${Math.floor(sec / 60)}分${String(sec % 60).padStart(2, '0')}秒` : '—');

export default function Me() {
  const { user } = useSession();
  const [tab, setTab] = useState<'passes' | 'orders' | 'coupons' | 'tasks'>('passes');
  const passes = useAsync<any[]>(() => api('/api/me/passes'), [tab]);
  const orders = useAsync<any[]>(() => api('/api/me/orders'), [tab]);
  const coupons = useAsync<any[]>(() => api('/api/me/coupons'), [tab]);
  const progress = useAsync<any>(() => api('/api/me/progress'), [tab]);
  if (user && user.role !== 'player') return <Empty>「我的凭证」是玩家页面，请在右上角切换到玩家身份。</Empty>;

  const tabs = [
    ['passes', `链上凭证 ${passes.data?.length ?? ''}`],
    ['orders', `订单 ${orders.data?.length ?? ''}`],
    ['coupons', `优惠券 ${coupons.data?.filter((c) => c.status === 'unused').length ?? ''}`],
    ['tasks', '任务 / 赛事'],
  ] as const;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{user?.avatar} {user?.name} 的链上凭证</h1>
        <div className="flex gap-1 rounded-xl bg-white p-1 shadow-sm">
          {tabs.map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`btn ${tab === k ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>{label}</button>
          ))}
        </div>
      </div>

      {tab === 'passes' && (
        <div className="grid gap-3 md:grid-cols-2">
          <ErrorText error={passes.error} />
          {passes.data?.map((p) => <PassCard key={p.id} pass={p} />)}
          {passes.data?.length === 0 && <Empty>还没有凭证。去 <Link className="text-violet-600" to="/shop">商城</Link> 下单，或在 <Link className="text-violet-600" to="/game">游戏模拟器</Link> 里打卡。</Empty>}
        </div>
      )}

      {tab === 'orders' && (
        <Section title="我的订单">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500"><tr><th className="py-2">商品</th><th>商家</th><th>原价</th><th>券抵扣</th><th>实付</th><th>状态</th><th>订单存证</th><th>时间</th></tr></thead>
              <tbody>
                {orders.data?.map((o) => (
                  <tr key={o.id} className="border-t">
                    <td className="py-2">{o.productEmoji} {o.productTitle} ×{o.qty}<div className="text-[11px] text-slate-400">{TYPE_LABEL[o.productType]}{o.shipping?.trackingNo ? ` · 快递 ${o.shipping.trackingNo}` : ''}</div></td>
                    <td className="text-xs">{o.merchantName}</td>
                    <td>{yuan(o.amountFen)}</td>
                    <td className="text-amber-600">-{yuan(o.discountFen)}</td>
                    <td className="font-semibold">{yuan(o.payFen)}</td>
                    <td><StatusBadge status={o.status} /></td>
                    <td><TxLink hash={o.anchorTx} /></td>
                    <td className="text-xs text-slate-500">{time(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {orders.data?.length === 0 && <Empty>暂无订单</Empty>}
          </div>
        </Section>
      )}

      {tab === 'coupons' && (
        <div className="grid gap-3 md:grid-cols-3">
          {coupons.data?.map((c) => (
            <div key={c.id} className={`card p-4 ${c.status !== 'unused' ? 'opacity-60' : ''}`}>
              <div className="flex items-center justify-between"><Badge tone="amber">平台券</Badge>{c.status === 'used' ? <Badge>已使用</Badge> : <Badge tone="green">可用</Badge>}</div>
              <div className="mt-2 font-semibold">{c.template.title}</div>
              <div className="mt-1 text-xs text-slate-500">来源：{c.source}</div>
              <div className="text-xs text-slate-400">到期：{time(c.expiresAt)}</div>
              <div className="mt-2 text-[11px] text-slate-400">平台出资补差 · 不可购买 · 不可转让 · 不可提现</div>
            </div>
          ))}
        </div>
      )}

      {tab === 'tasks' && progress.data && (
        <div className="grid gap-4 md:grid-cols-2">
          {progress.data.tasks.map((t: any) => (
            <Section key={t.id} title={<span>{t.type === 'race' ? '🏃' : '📍'} {t.title}</span>} extra={t.progress?.completedAt ? <Badge tone="green">已完成</Badge> : <Badge>进行中</Badge>}>
              <p className="text-sm text-slate-500">{t.description}</p>
              <div className="mt-3 text-xs text-slate-600">已到达：{t.progress?.visited?.length ?? 0}/{t.checkpointIds.length}{t.progress?.durationSec ? ` · 用时 ${fmt(t.progress.durationSec)}` : ''}</div>
            </Section>
          ))}
          {progress.data.races.map((r: any) => (
            <Section key={r.id} title={`🏅 ${r.title}`}>
              <div className="space-y-1 text-sm">
                <div>线上赛道：{r.result?.onlineFinishedAt ? `✅ 完成，用时 ${fmt(r.result.onlineDurationSec)}` : '⏳ 未完成'}</div>
                <div>线下签到：{r.result?.offlineCheckinAt ? `✅ ${time(r.result.offlineCheckinAt)}` : '⏳ 未签到（现场出示参赛凭证核销码）'}</div>
                <div>完赛证书：{r.result?.certPassId ? '✅ 已上链发放' : '双线完成后自动发放'}</div>
              </div>
            </Section>
          ))}
        </div>
      )}
    </div>
  );
}
