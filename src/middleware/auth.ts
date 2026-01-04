import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { authenticator } from "otplib";
import { env } from "../config/env";
import { logger } from "../config/logger";

interface JWTPayload {
  admin: boolean;
  iat: number;
  exp: number;
}

declare global {
  namespace Express {
    interface Request {
      admin?: boolean;
    }
  }
}

export function verifyJWT(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") 
    ? authHeader.slice(7) 
    : (req.headers["x-admin-key"] as string) || (req.query.key as string);

  if (!token) {
    logger.debug("Auth failed: no token provided");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const decoded = jwt.verify(token, env.jwtSecret) as JWTPayload;
    req.admin = decoded.admin;
    next();
  } catch (error) {
    logger.debug({ error }, "Auth failed: invalid token");
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function generateToken(): string {
  const options: jwt.SignOptions = {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"],
  };
  return jwt.sign({ admin: true }, env.jwtSecret, options);
}

export function verifyTOTP(code: string): boolean {
  return authenticator.verify({
    token: code,
    secret: env.adminTotpSecret,
  });
}

