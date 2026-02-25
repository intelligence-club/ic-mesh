FROM node:22-slim
RUN apt-get update -qq && apt-get install -y -qq curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY . .

# Create data directories and set permissions
RUN mkdir -p data/uploads && \
    chown -R node:node /app && \
    chmod -R 755 /app

# Run as non-root user
USER node

# Expose port
EXPOSE 8333

# Environment variables
ENV NODE_ENV=production
ENV PORT=8333

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:8333/status || exit 1

# Use exec form for proper signal handling
CMD ["node", "server.js"]
