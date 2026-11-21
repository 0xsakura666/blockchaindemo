import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { chain } from './chain.js';
import { config } from './config.js';
import { registerRoutes } from './routes.js';
import { seed } from './seed.js';
import { HttpError } from './services.js';
import { store } from './store.js';

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(cors, { origin: true });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message });
    const e = err as { statusCode?: number; reason?: string; shortMessage?: string; message: string };
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: e.message });
    app.log.error(err);
    return reply.status(500).send({ error: e.reason || e.shortMessage || e.message });
  });

  await registerRoutes(app);

  // 生产环境：同一个服务托管前端构建产物（apps/web/dist），SPA 路由回退到 index.html
  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDist = path.resolve(here, '../../web/dist');
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Not Found' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}

export async function boot() {
  const restored = store.load();
  await chain.start();
  if (!restored || !store.db.meta.seededAt) await seed();
  store.save();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  boot()
    .then(async () => {
      const app = await buildApp({ logger: true });
      await app.listen({ port: config.port, host: '0.0.0.0' });
      const info = await chain.info();
      console.log(`\n✅ 网上南宁 × BSN demo 已启动 http://localhost:${config.port}`);
      console.log(`   链：${info.network} chainId=${info.chainId}`);
      console.log(`   NanningRegistry ${info.registryAddress}`);
      console.log(`   NanningPass     ${info.passAddress}\n`);
    })
    .catch((e) => {
      console.error('启动失败：', e);
      process.exit(1);
    });
}
