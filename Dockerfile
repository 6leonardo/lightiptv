FROM node:20-alpine AS deps

WORKDIR /app

COPY backend/package*.json backend/
COPY frontend/package*.json frontend/

RUN cd backend && npm ci
RUN cd frontend && npm ci

FROM node:20-alpine AS build

WORKDIR /app

COPY --from=deps /app/backend/node_modules backend/node_modules
COPY --from=deps /app/frontend/node_modules frontend/node_modules

COPY backend backend
COPY frontend frontend

RUN cd frontend && npm run build
RUN cd backend && npm run build

FROM node:20-alpine AS runner

RUN apk add --no-cache ffmpeg

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/backend/package*.json ./
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./app

EXPOSE 3005

CMD ["node", "app/index.js"]
