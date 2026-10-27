# Собирается из корня репозитория: docker build -f server/Dockerfile .
FROM node:24-alpine

WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY server/src ./src
# Веб-версия клиента: та же страница, что и в приложении для Windows
COPY client/renderer ./web

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    WEB_DIR=/app/web

RUN mkdir /data && chown node:node /data
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "src/index.js"]
