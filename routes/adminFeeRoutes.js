
import { Router } from "express";
import db from "../config/db.js";
import {
  authenticateToken,
  authorizeRoles,
} from "../middleware/authMiddleware.js";

const router = Router();

router.use(authenticateToken, authorizeRoles("admin"));

const allowedStatuses = ["pending", "paid", "overdue", "cancelled"];

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function feeSelectSql() {
  return `
    SELECT
      f.id,
      f.client_id AS clientId,
      f.created_by AS createdBy,
      f.title,
      f.description,
      f.amount,
      f.currency,
      f.due_date AS dueDate,
      CASE
        WHEN f.status = 'pending'
          AND f.due_date < CURRENT_DATE()
        THEN 'overdue'
        ELSE f.status
      END AS status,
      f.paid_at AS paidAt,
      f.payment_reference AS paymentReference,
      f.internal_notes AS internalNotes,
      f.created_at AS createdAt,
      f.updated_at AS updatedAt,
      u.full_name AS clientName,
      u.email AS clientEmail
    FROM fee_requests f
    INNER JOIN users u ON u.id = f.client_id
  `;
}

// GET /api/admin/fees
// Supports: page, limit, clientId, status, search
router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 10)
    );

    const offset = (page - 1) * limit;
    const { clientId, status, search } = req.query;

    const conditions = [];
    const params = [];

    if (clientId !== undefined && clientId !== "") {
      const parsedClientId = Number(clientId);

      if (!Number.isInteger(parsedClientId) || parsedClientId < 1) {
        return res.status(400).json({
          success: false,
          message: "clientId must be a positive integer.",
        });
      }

      conditions.push("f.client_id = ?");
      params.push(parsedClientId);
    }

    if (status) {
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid fee status filter.",
        });
      }

      if (status === "overdue") {
        conditions.push(
          "((f.status = 'pending' AND f.due_date < CURRENT_DATE()) OR f.status = 'overdue')"
        );
      } else if (status === "pending") {
        conditions.push(
          "f.status = 'pending' AND (f.due_date IS NULL OR f.due_date >= CURRENT_DATE())"
        );
      } else {
        conditions.push("f.status = ?");
        params.push(status);
      }
    }

    if (search) {
      const searchTerm = String(search).trim().slice(0, 100);

      if (searchTerm) {
        conditions.push(
          "(f.title LIKE ? OR u.full_name LIKE ? OR u.email LIKE ?)"
        );

        const pattern = `%${searchTerm}%`;
        params.push(pattern, pattern, pattern);
      }
    }

    const whereSql = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total
       FROM fee_requests f
       INNER JOIN users u ON u.id = f.client_id
       ${whereSql}`,
      params
    );

    const [fees] = await db.query(
      `${feeSelectSql()}
       ${whereSql}
       ORDER BY f.created_at DESC, f.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return res.status(200).json({
      success: true,
      data: fees,
      pagination: {
        page,
        limit,
        total: countRows[0].total,
        totalPages: Math.ceil(countRows[0].total / limit),
      },
    });
  } catch (error) {
    console.error("Admin fee list failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve fee requests.",
    });
  }
});

// GET /api/admin/fees/:id
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({
      success: false,
      message: "Invalid fee request ID.",
    });
  }

  try {
    const [fees] = await db.query(
      `${feeSelectSql()} WHERE f.id = ? LIMIT 1`,
      [id]
    );

    if (fees.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Fee request not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: fees[0],
    });
  } catch (error) {
    console.error("Admin fee detail failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve this fee request.",
    });
  }
});

