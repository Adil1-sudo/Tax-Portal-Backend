
import { Router } from "express";
import db from "../config/db.js";

const router = Router();

const defaultBusinessProfile = {
  businessName: "Zafar Law Chamber",
  email: "",
  phone: "",
  website: "",
  address: "",
  currency: "PKR",
  timezone: "Asia/Karachi",
};

router.get("/", async (req, res, next) => {
  try {
    const [rows] = await db.execute(
      `SELECT setting_value
       FROM admin_settings
       WHERE setting_key = ?`,
      ["business_profile"]
    );

    let savedProfile = {};

    if (rows.length && rows[0].setting_value) {
      try {
        savedProfile = JSON.parse(rows[0].setting_value);
      } catch {
        savedProfile = {};
      }
    }

    // Return only fields intended for public display.
    const settings = {
      businessName:
        savedProfile.businessName ||
        defaultBusinessProfile.businessName,
      email: savedProfile.email || "",
      phone: savedProfile.phone || "",
      website: savedProfile.website || "",
      address: savedProfile.address || "",
      currency:
        savedProfile.currency ||
        defaultBusinessProfile.currency,
      timezone:
        savedProfile.timezone ||
        defaultBusinessProfile.timezone,
    };

    res.json({ success: true, settings });
  } catch (error) {
    next(error);
  }
});

export default router;
