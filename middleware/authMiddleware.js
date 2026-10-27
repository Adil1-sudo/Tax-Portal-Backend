import jwt from "jsonwebtoken";
import db from "../config/db.js";

export async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Authentication is required.",
    });
  }

  if (!process.env.JWT_SECRET) {
    console.error("JWT_SECRET is not configured.");

    return res.status(500).json({
      success: false,
      message: "Authentication service is not configured.",
    });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (
      typeof payload === "string" ||
      !payload.sub ||
      !/^\d+$/.test(String(payload.sub))
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired authentication token.",
      });
    }

    // Read the user's current role and status from the database.
    // This prevents an old token from preserving a changed role.
    const [users] = await db.execute(
      `SELECT id, full_name, email, role, account_status
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [Number(payload.sub)]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: "The authenticated account could not be found.",
      });
    }

    const user = users[0];

    if (user.account_status !== "active") {
      return res.status(403).json({
        success: false,
        message: "This account is not currently active.",
      });
    }

    req.user = {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      role: user.role,
      accountStatus: user.account_status,
    };

    next();
  } catch (error) {
    if (
      error.name === "TokenExpiredError" ||
      error.name === "JsonWebTokenError" ||
      error.name === "NotBeforeError"
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired authentication token.",
      });
    }

    console.error("Authentication middleware failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to verify authentication.",
    });
  }
}

export function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to access this resource.",
      });
    }

    next();
  };
}