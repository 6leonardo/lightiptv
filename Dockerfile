# Use Alpine-based Node.js image (smallest)
FROM node:20-alpine

# Install FFmpeg
RUN apk add --no-cache ffmpeg

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Create streams directory
RUN mkdir -p public/streams

# Expose port
EXPOSE 3005

# Start application
CMD ["node", "server.js"]
