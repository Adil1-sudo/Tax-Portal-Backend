
import { Router } from "express";
import db from "../config/db.js";
import {
  authenticateToken,
  authorizeRoles,
} from "../middleware/authMiddleware.js";

const router = Router();

router.use(authenticateToken, authorizeRoles("admin"));

const defaults = {
  business_profile: {
    businessName: "Zafar Law Chamber",
    contactName: "",
    email: "",
    phone: "",
    website: "",
    address: "",
    currency: "PKR",
    timezone: "Asia/Karachi",
  },
  notification_preferences: {
    newClient: true,
    clientDocuments: true,
    feeRequests: true,
    overduePayments: true,
    productUpdates: false,
  },
  display_preferences: {
    dateFormat: "DD MMM YYYY",
    rowsPerPage: "10",
    compactTables: false,
    confirmActions: true,
  },
};

function parseSetting(value, fallback) {
  if (value == null) return fallback;

  try {
    return typeof value === "string"
      ? JSON.parse(value)
      : value;
  } catch {
    return fallback;
  }
}

function validateSetting(key, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "Invalid settings data.";
  }

  if (key === "business_profile") {
    const allowed = Object.keys(defaults.business_profile);

    if (Object.keys(value).some((field) => !allowed.includes(field))) {
      return "Unexpected business profile field.";
    }

    if (
      typeof value.businessName !== "string" ||
      !value.businessName.trim() ||
      typeof value.contactName !== "string" ||
      !value.contactName.trim() ||
      typeof value.email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim())
    ) {
      return "Enter a business name, contact name, and valid email.";
    }

    if (!["PKR", "USD", "GBP", "AED"].includes(value.currency)) {
      return "Unsupported currency.";
    }

    if (
      typeof value.timezone !== "string" ||
      value.timezone.length > 100
    ) {
      return "Invalid timezone.";
    }
  }

  if (key === "notification_preferences") {
    for (const field of Object.keys(defaults.notification_preferences)) {
      if (typeof value[field] !== "boolean") {
        return `Invalid notification preference: ${field}.`;
      }
    }
  }

  if (key === "display_preferences") {
    if (!["DD MMM YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].includes(value.dateFormat)) {
      return "Unsupported date format.";
    }

    if (!["10", "25", "50"].includes(String(value.rowsPerPage))) {
      return "Rows per page must be 10, 25, or 50.";
    }

    if (
      typeof value.compactTables !== "boolean" ||
      typeof value.confirmActions !== "boolean"
    ) {
      return "Invalid display preferences.";
    }
  }

  return null;
}

router.get("/", async (req, res, next) => {
  try {
    const [rows] = await db.execute(
      `SELECT setting_key, setting_value
       FROM admin_settings
       WHERE setting_key IN (?, ?, ?)`,
      Object.keys(defaults)
    );

    const settings = { ...defaults };

    for (const row of rows) {
      if (Object.hasOwn(defaults, row.setting_key)) {
        settings[row.setting_key] = {
          ...defaults[row.setting_key],
          ...parseSetting(row.setting_value, {}),
        };
      }
    }

    res.json({
      success: true,
      settings,
    });
  } catch (error) {
    next(error);
  }
});

router.put("/:key", async (req, res, next) => {
  try {
    const { key } = req.params;

    if (!Object.hasOwn(defaults, key)) {
      return res.status(400).json({
        success: false,
        message: "Unknown settings group.",
      });
    }

    const value = req.body?.value;
    const validationError = validateSetting(key, value);

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    const mergedValue = {
      ...defaults[key],
      ...value,
    };

    const [result] = await db.execute(
      `INSERT INTO admin_settings
         (setting_key, setting_value, updated_by)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         setting_value = VALUES(setting_value),
         updated_by = VALUES(updated_by),
         updated_at = CURRENT_TIMESTAMP`,
      [key, JSON.stringify(mergedValue), req.user.id]
    );

    res.json({
      success: true,
      message: "Settings saved successfully.",
      setting: {
        key,
        value: mergedValue,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
