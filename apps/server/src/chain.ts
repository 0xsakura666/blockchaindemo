import { createRequire } from 'node:module';
import { Contract, ContractFactory, FetchRequest, Interface, JsonRpcProvider, NonceManager, Wallet, keccak256, toUtf8Bytes, type TransactionReceipt } from 'ethers';
import { config } from './config.js';
import { store, uid } from './store.js';
import type { ChainTx, PassType } from './types.js';
import { PASS_TYPE_INDEX } from './types.js';

const require = createRequire(import.meta.url);
const RegistryArtifact = require('../../../packages/contracts/abi/NanningRegistry.json');
const PassArtifact = require('../../../packages/contracts/abi/NanningPass.json');

export const registryIface = new Interface(RegistryArtifact.abi);
export const passIface = new Interface(PassArtifact.abi);

export const chainKey = (scope: string, id: string) => keccak256(toUtf8Bytes(`nanning:${scope}:${id}`));

/** 托管账户：由平台根据盐 + 用户 ID 派生（演示用；正式环境改为 KMS / HSM） */
export function custodyAddress(id: string): string {
  return new Wallet(keccak256(toUtf8Bytes(`${config.custodySalt}:${id}`))).address;
}

const KIND_INDEX = { merchant: 0, scenic: 1, event: 2 } as const;

class Chain {
  provider!: JsonRpcProvider;
  signer!: NonceManager;
  platformAddress = '';
  registry!: Contract;
  pass!: Contract;
  chainId = 0;
  mode = config.chainMode;
  ready = false;
  private queue: Promise<unknown> = Promise.resolve();
  private ganacheServer: { close(): Promise<void> } | null = null;

  async start(): Promise<void> {
    let key = config.platformKey;
    let rpc = config.rpcUrl;

    if (this.mode === 'local') {
      // 进程内启动一条 London 硬分叉的以太坊链（与 BSN 武汉链同内核：geth 1.10.x / London）
      const ganache = (await import('ganache')).default;
      const server = ganache.server({
        chain: { hardfork: 'london', chainId: config.chainId },
        wallet: { deterministic: true, totalAccounts: 1, defaultBalance: 1_000_000 },
        miner: { instamine: 'eager' },
        logging: { quiet: true },
      });
      await server.listen(config.localChainPort);
      this.ganacheServer = server;
      const accounts = await server.provider.getInitialAccounts();
      key = Object.values(accounts)[0].secretKey;
      rpc = `http://127.0.0.1:${config.localChainPort}`;
    }

    if (!rpc || !key) throw new Error('CHAIN_MODE=bsn 需要配置 CHAIN_RPC_URL 和 PLATFORM_PRIVATE_KEY');

    const req = new FetchRequest(rpc);
    if (config.bsnProjectKey) req.setHeader('x-api-key', config.bsnProjectKey);
    req.timeout = 30_000;
    this.provider = new JsonRpcProvider(req, config.chainId, { staticNetwork: true, polling: true, pollingInterval: 1000 });
    const wallet = new Wallet(key, this.provider);
    this.platformAddress = wallet.address;
    this.signer = new NonceManager(wallet);
    this.chainId = Number((await this.provider.getNetwork()).chainId);

    const registryAddr = this.mode === 'local' ? '' : config.registryAddress || store.db.meta.registryAddress || '';
    const passAddr = this.mode === 'local' ? '' : config.passAddress || store.db.meta.passAddress || '';
    await this.useContracts(registryAddr, passAddr);
  }

  /** 使用已部署的合约；地址为空时自动部署一套新的 */
  async useContracts(registryAddr = '', passAddr = ''): Promise<void> {
    if (!registryAddr || !passAddr) {
      registryAddr = await this.deploy(RegistryArtifact, [this.platformAddress], 'NanningRegistry');
      const metaUri = `${config.publicBaseUrl || ''}/api/passes/meta/{id}`;
      passAddr = await this.deploy(PassArtifact, [registryAddr, this.platformAddress, metaUri], 'NanningPass');
    }
    store.db.meta.registryAddress = registryAddr;
    store.db.meta.passAddress = passAddr;
    store.db.meta.chainId = this.chainId;
    this.registry = new Contract(registryAddr, RegistryArtifact.abi, this.signer);
    this.pass = new Contract(passAddr, PassArtifact.abi, this.signer);
    this.ready = true;
  }

