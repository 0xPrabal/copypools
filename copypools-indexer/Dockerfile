# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci && \
    npm cache clean --force

# Copy source code and ABIs
COPY . .

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S ponder -u 1001

# Copy application
COPY --from=builder --chown=ponder:nodejs /app ./

# Switch to non-root user
USER ponder

# Expose port (Ponder default)
EXPOSE 42069

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start Ponder
CMD ["npm", "run", "start"]