// POST /api/admin/fees
router.post("/", async (req, res) => {
  const {
    clientId,
    title,
    description = "",
    amount,
    currency = "PKR",
    dueDate = null,
    internalNotes = "",
  } = req.body;

  const parsedClientId = Number(clientId);
  const amountText = String(amount ?? "").trim();
  const parsedAmount = Number(amountText);
  const currencyCode = String(currency).trim().toUpperCase();

  if (
    !Number.isInteger(parsedClientId) ||
    parsedClientId < 1
  ) {
    return res.status(400).json({
      success: false,
      message: "A valid clientId is required.",
    });
  }

  if (
    typeof title !== "string" ||
    !title.trim() ||
    title.trim().length > 150
  ) {
    return res.status(400).json({
      success: false,
      message: "Title is required and must be 150 characters or fewer.",
    });
  }

  if (
    !/^\d{1,10}(\.\d{1,2})?$/.test(amountText) ||
    !Number.isFinite(parsedAmount) ||
    parsedAmount <= 0 ||
    parsedAmount > 9999999999.99
  ) {
    return res.status(400).json({
      success: false,
      message: "Amount must be positive and have no more than two decimal places.",
    });
  }

  if (!/^[A-Z]{3}$/.test(currencyCode)) {
    return res.status(400).json({
      success: false,
      message: "Currency must be a three-letter currency code, such as PKR.",
    });
  }

  if (
    typeof description !== "string" ||
    description.length > 2000
  ) {
    return res.status(400).json({
      success: false,
      message: "Description must be 2000 characters or fewer.",
    });
  }

  if (
    dueDate !== null &&
    dueDate !== "" &&
    !isValidDate(dueDate)
  ) {
    return res.status(400).json({
      success: false,
      message: "Due date must be a valid date in YYYY-MM-DD format.",
    });
  }

  if (
    typeof internalNotes !== "string" ||
    internalNotes.length > 2000
  ) {
    return res.status(400).json({
      success: false,
      message: "Internal notes must be 2000 characters or fewer.",
    });
  }

  try {
    const [clients] = await db.query(
      `SELECT id
       FROM users
       WHERE id = ?
         AND role = 'client'
         AND account_status = 'active'
       LIMIT 1`,
      [parsedClientId]
    );

    if (clients.length === 0) {
      return res.status(404).json({
        success: false,
        message: "An active client account with that ID was not found.",
      });
    }

    const [result] = await db.query(
      `INSERT INTO fee_requests
        (
          client_id,
          created_by,
          title,
          description,
          amount,
          currency,
          due_date,
          status,
          internal_notes
        )
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        parsedClientId,
        req.user.id,
        title.trim(),
        description.trim(),
        parsedAmount.toFixed(2),
        currencyCode,
        dueDate || null,
        internalNotes.trim(),
      ]
    );

    const [createdFees] = await db.query(
      `${feeSelectSql()} WHERE f.id = ? LIMIT 1`,
      [result.insertId]
    );

    return res.status(201).json({
      success: true,
      message: "Fee request created successfully.",
      data: createdFees[0],
    });
  } catch (error) {
    console.error("Admin fee creation failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to create the fee request.",
    });
  }
});

// PATCH /api/admin/fees/:id/status
// Allowed updates: paid or cancelled
router.patch("/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  const { status, paymentReference = "" } = req.body;

  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({
      success: false,
      message: "Invalid fee request ID.",
    });
  }

  if (!["paid", "cancelled"].includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Status must be paid or cancelled.",
    });
  }

  if (
    typeof paymentReference !== "string" ||
    paymentReference.length > 150
  ) {
    return res.status(400).json({
      success: false,
      message: "Payment reference must be 150 characters or fewer.",
    });
  }

  if (status === "cancelled" && paymentReference.trim()) {
    return res.status(400).json({
      success: false,
      message: "A payment reference can only be supplied when marking a fee as paid.",
    });
  }

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [fees] = await connection.query(
      `SELECT id, status
       FROM fee_requests
       WHERE id = ?
       FOR UPDATE`,
      [id]
    );

    if (fees.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Fee request not found.",
      });
    }

    if (!["pending", "overdue"].includes(fees[0].status)) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "Only pending or overdue fees can be updated.",
      });
    }

    await connection.query(
      `UPDATE fee_requests
       SET status = ?,
           paid_at = ?,
           payment_reference = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        status,
        status === "paid" ? new Date() : null,
        status === "paid" ? paymentReference.trim() || null : null,
        id,
      ]
    );

    await connection.commit();

    const [updatedFees] = await db.query(
      `${feeSelectSql()} WHERE f.id = ? LIMIT 1`,
      [id]
    );

    return res.status(200).json({
      success: true,
      message:
        status === "paid"
          ? "Fee marked as paid."
          : "Fee request cancelled.",
      data: updatedFees[0],
    });
  } catch (error) {
    await connection.rollback();

    console.error("Admin fee status update failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to update the fee status.",
    });
  } finally {
    connection.release();
  }
});

export default router;
