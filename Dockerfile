FROM node:18-slim

# Install latest Chromium and dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use the pre-installed system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PORT=8080

WORKDIR /app

COPY package*.json ./
RUN npm install --no-audit --no-fund --quiet

COPY . .

# Expose port for health checks (required by Koyeb/Render/Railway)
EXPOSE 8080

CMD ["node", "index.js"]
