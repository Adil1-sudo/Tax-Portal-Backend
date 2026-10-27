
import { Router } from "express";
import db from "../config/db.js";
import {
  authenticateToken,
  authorizeRoles,
} from "../middleware/authMiddleware.js";

const router = Router();

router.use(authenticateToken, authorizeRoles("admin"));

const validStatuses = ["new", "in_progress", "resolved", "spam"];

// GET /api/admin/enquiries?page=1&limit=10&status=new&search=
router.get("/", async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(req.query.limit, 10) || 10)
  );
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];

  if (req.query.status) {
    if (!validStatuses.includes(req.query.status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid enquiry status filter.",
      });
    }

    conditions.push("status = ?");
    params.push(req.query.status);
  }

  if (req.query.search) {
    const search = String(req.query.search).trim().slice(0, 100);

    if (search) {
      conditions.push(
        "(name LIKE ? OR email LIKE ? OR subject LIKE ?)"
      );
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern);
    }
  }

  const whereSql = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  try {
    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total
       FROM contact_enquiries
       ${whereSql}`,
      params
    );

    const [enquiries] = await db.query(
      `SELECT
         id, name, email, phone, subject, message,
         status, admin_notes AS adminNotes,
         handled_by AS handledBy,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM contact_enquiries
       ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return res.json({
      success: true,
      data: enquiries,
      pagination: {
        page,
        limit,
        total: countRows[0].total,
        totalPages: Math.ceil(countRows[0].total / limit),
      },
    });
  } catch (error) {
    console.error("Admin enquiry list failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve enquiries.",
    });
  }
});

// GET /api/admin/enquiries/:id
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({
      success: false,
      message: "Invalid enquiry ID.",
    });
  }

  try {
    const [rows] = await db.query(
      `SELECT
         id, name, email, phone, subject, message,
         status, admin_notes AS adminNotes,
         handled_by AS handledBy,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM contact_enquiries
       WHERE id = ?
       LIMIT 1`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Enquiry not found.",
      });
    }

    return res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error("Admin enquiry detail failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve this enquiry.",
    });
  }
});

// PATCH /api/admin/enquiries/:id
// Body: { status, adminNotes }
router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { status, adminNotes } = req.body;

  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({
      success: false,
      message: "Invalid enquiry ID.",
    });
  }

  if (
    status === undefined &&
    adminNotes === undefined
  ) {
    return res.status(400).json({
      success: false,
      message: "Provide a status or adminNotes field to update.",
    });
  }

  if (
    status !== undefined &&
    !validStatuses.includes(status)
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid enquiry status.",
    });
  }

  if (
    adminNotes !== undefined &&
    (typeof adminNotes !== "string" || adminNotes.length > 5000)
  ) {
    return res.status(400).json({
      success: false,
      message: "Admin notes must be a string of 5000 characters or fewer.",
    });
  }

  const updates = [];
  const values = [];

  if (status !== undefined) {
    updates.push("status = ?");
    values.push(status);
  }

  if (adminNotes !== undefined) {
    updates.push("admin_notes = ?");
    values.push(adminNotes.trim() || null);
  }

  updates.push("handled_by = ?");
  values.push(req.user.id, id);

  try {
    const [result] = await db.query(
      `UPDATE contact_enquiries
       SET ${updates.join(", ")}
       WHERE id = ?`,
      values
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        success: false,
        message: "Enquiry not found.",
      });
    }

    const [rows] = await db.query(
      `SELECT
         id, name, email, phone, subject, message,
         status, admin_notes AS adminNotes,
         handled_by AS handledBy,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM contact_enquiries
       WHERE id = ?
       LIMIT 1`,
      [id]
    );

    return res.json({
      success: true,
      message: "Enquiry updated successfully.",
      data: rows[0],
    });
  } catch (error) {
    console.error("Admin enquiry update failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to update this enquiry.",
    });
  }
});

export default router;
