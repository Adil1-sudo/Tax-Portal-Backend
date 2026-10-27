import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import db from "../config/db.js";
import { authenticateToken } from "../middleware/authMiddleware.js";

const router = Router();

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function createAccessToken(user) {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured.");
  }

  return jwt.sign(
    { role: user.role },
    process.env.JWT_SECRET,
    {
      subject: String(user.id),
      expiresIn: process.env.JWT_EXPIRES_IN || "1h",
    }
  );
}

// POST /api/auth/register
router.post("/register", async (req, res) => {
  const { fullName, email, password } = req.body ?? {};

  if (
    typeof fullName !== "string" ||
    typeof email !== "string" ||
    typeof password !== "string"
  ) {
    return res.status(400).json({
      success: false,
      message: "Name, email, and password are required.",
    });
  }

  const cleanName = fullName.trim();
  const cleanEmail = email.trim().toLowerCase();

  if (cleanName.length < 2 || cleanName.length > 120) {
    return res.status(400).json({
      success: false,
      message: "Name must be between 2 and 120 characters.",
    });
  }

  if (cleanEmail.length > 254 || !isValidEmail(cleanEmail)) {
    return res.status(400).json({
      success: false,
      message: "Please provide a valid email address.",
    });
  }

  if (
    password.length < 8 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 8 characters and no more than 72 UTF-8 bytes.",
    });
  }

  let connection;

  try {
    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is not configured.");
    }

    const passwordHash = await bcrypt.hash(password, 12);

    connection = await db.getConnection();
    await connection.beginTransaction();

    // Public registration always creates a client with pending status.
    // Never accept role or account_status from the request body.
    const [result] = await connection.execute(
      `INSERT INTO users
        (full_name, email, password_hash, role, account_status)
       VALUES (?, ?, ?, 'client', 'pending')`,
      [cleanName, cleanEmail, passwordHash]
    );

    await connection.execute(
      `INSERT INTO client_profiles (user_id)
       VALUES (?)`,
      [result.insertId]
    );

    await connection.commit();

    return res.status(201).json({
      success: true,
      message:
        "Registration submitted. Your account is pending administrator approval.",
      user: {
        id: result.insertId,
        fullName: cleanName,
        email: cleanEmail,
        role: "client",
        accountStatus: "pending",
      },
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Registration rollback failed:", rollbackError.message);
      }
    }

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "An account with this email address already exists.",
      });
    }

    console.error("Registration failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to complete registration right now.",
    });
  } finally {
    connection?.release();
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    !email.trim() ||
    !password
  ) {
    return res.status(400).json({
      success: false,
      message: "Email and password are required.",
    });
  }

  try {
    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is not configured.");
    }

    const cleanEmail = email.trim().toLowerCase();

    const [users] = await db.execute(
      `SELECT id, full_name, email, password_hash, role, account_status
       FROM users
       WHERE email = ?
       LIMIT 1`,
      [cleanEmail]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const user = users[0];
    const passwordMatches = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    if (user.account_status !== "active") {
      const message =
        user.account_status === "pending"
          ? "Your account is awaiting administrator approval."
          : "Your account is not active. Please contact the administrator.";

      return res.status(403).json({
        success: false,
        message,
      });
    }

    await db.execute(
      "UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?",
      [user.id]
    );

    const token = createAccessToken(user);

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      token,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        accountStatus: user.account_status,
      },
    });
  } catch (error) {
    console.error("Login failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to complete login right now.",
    });
  }
});

// GET /api/auth/me
router.get("/me", authenticateToken, (req, res) => {
  return res.status(200).json({
    success: true,
    user: req.user,
  });
});

export default router;