FROM node:22-slim
WORKDIR /app/backend/presentation-demo
COPY backend/presentation-demo/package*.json ./
RUN npm ci --omit=dev
COPY functions/package*.json /app/functions/
RUN cd /app/functions && npm ci --omit=dev
COPY backend/presentation-demo/server.cjs ./
COPY backend/presentation-demo/gateway.cjs ./
COPY functions/src /app/functions/src
COPY public/presentation-demo /app/public/presentation-demo
COPY public/js/presentation-demo /app/public/js/presentation-demo
COPY public/prototypes/bel-working-as-equals-demo /app/public/prototypes/bel-working-as-equals-demo
EXPOSE 8080
CMD ["node", "server.cjs"]
