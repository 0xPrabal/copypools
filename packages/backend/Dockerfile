FROM node:20-slim

WORKDIR /app

# Copy all files
COPY . .

# Install dependencies and build
RUN yarn install --ignore-engines
RUN yarn build

# Expose port
EXPOSE 3001

# Start the server
CMD ["yarn", "start"]
