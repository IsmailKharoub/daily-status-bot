import "dotenv/config";
import express from "express";
import path from "path";
import { authenticator } from "otplib";
import * as qrcode from "qrcode-terminal";
import { env } from "./config/env";
import { connectDatabase } from "./db/mongo";
import { slackRoutes } from "./routes/slack.routes";
import { usersRoutes } from "./routes/users.routes";
import { adminRoutes } from "./routes/admin.routes";
import { startScheduler } from "./scheduler/daily-prompt";

async function main(): Promise<void> {
  // Connect to MongoDB
  await connectDatabase();

  // Create Express app
  const app = express();

  // Parse URL-encoded bodies (Slack sends payload as form data)
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  // Serve static files for admin UI
  app.use("/admin", express.static(path.join(__dirname, "../public")));

  // Mount routes
  app.use("/slack", slackRoutes);
  app.use("/users", usersRoutes);
  app.use("/admin", adminRoutes);

  // Root health check
  app.get("/", (_req, res) => {
    res.json({ service: "daily-bot", status: "running" });
  });

  // Start server
  const port = env.port;
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    
    // Print TOTP setup info with QR code
    const otpauth = authenticator.keyuri("admin", "DailyBot", env.adminTotpSecret);
    console.log("\n========== TOTP AUTHENTICATOR SETUP ==========");
    console.log("Scan this QR code with your authenticator app:\n");
    qrcode.generate(otpauth, { small: true });
    console.log(`\nSecret: ${env.adminTotpSecret}`);
    console.log("===============================================\n");
  });

  // Start scheduler
  startScheduler();
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

