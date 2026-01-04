import "dotenv/config";
import express from "express";
import path from "path";
import { authenticator } from "otplib";
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

  // Serve static files for admin UI (works in both dev and prod)
  const publicPath = path.join(__dirname, process.env.NODE_ENV === "production" ? "public" : "../public");
  app.use("/admin", express.static(publicPath));

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
    
    // Print TOTP setup info
    const otpauth = authenticator.keyuri("admin", "DailyBot", env.adminTotpSecret);
    console.log("\n========== TOTP AUTHENTICATOR SETUP ==========");
    console.log("Add this to your authenticator app:");
    console.log(`Secret: ${env.adminTotpSecret}`);
    console.log(`OTPAuth URL: ${otpauth}`);
    console.log("===============================================\n");
  });

  // Start scheduler
  startScheduler();
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

