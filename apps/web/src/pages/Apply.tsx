import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useSession } from '../session';
import { ErrorText, Section } from '../ui';

export default function Apply() {
  const { switchUser, refreshUsers } = useSession();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', kind: 'merchant', category: '餐饮', intro: '', address: '南宁市青秀区', licenseNo: '', contact: '' });
  const [error, setError] = useState('');
  const submit = async () => {
    setError('');
    try {
      const r = await api('/api/merchants/apply', { body: f });
      refreshUsers();
      switchUser(r.user.id);
      nav('/merchant');
    } catch (e) { setError((e as Error).message); }
  };
  const field = (k: keyof typeof f, label: string) => (
    <label className="block"><span className="label">{label}</span><input className="input mt-1" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  );
  return (
    <div className="mx-auto max-w-xl">
      <Section title="商家 / 景区 / 赛事主办方 入驻申请">
        <div className="space-y-3 text-sm">
          {field('name', '店铺 / 景区 / 主办方名称')}
          <label className="block"><span className="label">类型</span>
            <select className="input mt-1" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              <option value="merchant">商家（到店 / 快递商品）</option><option value="scenic">景区（门票 / 周边）</option><option value="event">赛事主办方（报名）</option>
            </select>
          </label>
          {field('category', '经营类目')}
          {field('licenseNo', '统一社会信用代码（演示可随便填，系统会脱敏）')}
          {field('address', '经营地址')}
          {field('contact', '联系电话')}
          <label className="block"><span className="label">简介</span><textarea className="input mt-1" rows={3} value={f.intro} onChange={(e) => setF({ ...f, intro: e.target.value })} /></label>
          <ErrorText error={error} />
          <button className="btn-primary w-full" onClick={submit}>提交申请</button>
          <p className="text-xs text-slate-500">提交后由平台运营审核；审核通过时，平台把「商家 ID + 资料哈希」登记到 NanningRegistry 合约（不上传任何原始资料）。正式环境还需完成微信支付二级商户进件。</p>
        </div>
      </Section>
    </div>
  );
}
