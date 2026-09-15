# syntax=docker/dockerfile:1

# ---- 构建阶段：安装依赖并产出纯静态文件 dist/ ----
# 此阶段只做 Vite 构建，不需要 Playwright 浏览器，跳过浏览器下载以保证
# 构建过程不依赖 Playwright CDN。
FROM node:22-bookworm-slim AS build
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
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
# 注意：Playwright 官方镜像只有 jammy/noble（Ubuntu）标签，没有 bookworm；
# 标签大版本必须与 package-lock.json 中的 @playwright/test 完全一致
# （此处为 1.63.0），镜像内 /ms-playwright 已预装匹配的浏览器与系统依赖。
FROM mcr.microsoft.com/playwright:v1.63.0-jammy AS verify
# 镜像默认以非 root 的 pwuser 运行，安装依赖需要写工作目录：
# 先以 root 完成 npm ci 与拷贝，再整体交还 /app 给 pwuser。
USER root
WORKDIR /app
# 浏览器由镜像预装在 /ms-playwright（PLAYWRIGHT_BROWSERS_PATH 已在镜像环境变量中），
# 跳过 npm 安装时的二次下载，避免构建依赖外网 CDN。
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN chown -R pwuser:pwuser /app
USER pwuser
CMD ["npm", "run", "verify"]
