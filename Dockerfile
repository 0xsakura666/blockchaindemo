# 单服务部署：Fastify API + 前端静态文件 + （local 模式下）进程内演示链
FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/game-sdk/package.json packages/game-sdk/
COPY packages/contracts/package.json packages/contracts/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build -w apps/web
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
CMD ["npm", "start"]
