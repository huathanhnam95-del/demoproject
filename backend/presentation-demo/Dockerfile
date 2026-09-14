FROM node:22-slim
WORKDIR /app/backend/presentation-demo
COPY backend/presentation-demo/package*.json ./
RUN npm ci --omit=dev
COPY backend/presentation-demo/server.cjs ./
COPY functions/src /app/functions/src
COPY public /app/public
EXPOSE 8080
CMD ["node", "server.cjs"]
