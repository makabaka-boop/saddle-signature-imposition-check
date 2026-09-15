# syntax=docker/dockerfile:1

# ---- 构建阶段：安装依赖并产出纯静态文件 dist/ ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Web 阶段：仅运行静态 Web 服务 ----
FROM nginx:1.27-alpine AS web
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null 2>&1 || exit 1

# ---- 验收阶段：构建 + 单测 + Playwright 端到端，一次性退出 ----
FROM mcr.microsoft.com/playwright:v1.49.1-bookworm AS verify
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npx playwright install chromium
COPY . .
CMD ["npm", "run", "verify"]
