import { Router } from "express";
import db from "../config/db.js";
import path from "node:path";
import fs from "node:fs/promises";
import {
  uploadDocument,
  storageDirectory,
} from "../middleware/documentUpload.js";
import {
  authenticateToken,
  authorizeRoles,
} from "../middleware/authMiddleware.js";

const router = Router();

router.use(authenticateToken, authorizeRoles("client")) ;

function sendServerError(res, error, message) {
  console.error(message, error.message);

  return res.status(500).json({
    success: false,
    message,
  });
}

// GET /api/client/dashboard-summary
router.get("/dashboard-summary", async (req, res) => {
  try {
    const clientId = req.user.id;

    const [
      [documentRows],
      [requestRows],
      [feeRows],
    ] = await Promise.all([
      db.execute(
        `SELECT COUNT(*) AS totalDocuments
         FROM documents
         WHERE client_id = ?
           AND visibility = 'client_and_admin'`,
        [clientId]
      ),
      db.execute(
        `SELECT COUNT(*) AS pendingRequests
         FROM document_requests
         WHERE client_id = ?
           AND status = 'pending'`,
        [clientId]
      ),
      db.execute(
        `SELECT
           currency,
           SUM(amount) AS totalAmount,
           COUNT(*) AS feeCount
         FROM fee_requests
         WHERE client_id = ?
           AND status IN ('pending', 'overdue')
         GROUP BY currency
         ORDER BY currency`,
        [clientId]
      ),
    ]);

    return res.json({
      success: true,
      data: {
        totalDocuments: Number(documentRows[0].totalDocuments),
        pendingRequests: Number(requestRows[0].pendingRequests),
        outstandingFees: feeRows.map((row) => ({
          currency: row.currency,
          totalAmount: Number(row.totalAmount),
          feeCount: Number(row.feeCount),
        })),
      },
    });
  } catch (error) {
    return sendServerError(
      res,
      error,
      "Unable to load client dashboard summary."
    );
  }
});

// GET /api/client/profile
router.get("/profile", async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT
         u.id,
         u.full_name AS fullName,
         u.email,
         u.account_status AS accountStatus,
         cp.business_name AS businessName,
         cp.phone,
         cp.address,
         cp.country,
         cp.tax_reference AS taxReference
       FROM users u
       LEFT JOIN client_profiles cp ON cp.user_id = u.id
       WHERE u.id = ? AND u.role = 'client'
       LIMIT 1`,
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Client profile was not found.",
      });
    }

    return res.json({ success: true, data: rows[0] });
  } catch (error) {
    return sendServerError(res, error, "Unable to load client profile.");
  }
});

// PATCH /api/client/profile
router.patch("/profile", async (req, res) => {
  try {
    const {
      fullName,
      businessName = "",
      phone = "",
      address = "",
      country = "",
      taxReference = "",
    } = req.body;

    if (
      typeof fullName !== "string" ||
      !fullName.trim() ||
      fullName.trim().length > 150
    ) {
      return res.status(400).json({
        success: false,
        message: "Enter a name of 1–150 characters.",
      });
    }

    const fields = {
      businessName,
      phone,
      address,
      country,
      taxReference,
    };

    for (const [field, value] of Object.entries(fields)) {
      if (typeof value !== "string" || value.length > 255) {
        return res.status(400).json({
          success: false,
          message: `The ${field} field must be text with no more than 255 characters.`,
        });
      }
    }

    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      await connection.execute(
        `UPDATE users
         SET full_name = ?
         WHERE id = ? AND role = 'client'`,
        [fullName.trim(), req.user.id]
      );

      await connection.execute(
        `INSERT INTO client_profiles
           (user_id, business_name, phone, address, country, tax_reference)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           business_name = VALUES(business_name),
           phone = VALUES(phone),
           address = VALUES(address),
           country = VALUES(country),
           tax_reference = VALUES(tax_reference)`,
        [
          req.user.id,
          businessName.trim(),
          phone.trim(),
          address.trim(),
          country.trim(),
          taxReference.trim(),
        ]
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return res.json({
      success: true,
      message: "Profile updated successfully.",
    });
  } catch (error) {
    return sendServerError(res, error, "Unable to update client profile.");
  }
});

// GET /api/client/documents
router.get("/documents", async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT
         id,
         title,
         original_filename AS filename,
         mime_type AS mimeType,
         file_size AS fileSize,
         document_category AS category,
         source,
         created_at AS createdAt,
         request_id AS requestId
       FROM documents
       WHERE client_id = ?
         AND visibility = 'client_and_admin'
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    return res.json({ success: true, data: rows });
  } catch (error) {
    return sendServerError(res, error, "Unable to load client documents.");
  }
});

// GET /api/client/document-requests
router.get("/document-requests", async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT
         id,
         title,
         message,
         status,
         due_date AS dueDate,
         completed_at AS completedAt,
         created_at AS createdAt
       FROM document_requests
       WHERE client_id = ?
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    return res.json({ success: true, data: rows });
  } catch (error) {
    return sendServerError(
      res,
      error,
      "Unable to load document requests."
    );
  }
});

// POST /api/client/document-requests
router.post("/document-requests", async (req, res) => {
  try {
    const { title, message = "" } = req.body;

    if (
      typeof title !== "string" ||
      !title.trim() ||
      title.trim().length > 200
    ) {
      return res.status(400).json({
        success: false,
        message: "Enter a request title of up to 200 characters.",
      });
    }

    if (typeof message !== "string" || message.length > 3000) {
      return res.status(400).json({
        success: false,
        message: "The message must be 3000 characters or fewer.",
      });
    }

    const [result] = await db.execute(
      `INSERT INTO document_requests
         (client_id, requested_by, title, message, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [req.user.id, req.user.id, title.trim(), message.trim()]
    );

    return res.status(201).json({
      success: true,
      message: "Document request submitted successfully.",
      data: { id: result.insertId },
    });
  } catch (error) {
    return sendServerError(
      res,
      error,
      "Unable to submit document request."
    );
  }
});

