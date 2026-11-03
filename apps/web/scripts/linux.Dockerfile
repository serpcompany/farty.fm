ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-bookworm
ARG PLAYWRIGHT_VERSION
RUN npx -y "playwright@${PLAYWRIGHT_VERSION}" install --with-deps chromium \
  && corepack enable \
  && git config --system --add safe.directory '*'
WORKDIR /work/apps/web
