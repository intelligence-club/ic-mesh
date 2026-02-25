FROM node:22-slim
RUN apt-get update -qq && apt-get install -y -qq curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN mkdir -p data
EXPOSE 8333
ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=5s CMD curl -f http://localhost:8333/status || exit 1
CMD ["node", "server.js"]