// GET /api/client/fees
router.get("/fees", async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT
         id,
         title,
         description,
         amount,
         currency,
         due_date AS dueDate,
         status,
         paid_at AS paidAt,
         payment_reference AS paymentReference,
         created_at AS createdAt
       FROM fee_requests
       WHERE client_id = ?
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    return res.json({ success: true, data: rows });
  } catch (error) {
    return sendServerError(res, error, "Unable to load client fees.");
  }
});

// PATCH /api/client/fees/:id/payment-reference
// Submitting a reference does NOT mark the fee as paid.
router.patch("/fees/:id/payment-reference", async (req, res) => {
  try {
    const feeId = Number(req.params.id);
    const { paymentReference } = req.body;

    if (!Number.isSafeInteger(feeId) || feeId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid fee ID.",
      });
    }

    if (
      typeof paymentReference !== "string" ||
      !paymentReference.trim() ||
      paymentReference.trim().length > 255
    ) {
      return res.status(400).json({
        success: false,
        message: "Enter a payment reference of up to 255 characters.",
      });
    }

    const [result] = await db.execute(
      `UPDATE fee_requests
       SET payment_reference = ?
       WHERE id = ?
         AND client_id = ?
         AND status IN ('pending', 'overdue')`,
      [paymentReference.trim(), feeId, req.user.id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        success: false,
        message: "An outstanding fee with that ID was not found.",
      });
    }

    return res.json({
      success: true,
      message:
        "Payment reference submitted. Zafar Law Chamber consultant must verify the payment.",
    });
  } catch (error) {
    return sendServerError(
      res,
      error,
      "Unable to submit payment reference."
    );
  }
});

// GET /api/client/reports/summary
// A summary calculated from existing records, not a stored report file.
router.get("/reports/summary", async (req, res) => {
  try {
    const clientId = req.user.id;

    const [
      [documentRows],
      [requestRows],
      [feeRows],
    ] = await Promise.all([
      db.execute(
        `SELECT
           COUNT(*) AS totalDocuments,
           MAX(created_at) AS latestDocumentAt
         FROM documents
         WHERE client_id = ?
           AND visibility = 'client_and_admin'`,
        [clientId]
      ),
      db.execute(
        `SELECT
           COUNT(*) AS totalRequests,
           SUM(status = 'pending') AS pendingRequests,
           SUM(status = 'completed') AS completedRequests
         FROM document_requests
         WHERE client_id = ?`,
        [clientId]
      ),
      db.execute(
        `SELECT
           currency,
           SUM(CASE
             WHEN status IN ('pending', 'overdue') THEN amount
             ELSE 0
           END) AS outstandingAmount,
           SUM(CASE
             WHEN status = 'paid' THEN amount
             ELSE 0
           END) AS paidAmount
         FROM fee_requests
         WHERE client_id = ?
         GROUP BY currency
         ORDER BY currency`,
        [clientId]
      ),
    ]);

    return res.json({
      success: true,
      data: {
        documents: {
          total: Number(documentRows[0].totalDocuments),
          latestAt: documentRows[0].latestDocumentAt,
        },
        requests: {
          total: Number(requestRows[0].totalRequests || 0),
          pending: Number(requestRows[0].pendingRequests || 0),
          completed: Number(requestRows[0].completedRequests || 0),
        },
        fees: feeRows.map((row) => ({
          currency: row.currency,
          outstandingAmount: Number(row.outstandingAmount || 0),
          paidAmount: Number(row.paidAmount || 0),
        })),
      },
    });
  } catch (error) {
    return sendServerError(res, error, "Unable to generate client report.");
  }
});

