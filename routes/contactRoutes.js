import { Router } from "express";
import db from "../config/db.js";

const router = Router();

router.post("/", async (req, res) => {
  const { name, email, phone = "", subject, message } = req.body;

  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.trim().length > 120
  ) {
    return res.status(400).json({
      success: false,
      message: "Enter your name using no more than 120 characters.",
    });
  }

  if (
    typeof email !== "string" ||
    email.trim().length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  ) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid email address.",
    });
  }

  if (
    typeof phone !== "string" ||
    phone.trim().length > 30
  ) {
    return res.status(400).json({
      success: false,
      message: "Phone number must be 30 characters or fewer.",
    });
  }

  if (
    typeof subject !== "string" ||
    !subject.trim() ||
    subject.trim().length > 180
  ) {
    return res.status(400).json({
      success: false,
      message: "Enter a subject using no more than 180 characters.",
    });
  }

  if (
    typeof message !== "string" ||
    !message.trim() ||
    message.trim().length > 5000
  ) {
    return res.status(400).json({
      success: false,
      message: "Enter a message of up to 5000 characters.",
    });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO contact_enquiries
        (name, email, phone, subject, message)
       VALUES (?, ?, ?, ?, ?)`,
      [
        name.trim(),
        email.trim().toLowerCase(),
        phone.trim() || null,
        subject.trim(),
        message.trim(),
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Your enquiry has been submitted successfully.",
      data: {
        id: result.insertId,
      },
    });
  } catch (error) {
    console.error("Contact enquiry submission failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "We could not submit your enquiry. Please try again later.",
    });
  }
});

export default router;