  async stop(): Promise<void> {
    await this.ganacheServer?.close();
  }

  private overrides() {
    // 武汉链官方 SDK 使用 legacy 交易 + eth_gasPrice（默认 1 gwei）
    return { type: 0, gasPrice: config.gasPriceWei };
  }

  private async deploy(artifact: { abi: unknown[]; bytecode: string }, args: unknown[], name: string): Promise<string> {
    const rec = this.record('deploy', name, `部署合约 ${name}`);
    try {
      const factory = new ContractFactory(artifact.abi as never, artifact.bytecode, this.signer);
      const c = await factory.deploy(...args, this.overrides());
      const receipt = await c.deploymentTransaction()!.wait();
      this.confirm(rec, receipt!);
      return await c.getAddress();
    } catch (e) {
      this.fail(rec, e);
      throw e;
    }
  }

  private record(kind: ChainTx['kind'], ref: string, summary: string): ChainTx {
    const tx: ChainTx = { id: uid('tx'), kind, ref, summary, status: 'queued', createdAt: Date.now() };
    store.db.chainTxs.unshift(tx);
    if (store.db.chainTxs.length > 500) store.db.chainTxs.length = 500;
    store.save();
    return tx;
  }

  private confirm(tx: ChainTx, receipt: TransactionReceipt) {
    tx.status = 'confirmed';
    tx.hash = receipt.hash;
    tx.blockNumber = receipt.blockNumber;
    tx.gasUsed = receipt.gasUsed.toString();
    tx.confirmedAt = Date.now();
    store.save();
  }

  private fail(tx: ChainTx, e: unknown) {
    tx.status = 'failed';
    const err = e as { shortMessage?: string; reason?: string; message?: string };
    tx.error = err.reason || err.shortMessage || err.message || String(e);
    store.save();
  }

  /** 所有写交易串行排队，避免 nonce 冲突；BSN 门户版网关 TPS 10–20，串行足够 */
  private enqueue<T>(kind: ChainTx['kind'], ref: string, summary: string, send: () => Promise<{ wait(): Promise<TransactionReceipt | null> }>): Promise<{ receipt: TransactionReceipt; tx: ChainTx }> {
    const rec = this.record(kind, ref, summary);
    const job = this.queue.then(async () => {
      rec.status = 'sent';
      try {
        const resp = await send();
        const receipt = await resp.wait();
        if (!receipt || receipt.status !== 1) throw new Error('交易执行失败');
        this.confirm(rec, receipt);
        return { receipt, tx: rec };
      } catch (e) {
        this.signer.reset();
        this.fail(rec, e);
        throw e;
      }
    });
    this.queue = job.catch(() => undefined);
    return job as Promise<{ receipt: TransactionReceipt; tx: ChainTx }>;
  }

  registerMerchant(merchantKey: string, kind: keyof typeof KIND_INDEX, account: string, metaHash: string, label: string) {
    return this.enqueue('registerMerchant', merchantKey, `登记商家「${label}」`, () =>
      this.registry.registerMerchant(merchantKey, KIND_INDEX[kind], account, metaHash, this.overrides()));
  }

  setMerchantStatus(merchantKey: string, status: 'active' | 'suspended', label: string) {
    return this.enqueue('setStatus', merchantKey, `${status === 'active' ? '恢复' : '暂停'}商家「${label}」`, () =>
      this.registry.setStatus(merchantKey, status === 'active' ? 1 : 2, this.overrides()));
  }

  anchorOrder(orderKey: string, merchantKey: string, dataHash: string, label: string) {
    return this.enqueue('anchorOrder', orderKey, `订单存证 ${label}`, () =>
      this.pass.anchorOrder(orderKey, merchantKey, dataHash, this.overrides()));
  }