const allowedDocumentCategories = new Set([
  "Tax",
  "Financial",
  "Business",
  "Identity",
  "Other",
]);

// POST /api/client/documents/upload
router.post("/documents/upload", uploadDocument, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "Choose a file to upload.",
    });
  }

  const uploadedFilePath = req.file.path;
  let connection;

  try {
    const title =
      typeof req.body.title === "string"
        ? req.body.title.trim()
        : "";

    const category =
      typeof req.body.category === "string"
        ? req.body.category.trim()
        : "Other";

    const requestId =
      req.body.requestId === undefined ||
      req.body.requestId === ""
        ? null
        : Number(req.body.requestId);

    if (!title || title.length > 150) {
      await fs.unlink(uploadedFilePath).catch(() => {});

      return res.status(400).json({
        success: false,
        message: "Enter a document title of up to 150 characters.",
      });
    }

    if (!allowedDocumentCategories.has(category)) {
      await fs.unlink(uploadedFilePath).catch(() => {});

      return res.status(400).json({
        success: false,
        message: "Select a valid document category.",
      });
    }

    if (
      requestId !== null &&
      (!Number.isSafeInteger(requestId) || requestId <= 0)
    ) {
      await fs.unlink(uploadedFilePath).catch(() => {});

      return res.status(400).json({
        success: false,
        message: "Invalid document request.",
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    // A client can only attach a file to their own pending request.
    if (requestId !== null) {
      const [requests] = await connection.execute(
        `SELECT id
         FROM document_requests
         WHERE id = ?
           AND client_id = ?
           AND status = 'pending'
         LIMIT 1
         FOR UPDATE`,
        [requestId, req.user.id]
      );

      if (requests.length === 0) {
        await connection.rollback();
        await fs.unlink(uploadedFilePath).catch(() => {});

        return res.status(404).json({
          success: false,
          message: "The pending document request was not found.",
        });
      }
    }

    const originalFilename = path
      .basename(req.file.originalname)
      .slice(0, 255);

    const [result] = await connection.execute(
      `INSERT INTO documents (
        client_id,
        uploaded_by,
        request_id,
        title,
        original_filename,
        stored_filename,
        storage_path,
        mime_type,
        file_size,
        document_category,
        source,
        visibility
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'client_upload', 'client_and_admin')`,
      [
        req.user.id,
        req.user.id,
        requestId,
        title,
        originalFilename,
        req.file.filename,
        uploadedFilePath,
        req.file.mimetype,
        req.file.size,
        category,
      ]
    );

    if (requestId !== null) {
      await connection.execute(
        `UPDATE document_requests
         SET status = 'submitted'
         WHERE id = ?
           AND client_id = ?
           AND status = 'pending'`,
        [requestId, req.user.id]
      );
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: "Document uploaded successfully.",
      data: {
        id: result.insertId,
        title,
        filename: originalFilename,
        category,
        source: "client_upload",
        fileSize: req.file.size,
        requestId,
      },
    });
  } catch (error) {
    if (connection) {
      await connection.rollback().catch(() => {});
    }

    // Remove the saved file if its database record was not committed.
    await fs.unlink(uploadedFilePath).catch(() => {});

    console.error("Client document upload failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to save the uploaded document.",
    });
  } finally {
    connection?.release();
  }
});

// GET /api/client/documents/:id/download
router.get("/documents/:id/download", async (req, res) => {
  const documentId = Number(req.params.id);

  if (!Number.isSafeInteger(documentId) || documentId < 1) {
    return res.status(400).json({
      success: false,
      message: "Invalid document ID.",
    });
  }

  try {
    const [documents] = await db.execute(
      `SELECT stored_filename, original_filename
       FROM documents
       WHERE id = ?
         AND client_id = ?
         AND visibility = 'client_and_admin'
       LIMIT 1`,
      [documentId, req.user.id]
    );

    if (documents.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Document not found or unavailable.",
      });
    }

    const document = documents[0];

    // Use only the stored filename, never a client-supplied path.
    const diskName = path.basename(document.stored_filename);
    const filePath = path.join(storageDirectory, diskName);

    await fs.access(filePath);

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");

    return res.download(
      filePath,
      path.basename(document.original_filename || "document")
        .replace(/[\r\n"]/g, "_"),
      (error) => {
        if (error && !res.headersSent) {
          console.error("Client document download failed:", error.message);

          res.status(500).json({
            success: false,
            message: "Unable to download the document.",
          });
        }
      }
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      return res.status(404).json({
        success: false,
        message: "The stored file is unavailable.",
      });
    }

    console.error("Client document download failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to download the document.",
    });
  }
});


export default router;
