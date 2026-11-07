FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4174

COPY package.json index.html ./
COPY assets ./assets
COPY src ./src
COPY data ./data
COPY server ./server

EXPOSE 4174
VOLUME ["/app/server/data"]

CMD ["node", "server/index.mjs"]
