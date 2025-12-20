FROM node:20-slim

WORKDIR /app

# Copy package files first for better caching
COPY packages/backend/package.json packages/backend/yarn.lock* ./

# Install dependencies
RUN yarn install --ignore-engines

# Copy source files and config
COPY packages/backend/tsconfig.json ./
COPY packages/backend/src ./src

# Build TypeScript
RUN yarn build

# Expose port
EXPOSE 3001

# Start the server
CMD ["yarn", "start"]
