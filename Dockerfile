FROM node:18-alpine

WORKDIR /app

COPY package.json ./
COPY index.js ./
COPY run-agent.sh ./

# 健康检查端口
EXPOSE 7682/tcp
EXPOSE 7682/udp

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:7682/ >/dev/null 2>&1 || exit 1

CMD ["node", "index.js"]
