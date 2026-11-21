# 接入《网上南宁》游戏（Three.js）

本目录是把链上凭证接入游戏的**可直接应用的改动**，基于公开仓库
[`JayZz210l/nanning_project`](https://github.com/JayZz210l/nanning_project)（Cyber Nanning，commit `0e5c8d3`）制作并实测。
`JayZz210l/Project_NanNing_Fork` 目前对我们的 GitHub 账号返回 404（私有或未授权），拿到权限后按同样方式合入即可——两者的 `main.ts` 结构一致时补丁可直接应用，不一致时按下面「手动接入」三步改。

## 改动内容

| 文件 | 作用 |
|---|---|
| `src/chain/NanningChainBridge.ts` | 对接 SDK（与本仓库 `packages/game-sdk/src/index.ts` 相同，零依赖单文件） |
| `src/chain/CheckpointMarkers.ts` | 在 3D 城市里画出打卡点（发光圆环 + 光柱）和商家标记 |
| `src/main.ts` | 约 30 行：初始化 SDK、每帧上报玩家坐标、渲染标记 |
| `.env.example` | `VITE_CHAIN_API=` 链上凭证服务地址，留空则不启用，游戏照常运行 |

## 应用补丁

```bash
cd nanning_project
git apply ../blockchaindemo/integration/nanning_project/nanning_project.patch
npm install && npm run build && npm test   # 已实测：tsc + vite build 通过，原有 10 个测试全部通过
```

运行：`npm run dev`，然后打开
`http://localhost:5173/?chain=http://localhost:8787&player=p_aning`
（`chain` 为本仓库 server 地址，`player` 为演示玩家 ID）。

## 游戏内效果（已用无头浏览器实测）

- 走进万象城 / 三祺广场 / 明湖 / 石门森林公园 / 会展中心的黄色圆环 → 右上角提示打卡进度，任务完成后**链上发放打卡徽章** + 优惠券。
- 会展中心站 → 万象城站 → 东盟商务区站（青色圆环，沿民族大道）= 马拉松线上赛道，按顺序跑完记录成绩。
- 靠近商家出现「按 P 进店」，弹出商城浮层直接下单；按 K 打开「我的链上凭证」。

## 手动接入（三步）

```ts
import { NanningChainBridge } from './chain/NanningChainBridge';
const bridge = new NanningChainBridge({ apiBase: import.meta.env.VITE_CHAIN_API, playerId });
await bridge.init(); bridge.mountHud();
// 渲染循环里：
bridge.tick(player.position.x, player.position.z);
```

坐标系无需换算：服务端打卡点直接取自游戏地图 `public/data/nanning.json` 的 labels（原点 22.812°N 108.386°E，x 向东、z 向南，米）。

## 正式上线前要改的地方

1. **玩家身份**：现在用 `?player=` 演示。正式环境由游戏账号系统登录，玩家 ID 由服务端下发。
2. **防作弊**：现在由浏览器直接上报坐标，服务端只做距离复核。多人联机版应由**游戏服务器**上报，并设置 `GAME_HMAC_SECRET`，请求头带 `x-game-signature = HMAC-SHA256(body)`。
3. **多人联机**：公开仓库是单机版；Fork 里的联机服务器拿到后，把 `tick()` 的调用挪到服务器端的玩家位置同步逻辑里即可。
