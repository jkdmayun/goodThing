FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl ca-certificates tzdata curl

COPY package.json /app/package.json
COPY index.js /app/index.js

RUN chmod +x /app/index.js

EXPOSE 7682/tcp
EXPOSE 7682/udp

CMD ["node", "index.js"]
