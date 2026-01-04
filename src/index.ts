import "dotenv/config";
import express from "express";
import path from "path";
import mongoose from "mongoose";
import { authenticator } from "otplib";
import * as qrcode from "qrcode-terminal";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { connectDatabase } from "./db/mongo";
import { captureRawBody } from "./middleware/slack-verify";
import { slackRoutes } from "./routes/slack.routes";
import { usersRoutes } from "./routes/users.routes";
import { adminRoutes } from "./routes/admin.routes";
import { startScheduler, stopScheduler } from "./scheduler/daily-prompt";

async function main(): Promise<void> {
  // Connect to MongoDB
  await connectDatabase();

  // Create Express app
  const app = express();

  // Trust proxy for proper IP detection (Heroku, ngrok, etc.)
  app.set("trust proxy", 1);

  // Capture raw body for Slack signature verification
  app.use(express.urlencoded({ extended: true, verify: captureRawBody }));
  app.use(express.json({ verify: captureRawBody }));

  // Serve static files for admin UI
  app.use("/admin", express.static(path.join(process.cwd(), "public")));

  // Mount routes
  app.use("/slack", slackRoutes);
  app.use("/users", usersRoutes);
  app.use("/admin", adminRoutes);

  // Root health check
  app.get("/", (_req, res) => {
    res.json({ 
      service: "daily-bot", 
      status: "running",
      timestamp: new Date().toISOString(),
    });
  });

  // Start server
  const port = env.port;
  const server = app.listen(port, () => {
    logger.info({ port }, "Server running");
    
    // Print TOTP setup info with QR code
    const otpauth = authenticator.keyuri("admin", "DailyBot", env.adminTotpSecret);
    console.log("\n========== TOTP AUTHENTICATOR SETUP ==========");
    console.log("Scan this QR code with your authenticator app:\n");
    qrcode.generate(otpauth, { small: true });
    console.log(`\nSecret: ${env.adminTotpSecret}`);
    console.log("===============================================\n");
  });

  // Start scheduler
  await startScheduler();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutdown signal received");
    
    // Stop scheduler
    stopScheduler();
    
    // Close server
    server.close(() => {
      logger.info("HTTP server closed");
    });
    
    // Close database connection
    try {
      await mongoose.connection.close();
      logger.info("Database connection closed");
    } catch (error) {
      logger.error({ error }, "Error closing database");
    }
    
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error) => {
  logger.fatal({ error }, "Failed to start server");
  process.exit(1);
});
