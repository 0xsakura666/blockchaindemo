import { Link, useParams } from 'react-router-dom';
import { api, short, time } from '../api';
import { Badge, ErrorText, Section, StatusBadge, TxLink, useAsync } from '../ui';

const METHOD_LABEL: Record<string, string> = {
  registerMerchant: '登记商家', setStatus: '变更商家状态', anchorOrder: '订单存证', mintPass: '发放凭证', redeem: '核销凭证', 合约部署: '合约部署',
};

export default function Explorer() {
  const info = useAsync<any>(() => api('/api/chain/info'));
  const txs = useAsync<any[]>(() => api('/api/chain/txs'));
  return (
    <div className="space-y-4">
      <Section title="区块浏览器" extra={<button className="btn-ghost" onClick={() => { info.reload(); txs.reload(); }}>刷新</button>}>
        {info.data && (
          <div className="grid gap-2 text-sm md:grid-cols-2">
            <div>网络：<b>{info.data.network}</b></div>
            <div>Chain ID：{info.data.chainId} · 最新区块 #{info.data.blockNumber}</div>
            <div>NanningRegistry：<span className="mono">{info.data.registryAddress}</span></div>
            <div>NanningPass：<span className="mono">{info.data.passAddress}</span></div>
            <div>平台签名账户：<span className="mono">{info.data.platformAddress}</span></div>
            <div>编译：{info.data.compiler}</div>
            {info.data.explorerTxUrl && <div className="md:col-span-2">BSN 官方浏览器：<a className="text-violet-600" href={info.data.explorerTxUrl} target="_blank" rel="noreferrer">{info.data.explorerTxUrl}</a></div>}
          </div>
        )}
        {info.data?.mode === 'local' && <p className="mt-3 rounded-lg bg-cyan-50 px-3 py-2 text-xs text-cyan-900">当前为本地演示链（London 硬分叉，与 BSN 武汉链同为以太坊内核）。配置 BSN 项目 ID 与链账户私钥后切换到武汉链，同一套合约和代码即可在 wuhanexplorer.bsnbase.com 上公开查询。</p>}
      </Section>
      <Section title="最近交易">
        <div className="space-y-1 text-sm">
          {txs.data?.filter((t) => t.hash).map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-2 border-b py-2">
              <StatusBadge status={t.status} />
              <span className="flex-1">{t.summary}</span>
              <span className="text-xs text-slate-400">#{t.blockNumber} · gas {t.gasUsed} · {time(t.confirmedAt)}</span>
              <TxLink hash={t.hash} />
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

export function TxDetail() {
  const { hash } = useParams();
  const r = useAsync<any>(() => api(`/api/chain/tx/${hash}`), [hash]);
  const info = useAsync<any>(() => api('/api/chain/info'));
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link to="/explorer" className="text-sm text-violet-600">← 返回区块浏览器</Link>
      <ErrorText error={r.error} />
      {r.data && (
        <Section title={r.data.summary || '交易详情'} extra={<Badge tone={r.data.status === 'success' ? 'green' : 'red'}>{r.data.status === 'success' ? '成功' : '失败'}</Badge>}>
          <dl className="grid gap-x-4 gap-y-2 text-sm md:grid-cols-[140px_1fr]">
            <dt className="label">交易哈希</dt><dd className="mono">{r.data.hash}</dd>
            <dt className="label">区块</dt><dd>#{r.data.blockNumber} · {r.data.timestamp ? new Date(r.data.timestamp * 1000).toLocaleString('zh-CN') : ''}</dd>
            <dt className="label">发起方（平台）</dt><dd className="mono">{r.data.from}</dd>
            <dt className="label">合约</dt><dd className="mono">{r.data.to || '（合约创建）'}</dd>
            <dt className="label">交易类型</dt><dd>type {r.data.type}（legacy，与武汉链官方 SDK 一致）· gasPrice {r.data.gasPrice} wei · gasUsed {r.data.gasUsed}</dd>
            <dt className="label">调用方法</dt><dd>{r.data.call ? <><b>{METHOD_LABEL[r.data.call.method] || r.data.call.method}</b> <code className="text-xs">{r.data.call.method}({r.data.call.args.map((a: string) => short(a, 10)).join(', ')})</code></> : '—'}</dd>
          </dl>
          <div className="mt-4">
            <div className="label mb-2">合约事件（已解码）</div>
            {r.data.events.length === 0 && <div className="text-xs text-slate-400">无</div>}
            {r.data.events.map((e: any, i: number) => (
              <div key={i} className="mb-2 rounded-xl bg-slate-50 p-3 text-xs">
                <b className="text-sm">{e.name}</b>
                <div className="mt-1 grid gap-1 md:grid-cols-2">{Object.entries(e.args).map(([k, v]) => <div key={k}><span className="text-slate-500">{k}</span> <span className="mono">{String(v)}</span></div>)}</div>
              </div>
            ))}
          </div>
          {info.data?.explorerTxUrl && <a className="btn-ghost mt-2" target="_blank" rel="noreferrer" href={info.data.explorerTxUrl}>在 BSN 武汉链浏览器中查询</a>}
        </Section>
      )}
    </div>
  );
}
