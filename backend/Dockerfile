# ============ Backend Dockerfile ============
FROM node:20-slim AS base
WORKDIR /app

# 安装 OpenSSL（Prisma 需要）
RUN apt-get update -qq && apt-get install -y -qq openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# 安装依赖
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm install --production=false

# 生成 Prisma Client
RUN npx prisma generate

# 构建源码
COPY . .
RUN npx tsc --noEmit || true
RUN npm run build

# 生产镜像
FROM node:20-slim AS production
WORKDIR /app

RUN apt-get update -qq && apt-get install -y -qq openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/dist ./dist
COPY --from=base /app/prisma ./prisma
COPY --from=base /app/package.json ./

EXPOSE 3001
# 启动前应用 Prisma 迁移（已有库且表已存在时，首次需手动 baseline）
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
