import { Hono } from "hono";

// Create Hono app instance
const app = new Hono();

// Note: GraphQL is automatically served by Ponder at /graphql
// This file is for custom API routes only

// Custom health endpoint
app.get("/api/ping", (c) => {
  return c.json({
    message: "pong",
    timestamp: Date.now()
  });
});

// Export Hono app
export default app;
