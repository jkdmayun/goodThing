FROM node:20-alpine

WORKDIR /app

COPY index.js package.json ./

EXPOSE 7682

CMD ["node", "index.js"]
