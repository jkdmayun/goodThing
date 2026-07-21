FROM node:20-alpine

WORKDIR /app

COPY package.json index.js ./

# 构建阶段检查 JavaScript 语法。
RUN node --check index.js

ENV PORT=7682

EXPOSE 7682/tcp

CMD ["node", "index.js"]
