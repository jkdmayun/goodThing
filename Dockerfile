FROM node:20-alpine

WORKDIR /app

# curl: install-agent.sh uses it to download the agent binary
# ca-certificates: TLS for downloads; tzdata: correct container clock
RUN apk add --no-cache openssl ca-certificates tzdata curl

ENV NODE_ENV=production

COPY package.json ./
COPY index.js ./

EXPOSE 7682/tcp
EXPOSE 7682/udp

# index.js serves an always-OK health endpoint on 7682
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:7682/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
