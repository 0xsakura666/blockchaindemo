import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { PASS_LABEL, short, STATUS_LABEL } from './api';

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn()
      .then((d) => alive && (setData(d), setError('')))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'amber' | 'violet' | 'pink' | 'red' | 'cyan' }) {
  const map = {
    slate: 'bg-slate-100 text-slate-700', green: 'bg-emerald-100 text-emerald-700', amber: 'bg-amber-100 text-amber-800',
    violet: 'bg-violet-100 text-violet-700', pink: 'bg-pink-100 text-pink-700', red: 'bg-red-100 text-red-700', cyan: 'bg-cyan-100 text-cyan-800',
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[tone]}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const tone = ({ active: 'green', redeemed: 'slate', minting: 'amber', failed: 'red', paid: 'violet', fulfilled: 'green', pending: 'amber', confirmed: 'green', queued: 'amber', sent: 'amber' } as const)[status as 'active'] || 'slate';
  return <Badge tone={tone}>{STATUS_LABEL[status] || status}</Badge>;
}

export function TxLink({ hash, label }: { hash?: string; label?: string }) {
  if (!hash) return <span className="text-slate-400 text-xs">—</span>;
  return (
    <Link to={`/explorer/tx/${hash}`} className="mono text-violet-600 hover:underline" title={hash}>
      {label ? `${label} ` : ''}{short(hash)}
    </Link>
  );
}

export function Section({ title, extra, children }: { title: ReactNode; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="card p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

export function ErrorText({ error }: { error?: string }) {
  if (!error) return null;
  return <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{children}</div>;
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="card max-h-[90vh] w-full max-w-lg overflow-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">{title}</h3>
          <button className="text-slate-400 hover:text-slate-700" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function QR({ text, size = 120 }: { text: string; size?: number }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(text, { width: size * 2, margin: 1 }).then(setSrc);
  }, [text, size]);
  return src ? <img src={src} width={size} height={size} alt="核销二维码" className="rounded-lg border" /> : <div style={{ width: size, height: size }} />;
}

const PASS_ICON: Record<string, string> = { Product: '🧾', Ticket: '🎫', RaceEntry: '🏃', FinisherCert: '🏅', CheckinBadge: '📍' };

export function PassCard({ pass, showQr = true }: { pass: any; showQr?: boolean }) {
  const verifyUrl = `${location.origin}/verify/${pass.code}`;
  const redeemable = ['Product', 'Ticket', 'RaceEntry'].includes(pass.passType);
  return (
    <div className={`card flex gap-4 p-4 ${pass.status === 'redeemed' ? 'opacity-70' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg">{PASS_ICON[pass.passType]}</span>
          <Badge tone={redeemable ? 'violet' : 'pink'}>{PASS_LABEL[pass.passType]}</Badge>
          <StatusBadge status={pass.status} />
          {pass.tokenId ? <Badge tone="cyan">Token #{pass.tokenId}</Badge> : null}
        </div>
        <div className="mt-2 font-medium text-slate-900">{pass.title}</div>
        <div className="mt-1 text-xs text-slate-500">发放方：{pass.merchantName || '—'}</div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span>核销码 <b className="font-mono text-sm tracking-wider text-slate-900">{pass.code}</b></span>
          <TxLink hash={pass.mintTx} label="发放交易" />
          {pass.redeemTx && <TxLink hash={pass.redeemTx} label="核销交易" />}
          <Link to={`/verify/${pass.code}`} className="text-violet-600 hover:underline">链上验真 →</Link>
        </div>
        {pass.validUntil ? <div className="mt-1 text-xs text-slate-400">有效期至 {new Date(pass.validUntil * 1000).toLocaleDateString('zh-CN')}</div> : null}
        <div className="mt-1 text-[11px] text-slate-400">不可转让 · 不可交易 · 非代币</div>
      </div>
      {showQr && redeemable && pass.status === 'active' && <QR text={verifyUrl} size={96} />}
    </div>
  );
}

export function Toast({ msg, onDone }: { msg: string; onDone: () => void }) {
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(onDone, 3500);
    return () => clearTimeout(t);
  }, [msg, onDone]);
  if (!msg) return null;
  return <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">{msg}</div>;
}
