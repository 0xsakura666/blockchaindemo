import { useState } from 'react';
import { api, KIND_LABEL, short, time, yuan } from '../api';
import { useSession } from '../session';
import { Badge, Empty, ErrorText, Section, StatusBadge, Toast, TxLink, useAsync } from '../ui';

export default function Admin() {
  const { user, users, refreshUsers } = useSession();
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const ov = useAsync<any>(() => api('/api/admin/overview'));
  const txs = useAsync<any[]>(() => api('/api/chain/txs'));
  const [grant, setGrant] = useState({ userId: 'p_aning', templateId: 'ct_welcome' });
  if (user && user.role !== 'admin') return <Empty>运营后台需要「平台运营」身份。</Empty>;
  const act = async (id: string, action: string) => {
    setBusy(id + action); setError('');
    try {
      await api(`/api/admin/merchants/${id}/${action}`, { body: {} });
      setToast({ approve: '已通过并完成链上登记', reject: '已驳回', suspend: '已暂停（链上状态同步）', resume: '已恢复（链上状态同步）' }[action] || '完成');
      ov.reload(); txs.reload();
    } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  const s = ov.data?.stats;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">平台运营后台</h1>
      <ErrorText error={ov.error || error} />
      {s && (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[['GMV（原价）', yuan(s.gmvFen)], ['玩家实付', yuan(s.playerPaidFen)], ['平台抽佣', yuan(s.commissionFen)], ['平台补差（券）', yuan(s.subsidyFen)], ['已发凭证 / 已核销', `${s.passes} / ${s.redeemed}`], ['链上交易 成功 / 失败', `${s.chainTxConfirmed} / ${s.chainTxFailed}`]].map(([k, v]) => (
            <div key={k} className="card p-4"><div className="label">{k}</div><div className="mt-1 text-xl font-bold">{v}</div></div>
          ))}
        </div>
      )}

      <Section title="商家入驻审核">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="py-2">商家</th><th>类型</th><th>信用代码</th><th>抽佣</th><th>状态</th><th>链上登记</th><th>操作</th></tr></thead>
            <tbody>
              {ov.data?.merchants.map((m: any) => (
                <tr key={m.id} className="border-t">
                  <td className="py-2">{m.name}<div className="text-[11px] text-slate-400">{m.address}</div></td>
                  <td><Badge>{KIND_LABEL[m.kind]}</Badge></td>
                  <td className="mono">{m.licenseNo}</td>
                  <td>{m.commissionBps / 100}%</td>
                  <td><Badge tone={m.status === 'active' ? 'green' : m.status === 'pending' ? 'amber' : 'red'}>{({ active: '营业中', pending: '待审核', suspended: '已暂停', rejected: '已驳回' } as Record<string, string>)[m.status]}</Badge></td>
                  <td><TxLink hash={m.registerTx} /></td>
                  <td className="space-x-1 whitespace-nowrap">
                    {m.status === 'pending' && <><button className="btn-primary" disabled={!!busy} onClick={() => act(m.id, 'approve')}>{busy === m.id + 'approve' ? '上链中…' : '通过'}</button><button className="btn-ghost" onClick={() => act(m.id, 'reject')}>驳回</button></>}
                    {m.status === 'active' && <button className="btn-ghost" disabled={!!busy} onClick={() => act(m.id, 'suspend')}>暂停</button>}
                    {m.status === 'suspended' && <button className="btn-ghost" disabled={!!busy} onClick={() => act(m.id, 'resume')}>恢复</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="上链队列（平台签名 · 平台代付能量值）" extra={<button className="btn-ghost" onClick={txs.reload}>刷新</button>}>
          <div className="max-h-96 space-y-1 overflow-auto text-xs">
            {txs.data?.map((t) => (
              <div key={t.id} className="flex items-center gap-2 border-b py-1.5">
                <StatusBadge status={t.status} />
                <span className="flex-1">{t.summary}{t.error && <span className="text-red-600"> · {t.error}</span>}</span>
                {t.blockNumber && <span className="text-slate-400">#{t.blockNumber}</span>}
                <TxLink hash={t.hash} />
              </div>
            ))}
          </div>
        </Section>
        <Section title="游戏事件（来自网上南宁 SDK）">
          <div className="max-h-96 space-y-1 overflow-auto text-xs">
            {ov.data?.gameEvents.length === 0 && <div className="text-slate-400">暂无。去「游戏模拟器」里走一走。</div>}
            {ov.data?.gameEvents.map((g: any) => (
              <div key={g.id} className="border-b py-1.5"><b>{users.find((u) => u.id === g.userId)?.name}</b> · {g.checkpointId} · <span className="text-slate-500">{g.result}</span> <span className="text-slate-400">{time(g.createdAt)}</span></div>
            ))}
          </div>
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="发放平台优惠券（运营活动）">
          <div className="flex flex-wrap gap-2 text-sm">
            <select className="input w-40" value={grant.userId} onChange={(e) => setGrant({ ...grant, userId: e.target.value })}>
              {users.filter((u) => u.role === 'player').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <select className="input flex-1" value={grant.templateId} onChange={(e) => setGrant({ ...grant, templateId: e.target.value })}>
              {ov.data?.couponTemplates.map((c: any) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <button className="btn-primary" onClick={async () => { await api('/api/admin/coupons/grant', { body: grant }); setToast('已发放'); }}>发放</button>
          </div>
          <p className="mt-2 text-xs text-slate-500">优惠券由平台出资（下单时平台补差给商家），只能通过任务或运营活动获得，不能用钱购买。</p>
        </Section>
        <Section title="演示数据">
          <p className="text-sm text-slate-600">本地演示链模式下可以一键重置：重新部署一套合约并灌入示例商家、商品与玩家。</p>
          <button className="btn-dark mt-3" onClick={async () => { if (!confirm('确定重置全部演示数据？')) return; try { await api('/api/admin/reset', { body: {} }); refreshUsers(); ov.reload(); txs.reload(); setToast('已重置'); } catch (e) { setError((e as Error).message); } }}>重置演示数据</button>
        </Section>
      </div>

      <Section title="最近订单">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500"><tr><th className="py-2">订单</th><th>商品</th><th>买家</th><th>原价</th><th>券</th><th>实付</th><th>抽佣</th><th>状态</th><th>存证</th></tr></thead>
            <tbody>
              {ov.data?.orders.map((o: any) => (
                <tr key={o.id} className="border-t"><td className="py-1.5 font-mono">{short(o.id, 6)}</td><td>{o.productTitle}</td><td>{o.buyerName}</td><td>{yuan(o.amountFen)}</td><td>{yuan(o.discountFen)}</td><td>{yuan(o.payFen)}</td><td>{yuan(o.settlement?.commissionFen ?? 0)}</td><td><StatusBadge status={o.status} /></td><td><TxLink hash={o.anchorTx} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Toast msg={toast} onDone={() => setToast('')} />
    </div>
  );
}
