# Carbon Credit Trading Platform — API server that also serves the web app
FROM node:22-alpine

WORKDIR /app
COPY backend/package.json backend/package-lock.json backend/
RUN cd backend && npm ci --omit=dev

COPY backend backend
COPY frontend frontend

ENV NODE_ENV=production \
    PORT=3001 \
    UPLOAD_DIR=/data/uploads
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:3001/api/health || exit 1
CMD ["node", "backend/server.js"]
