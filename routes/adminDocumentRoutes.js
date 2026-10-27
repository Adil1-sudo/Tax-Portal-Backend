import { Router } from "express";
import path from "node:path";
import fs from "node:fs/promises";
import db from "../config/db.js";
import {
  authenticateToken,
  authorizeRoles,
} from "../middleware/authMiddleware.js";
import {
  uploadDocument,
  storageDirectory,
} from "../middleware/documentUpload.js";

const router = Router();

router.use(authenticateToken, authorizeRoles("admin"));

const allowedCategories = [
  "Tax document",
  "Identity document",
  "Bank statement",
  "Business record",
  "Receipt or invoice",
  "Other",
];

function parsePositiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function safeDownloadName(filename) {
  return path
    .basename(filename || "document")
    .replace(/[\r\n"]/g, "_");
}

// GET /api/admin/documents?clientId=1
router.get("/", async (req, res) => {
  const clientId = req.query.clientId
    ? parsePositiveId(req.query.clientId)
    : null;

  if (req.query.clientId && !clientId) {
    return res.status(400).json({
      success: false,
      message: "Invalid client ID.",
    });
  }

  try {
    const params = [];
    let whereClause = "";

    if (clientId) {
      whereClause = "WHERE d.client_id = ?";
      params.push(clientId);
    }

    const [documents] = await db.execute(
      `SELECT
         d.id,
         d.client_id AS clientId,
         client.full_name AS clientName,
         d.title,
         d.original_filename AS originalFilename,
         d.mime_type AS mimeType,
         d.file_size AS fileSize,
         d.document_category AS category,
         d.source,
         d.visibility,
         d.request_id AS requestId,
         uploader.full_name AS uploadedBy,
         d.created_at AS createdAt
       FROM documents d
       INNER JOIN users client ON client.id = d.client_id
       INNER JOIN users uploader ON uploader.id = d.uploaded_by
       ${whereClause}
       ORDER BY d.created_at DESC
       LIMIT 200`,
      params
    );

    return res.status(200).json({
      success: true,
      data: documents,
    });
  } catch (error) {
    console.error("Document listing failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve documents.",
    });
  }
});

// POST /api/admin/documents
// multipart/form-data: clientId, title, category, visibility, document
router.post("/", uploadDocument, async (req, res) => {
  const clientId = parsePositiveId(req.body?.clientId);
  const title =
    typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const category = req.body?.category || "other";
  const visibility = req.body?.visibility || "client_and_admin";

  if (!clientId || title.length < 1 || title.length > 180) {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});

    return res.status(400).json({
      success: false,
      message: "A valid client ID and document title are required.",
    });
  }

  if (!allowedCategories.includes(category)) {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});

    return res.status(400).json({
      success: false,
      message: "Invalid document category.",
    });
  }

  if (!["client_and_admin", "admin_only"].includes(visibility)) {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});

    return res.status(400).json({
      success: false,
      message: "Invalid document visibility.",
    });
  }

  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "Please select a document to upload.",
    });
  }

  try {
    const [clients] = await db.execute(
      "SELECT id FROM users WHERE id = ? AND role = 'client' LIMIT 1",
      [clientId]
    );

    if (clients.length === 0) {
      await fs.unlink(req.file.path).catch(() => {});

      return res.status(404).json({
        success: false,
        message: "Client account not found.",
      });
    }

    const [result] = await db.execute(
      `INSERT INTO documents
        (
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
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'admin_upload', ?)`,
      [
        clientId,
        req.user.id,
        title,
        path.basename(req.file.originalname),
        req.file.filename,
        req.file.filename,
        req.file.mimetype,
        req.file.size,
        category,
        visibility,
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Document uploaded successfully.",
      data: {
        id: result.insertId,
        clientId,
        title,
        originalFilename: path.basename(req.file.originalname),
        category,
        visibility,
      },
    });
  } catch (error) {
    await fs.unlink(req.file.path).catch(() => {});

    console.error("Document upload failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to save the uploaded document.",
    });
  }
});

// GET /api/admin/documents/:id/download
router.get("/:id/download", async (req, res) => {
  const documentId = parsePositiveId(req.params.id);

  if (!documentId) {
    return res.status(400).json({
      success: false,
      message: "Invalid document ID.",
    });
  }

  try {
    const [documents] = await db.execute(
      `SELECT stored_filename, original_filename, mime_type
       FROM documents
       WHERE id = ?
       LIMIT 1`,
      [documentId]
    );

    if (documents.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Document not found.",
      });
    }

    const document = documents[0];
    const diskName = path.basename(document.stored_filename);
    const filePath = path.join(storageDirectory, diskName);

    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({
        success: false,
        message: "The stored file is unavailable.",
      });
    }

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");

    return res.download(
      filePath,
      safeDownloadName(document.original_filename),
      (error) => {
        if (error && !res.headersSent) {
          console.error("Document download failed:", error.message);
          res.status(500).json({
            success: false,
            message: "Unable to download the document.",
          });
        }
      }
    );
  } catch (error) {
    console.error("Document download lookup failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve the document.",
    });
  }
});

