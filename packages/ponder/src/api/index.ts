import { Hono } from "hono";
import { db } from "ponder:api";
import schema from "ponder:schema";
import { graphql } from "ponder";

// Create Hono app instance
const app = new Hono();

// Enable GraphQL API at /graphql (includes GraphiQL playground)
app.use("/graphql", graphql({ db, schema }));

// Custom health endpoint
app.get("/api/ping", (c) => {
  return c.json({
    message: "pong",
    timestamp: Date.now()
  });
});

// Export Hono app
export default app;
