FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application files
COPY server.js ./
COPY github-client.js ./
COPY db.js ./
COPY analyzer.js ./
COPY ai-provider.js ./
COPY summarizer.js ./
COPY recommender.js ./
COPY scheduler.js ./
COPY src ./src
COPY scripts ./scripts
COPY public ./public

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/ || exit 1

# Start the application
CMD ["node", "server.js"]