// GET /api/admin/document-requests?clientId=1
router.get("/requests", async (req, res) => {
  const clientId = req.query.clientId
    ? parsePositiveId(req.query.clientId)
    : null;

  if (req.query.clientId && !clientId) {
    return res.status(400).json({
      success: false,
      message: "Invalid client ID.",
    });
  }

  try {
    const params = [];
    let whereClause = "";

    if (clientId) {
      whereClause = "WHERE r.client_id = ?";
      params.push(clientId);
    }

    const [requests] = await db.execute(
      `SELECT
         r.id,
         r.client_id AS clientId,
         client.full_name AS clientName,
         r.title,
         r.message,
         r.status,
         r.due_date AS dueDate,
         r.created_at AS createdAt,
         r.completed_at AS completedAt,
         requester.full_name AS requestedBy
       FROM document_requests r
       INNER JOIN users client ON client.id = r.client_id
       INNER JOIN users requester ON requester.id = r.requested_by
       ${whereClause}
       ORDER BY r.created_at DESC
       LIMIT 200`,
      params
    );

    return res.status(200).json({
      success: true,
      data: requests,
    });
  } catch (error) {
    console.error("Document request listing failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve document requests.",
    });
  }
});

// POST /api/admin/document-requests
router.post("/requests", async (req, res) => {
  const clientId = parsePositiveId(req.body?.clientId);
  const title =
    typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const message =
    typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const dueDate = req.body?.dueDate || null;

  if (!clientId || title.length < 1 || title.length > 180) {
    return res.status(400).json({
      success: false,
      message: "A valid client ID and request title are required.",
    });
  }

  if (message.length > 5000) {
    return res.status(400).json({
      success: false,
      message: "The request message cannot exceed 5000 characters.",
    });
  }

  if (
    dueDate !== null &&
    (typeof dueDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) ||
      !Number.isFinite(Date.parse(`${dueDate}T00:00:00Z`)) ||
      new Date(`${dueDate}T00:00:00Z`).toISOString().slice(0, 10) !== dueDate)
  ) {
    return res.status(400).json({
      success: false,
      message: "Due date must be a valid date in YYYY-MM-DD format.",
    });
  }

  try {
    const [clients] = await db.execute(
      "SELECT id FROM users WHERE id = ? AND role = 'client' LIMIT 1",
      [clientId]
    );

    if (clients.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Client account not found.",
      });
    }

    const [result] = await db.execute(
      `INSERT INTO document_requests
        (client_id, requested_by, title, message, status, due_date)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
      [clientId, req.user.id, title, message || null, dueDate]
    );

    return res.status(201).json({
      success: true,
      message: "Document request created successfully.",
      data: {
        id: result.insertId,
        clientId,
        title,
        message,
        status: "pending",
        dueDate,
      },
    });
  } catch (error) {
    console.error("Document request creation failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to create the document request.",
    });
  }
});

// PATCH /api/admin/document-requests/:id/status
router.patch("/requests/:id/status", async (req, res) => {
  const requestId = parsePositiveId(req.params.id);
  const { status } = req.body ?? {};

  if (!requestId) {
    return res.status(400).json({
      success: false,
      message: "Invalid document request ID.",
    });
  }

  if (!["completed", "cancelled"].includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Status must be completed or cancelled.",
    });
  }

  try {
    const [requests] = await db.execute(
      "SELECT id, status FROM document_requests WHERE id = ? LIMIT 1",
      [requestId]
    );

    if (requests.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Document request not found.",
      });
    }

    if (!["pending", "submitted"].includes(requests[0].status)) {
      return res.status(409).json({
        success: false,
        message: "This request can no longer be updated.",
      });
    }

    await db.execute(
      `UPDATE document_requests
       SET status = ?,
           completed_at = CASE
             WHEN ? = 'completed' THEN CURRENT_TIMESTAMP 
             ELSE NULL
           END
       WHERE id = ?`,
      [status, status, requestId]
    );

    return res.status(200).json({
      success: true,
      message: `Document request marked ${status}.`,
    });
  } catch (error) {
    console.error("Document request update failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to update the document request.",
    });
  }
});

export default router;