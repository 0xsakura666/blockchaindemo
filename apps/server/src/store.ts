import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import type { DB } from './types.js';

export function emptyDb(): DB {
  return {
    users: [], merchants: [], products: [], orders: [], passes: [], couponTemplates: [], userCoupons: [],
    checkpoints: [], tasks: [], taskProgress: [], events: [], raceResults: [], chainTxs: [], gameEvents: [],
    meta: { seededAt: 0 },
  };
}

/**
 * 简单 JSON 存储：
 *  - local 模式：链在进程内、每次启动都是新链，所以数据也只放内存（重启即重置，避免链上链下不一致）
 *  - bsn 模式：链是持久的，数据写入 DATA_DIR/db.json（正式环境应换成 PostgreSQL）
 */
class Store {
  db: DB = emptyDb();
  private file = '';
  private timer: NodeJS.Timeout | null = null;

  load(): boolean {
    if (config.chainMode !== 'bsn') return false;
    this.file = path.resolve(config.dataDir, 'db.json');
    if (fs.existsSync(this.file)) {
      this.db = { ...emptyDb(), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
      return true;
    }
    return false;
  }

  reset(): void {
    this.db = emptyDb();
    this.save();
  }

  save(): void {
    if (!this.file) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2));
      fs.renameSync(tmp, this.file);
    }, 200);
  }
}

export const store = new Store();

export function uid(prefix: string): string {
  return `${prefix}_${randomBytes(5).toString('hex')}`;
}

/** 给玩家出示的短码，例如 NN-7K3QX9 */
export function passCode(): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = randomBytes(6);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `NN-${s}`;
}
