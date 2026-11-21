import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, PASS_LABEL, short, time } from '../api';
import { Badge, ErrorText, Section, StatusBadge, TxLink, useAsync } from '../ui';

export default function Verify() {
  const { code } = useParams();
  const nav = useNavigate();
  const [input, setInput] = useState(code || '');
  const r = useAsync<any>(() => (code ? api(`/api/passes/verify/${code}`) : Promise.resolve(null)), [code]);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Section title="公开凭证查询 · 任何人都能验真">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); nav(`/verify/${input.trim().toUpperCase()}`); }}>
          <input className="input font-mono uppercase" placeholder="输入核销码，例如 NN-7K3QX9" value={input} onChange={(e) => setInput(e.target.value)} />
          <button className="btn-primary">查询</button>
        </form>
        <p className="mt-2 text-xs text-slate-500">查询会实时读取链上合约 <code>NanningPass.getPass()</code> 与 <code>orderAnchors()</code>，并与平台记录逐项比对。</p>
      </Section>
      <ErrorText error={r.error} />
      {r.data && (
        <Section title={r.data.pass.title} extra={<StatusBadge status={r.data.pass.status} />}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1 text-sm">
              <div className="label">平台记录</div>
              <div>类型：<Badge tone="violet">{PASS_LABEL[r.data.pass.passType]}</Badge></div>
              <div>核销码：<b className="font-mono">{r.data.pass.code}</b></div>
              <div>持有人：{r.data.pass.holderName}</div>
              <div>发放方：{r.data.merchant?.name ?? '网上南宁平台'}</div>
              <div>发放交易：<TxLink hash={r.data.pass.mintTx} /></div>
              {r.data.pass.redeemTx && <div>核销交易：<TxLink hash={r.data.pass.redeemTx} /> · {time(r.data.pass.redeemedAt)}</div>}
            </div>
            <div className="space-y-1 text-sm">
              <div className="label">链上数据（实时读取）</div>
              {r.data.onchain ? (
                <>
                  <div>Token ID：#{r.data.onchain.tokenId}</div>
                  <div>持有地址：<span className="mono">{short(r.data.onchain.holder, 8)}</span></div>
                  <div>发放时间：{new Date(r.data.onchain.issuedAt * 1000).toLocaleString('zh-CN')}</div>
                  <div>有效期：{r.data.onchain.validUntil ? new Date(r.data.onchain.validUntil * 1000).toLocaleDateString('zh-CN') : '不过期'}</div>
                  <div>核销：{r.data.onchain.redeemedAt ? new Date(r.data.onchain.redeemedAt * 1000).toLocaleString('zh-CN') : '未核销'}</div>
                  <div>可核销：{r.data.onchain.redeemable ? '是' : '否（证书/徽章）'}</div>
                </>
              ) : <div className="text-slate-400">尚未上链</div>}
            </div>
          </div>
          <div className="mt-4 rounded-xl bg-slate-50 p-3">
            <div className="label mb-1">一致性校验</div>
            <ul className="space-y-0.5 text-sm">{r.data.checks.map((c: any) => <li key={c.label}>{c.ok ? '✅' : '❌'} {c.label}</li>)}</ul>
          </div>
          <p className="mt-3 text-xs text-slate-400">该凭证不可转让、不可交易，不是代币，没有价格。</p>
        </Section>
      )}
    </div>
  );
}
