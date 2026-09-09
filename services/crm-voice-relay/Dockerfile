# Build from the repository root. No dotenv or local credentials enter the image.
FROM node:22-bookworm-slim
WORKDIR /app
COPY functions/package.json functions/package-lock.json ./functions/
RUN cd functions && npm ci --omit=dev
COPY services/crm-voice-relay/package.json services/crm-voice-relay/package-lock.json ./services/crm-voice-relay/
RUN cd services/crm-voice-relay && npm ci --omit=dev
COPY functions/src ./functions/src
COPY services/crm-voice-relay/*.js ./services/crm-voice-relay/
USER node
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "services/crm-voice-relay/runtime.js"]
