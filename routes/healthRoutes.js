
import { Router } from "express";
import db from "../config/db.js";

const router = Router();

router.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Zafar Law Chamber API is running.",
    timestamp: new Date().toISOString(),
  });
});

router.get("/db", async (req, res) => {
  try {
    await db.query("SELECT 1");

    res.status(200).json({
      success: true,
      message: "Database connection successful.",
    });
  } catch (error) {
    console.error("Database health check failed:", error.message);

    res.status(503).json({
      success: false,
      message: "Database is currently unavailable.",
    });
  }
});

export default router;
