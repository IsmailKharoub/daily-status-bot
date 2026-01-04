import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { env } from "../config/env";
import { logger } from "../config/logger";

// Extend Request to include rawBody
declare global {
  namespace Express {
    interface Request {
      rawBody?: string;
    }
  }
}

export function captureRawBody(req: Request, _res: Response, buf: Buffer): void {
  req.rawBody = buf.toString();
}

export function verifySlackRequest(req: Request, res: Response, next: NextFunction): void {
  const timestamp = req.headers["x-slack-request-timestamp"] as string;
  const signature = req.headers["x-slack-signature"] as string;

  if (!timestamp || !signature) {
    logger.warn("Slack verification failed: missing headers");
    res.status(401).send("Missing Slack headers");
    return;
  }

  // Prevent replay attacks (5 minute window)
  const requestTime = Number(timestamp);
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - requestTime) > 300) {
    logger.warn({ timestamp, currentTime }, "Slack verification failed: request too old");
    res.status(401).send("Request too old");
    return;
  }

  const rawBody = req.rawBody || "";
  const sigBasestring = `v0:${timestamp}:${rawBody}`;
  const mySignature = "v0=" + crypto
    .createHmac("sha256", env.slackSigningSecret)
    .update(sigBasestring)
    .digest("hex");

  try {
    if (!crypto.timingSafeEqual(Buffer.from(mySignature), Buffer.from(signature))) {
      logger.warn("Slack verification failed: signature mismatch");
      res.status(401).send("Invalid signature");
      return;
    }
  } catch {
    logger.warn("Slack verification failed: signature comparison error");
    res.status(401).send("Invalid signature");
    return;
  }

  next();
}

