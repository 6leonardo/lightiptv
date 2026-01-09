# Use Alpine-based Node.js image (smallest)
FROM node:20-alpine

# Install FFmpeg
RUN apk add --no-cache ffmpeg

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (with dev deps for build)
RUN npm ci

# Copy application files
COPY tsconfig.json ./
COPY server.ts ./
COPY app ./app
COPY .env.sample ./.env

# Build TypeScript and prune dev deps
RUN npm run build && npm prune --production

# Create streams directory
RUN mkdir -p app/public/streams

# Expose port
EXPOSE 3005

# Start application
CMD ["node", "dist/server.js"]
