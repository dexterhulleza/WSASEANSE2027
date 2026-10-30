# WorldSkills ASEAN Special Edition 2027 — Skills Registry
# No npm dependencies: the server uses only the Node.js standard library.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    APP_TIMEZONE=Asia/Manila \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

WORKDIR /app
COPY package.json server.js ./
COPY public ./public
COPY scripts ./scripts

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "server.js"]