  async mintPass(to: string, passType: PassType, merchantKey: string, orderHash: string, validUntil: number, label: string) {
    const r = await this.enqueue('mintPass', orderHash, `发放凭证「${label}」`, () =>
      this.pass.mintPass(to, PASS_TYPE_INDEX[passType], merchantKey, orderHash, validUntil, this.overrides()));
    let tokenId = 0;
    for (const log of r.receipt.logs) {
      try {
        const parsed = passIface.parseLog(log);
        if (parsed?.name === 'PassIssued') tokenId = Number(parsed.args.tokenId);
      } catch { /* 其他合约日志 */ }
    }
    return { ...r, tokenId };
  }

  redeem(tokenId: number, merchantKey: string, label: string) {
    return this.enqueue('redeem', String(tokenId), `核销凭证 #${tokenId}「${label}」`, () =>
      this.pass.redeem(tokenId, merchantKey, this.overrides()));
  }

  // ------------------------------------------------------------------ 只读

  async readPass(tokenId: number) {
    const p = await this.pass.getPass(tokenId);
    const holder = await this.pass.holderOf(tokenId);
    return {
      tokenId,
      holder,
      passType: Object.keys(PASS_TYPE_INDEX)[Number(p.passType)],
      redeemable: p.redeemable,
      issuedAt: Number(p.issuedAt),
      validUntil: Number(p.validUntil),
      redeemedAt: Number(p.redeemedAt),
      merchantId: p.merchantId,
      orderHash: p.orderHash,
      redeemedBy: p.redeemedBy,
    };
  }

  async readOrderAnchor(orderKey: string): Promise<string> {
    return this.pass.orderAnchors(orderKey);
  }

  async readMerchant(merchantKey: string) {
    const m = await this.registry.getMerchant(merchantKey);
    return { status: ['None', 'Active', 'Suspended'][Number(m.status)], account: m.account, metaHash: m.metaHash, updatedAt: Number(m.updatedAt) };
  }

  async info() {
    const block = await this.provider.getBlockNumber();
    return {
      mode: this.mode,
      network: this.mode === 'bsn' ? 'BSN 武汉链（Ethereum / London）' : '本地演示链（London 硬分叉，与武汉链同内核）',
      chainId: this.chainId,
      blockNumber: block,
      platformAddress: this.platformAddress,
      registryAddress: store.db.meta.registryAddress,
      passAddress: store.db.meta.passAddress,
      explorerTxUrl: this.mode === 'bsn' ? config.explorerTxUrl : null,
      compiler: 'solc 0.8.19 · evmVersion london',
    };
  }

  /** 内置区块浏览器：读取交易与回执并解码合约事件 */
  async describeTx(hash: string) {
    const [tx, receipt] = await Promise.all([this.provider.getTransaction(hash), this.provider.getTransactionReceipt(hash)]);
    if (!tx || !receipt) return null;
    const block = await this.provider.getBlock(receipt.blockNumber);
    const decode = (data: string) => {
      for (const iface of [passIface, registryIface]) {
        try {
          const d = iface.parseTransaction({ data });
          if (d) return { method: d.name, args: d.args.toArray().map(String) };
        } catch { /* next */ }
      }
      return data.length > 10 ? { method: '合约部署', args: [] } : null;
    };
    const events = receipt.logs.flatMap((log) => {
      for (const iface of [passIface, registryIface]) {
        try {
          const p = iface.parseLog(log);
          if (p) return [{ name: p.name, address: log.address, args: Object.fromEntries(p.fragment.inputs.map((inp, i) => [inp.name, String(p.args[i])])) }];
        } catch { /* next */ }
      }
      return [];
    });
    return {
      hash,
      from: tx.from,
      to: tx.to,
      nonce: tx.nonce,
      type: tx.type,
      gasPrice: tx.gasPrice?.toString(),
      gasUsed: receipt.gasUsed.toString(),
      status: receipt.status === 1 ? 'success' : 'failed',
      blockNumber: receipt.blockNumber,
      timestamp: block?.timestamp,
      call: decode(tx.data),
      events,
    };
  }
}

export const chain = new Chain();
