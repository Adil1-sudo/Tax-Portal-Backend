import { Router } from "express";
import db from "../config/db.js";
import {
  authenticateToken,
  authorizeRoles,
} from "../middleware/authMiddleware.js";

const router = Router();

// Every endpoint in this file requires an active administrator.
router.use(authenticateToken, authorizeRoles("admin"));

/**
 * GET /api/admin/dashboard-summary
 * Returns live summary statistics for the admin dashboard.
 */
router.get("/dashboard-summary", async (req, res) => {
  try {
    const [
      [clientRows],
      [pendingRows],
      [documentRows],
      [feeRows],
    ] = await Promise.all([
      db.execute(
        `SELECT COUNT(*) AS totalClients
         FROM users
         WHERE role = 'client'`
      ),

      db.execute(
        `SELECT COUNT(*) AS pendingApprovals
         FROM users
         WHERE role = 'client'
           AND account_status = 'pending'`
      ),

      db.execute(
        `SELECT COUNT(*) AS clientDocuments
         FROM documents
         WHERE source = 'client_upload'`
      ),

      db.execute(
        `SELECT
           currency,
           SUM(amount) AS totalAmount,
           COUNT(*) AS feeCount
         FROM fee_requests
         WHERE status IN ('pending', 'overdue')
         GROUP BY currency
         ORDER BY currency`
      ),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        totalClients: Number(clientRows[0].totalClients),
        pendingApprovals: Number(pendingRows[0].pendingApprovals),
        clientDocuments: Number(documentRows[0].clientDocuments),
        outstandingFees: feeRows.map((row) => ({
          currency: row.currency,
          totalAmount: Number(row.totalAmount),
          feeCount: Number(row.feeCount),
        })),
      },
    });
  } catch (error) {
    console.error("Admin dashboard summary failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to load dashboard statistics.",
    });
  }
});

/**
 * GET /api/admin/notifications
 * Builds live notifications from existing database records.
 * Admin authentication is enforced by router-level middleware.
 */

router.get("/notifications", async (req, res) => {
  try {
    // Default preferences are used if no settings have been saved yet.
    const defaultPreferences = {
      newClient: true,
      clientDocuments: true,
      feeRequests: true,
      overduePayments: true,
      productUpdates: false,
    };

    // 1. Load notification preferences from the database.
    const [settingsRows] = await db.execute(
      `SELECT setting_value
       FROM admin_settings
       WHERE setting_key = ?
       LIMIT 1`,
      ["notification_preferences"]
    );

    let notificationPreferences = { ...defaultPreferences };

    if (settingsRows.length > 0 && settingsRows[0].setting_value != null) {
      try {
        const savedPreferences =
          typeof settingsRows[0].setting_value === "string"
            ? JSON.parse(settingsRows[0].setting_value)
            : settingsRows[0].setting_value;

        if (
          savedPreferences &&
          typeof savedPreferences === "object" &&
          !Array.isArray(savedPreferences)
        ) {
          notificationPreferences = {
            ...defaultPreferences,
            ...savedPreferences,
          };
        }
      } catch (error) {
        console.error("Unable to parse notification preferences.");
      }
    }

    // 2. Fetch notification records.
    const [
      [pendingClients],
      [pendingDocuments],
      [recentUploads],
      [outstandingFees],
      [newEnquiries],
    ] = await Promise.all([
      db.execute(
        `SELECT
           u.id,
           u.full_name,
           u.created_at AS createdAt
         FROM users u
         WHERE u.role = 'client'
           AND u.account_status = 'pending'
         ORDER BY u.created_at DESC
         LIMIT 5`
      ),

      db.execute(
        `SELECT
           dr.id,
           dr.title,
           dr.created_at AS createdAt,
           u.full_name
         FROM document_requests dr
         INNER JOIN users u ON u.id = dr.client_id
         WHERE dr.status = 'pending'
         ORDER BY dr.created_at DESC
         LIMIT 5`
      ),

      db.execute(
        `SELECT
           d.id,
           d.title,
           d.created_at AS createdAt,
           u.full_name
         FROM documents d
         INNER JOIN users u ON u.id = d.client_id
         WHERE d.source = 'client_upload'
           AND d.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
         ORDER BY d.created_at DESC
         LIMIT 5`
      ),

      db.execute(
        `SELECT
           fr.id,
           fr.title,
           fr.amount,
           fr.currency,
           fr.status,
           fr.created_at AS createdAt,
           u.full_name
         FROM fee_requests fr
         INNER JOIN users u ON u.id = fr.client_id
         WHERE fr.status IN ('pending', 'overdue')
         ORDER BY
           CASE WHEN fr.status = 'overdue' THEN 0 ELSE 1 END,
           fr.due_date ASC,
           fr.created_at DESC
         LIMIT 5`
      ),

      db.execute(
        `SELECT
           id,
           name,
           subject,
           created_at AS createdAt
         FROM contact_enquiries
         WHERE status = 'new'
         ORDER BY created_at DESC
         LIMIT 5`
      ),
    ]);

    // 3. Build notifications and associate each with its preference.
    const notifications = [
      ...pendingClients.map((row) => ({
        id: `client-${row.id}`,
        title: "Client approval pending",
        message: `${row.full_name} is waiting for account approval.`,
        createdAt: row.createdAt,
        target: "Client Management",
        preferenceKey: "newClient",
      })),

      ...pendingDocuments.map((row) => ({
        id: `document-request-${row.id}`,
        title: "Document submission pending",
        message: `${row.full_name} has not submitted "${row.title}".`,
        createdAt: row.createdAt,
        target: "Documents",
        preferenceKey: "clientDocuments",
      })),

      ...recentUploads.map((row) => ({
        id: `document-upload-${row.id}`,
        title: "New client document",
        message: `${row.full_name} uploaded "${row.title}".`,
        createdAt: row.createdAt,
        target: "Documents",
        preferenceKey: "clientDocuments",
      })),

      ...outstandingFees.map((row) => ({
        id: `fee-${row.id}`,
        title:
          row.status === "overdue"
            ? "Fee overdue"
            : "Fee payment pending",
        message: `${row.full_name}: ${row.title} — ${row.currency} ${row.amount}.`,
        createdAt: row.createdAt,
        target: "Fee Management",
        preferenceKey:
          row.status === "overdue"
            ? "overduePayments"
            : "feeRequests",
      })),

      ...newEnquiries.map((row) => ({
        id: `enquiry-${row.id}`,
        title: "New contact enquiry",
        message: `${row.name}: ${row.subject}`,
        createdAt: row.createdAt,
        target: "Admin Enquiries",
        // No preference exists for enquiries yet.
      })),
    ];

    // 4. Remove notifications whose saved preference is false.
    const filteredNotifications = notifications.filter((notification) => {
      const key = notification.preferenceKey;

      // Notifications without a matching preference remain enabled.
      if (!key) return true;

      return notificationPreferences[key] !== false;
    });

    // 5. Sort and return only the newest 20 enabled notifications.
    filteredNotifications.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() -
        new Date(a.createdAt).getTime()
    );

    const result = filteredNotifications.slice(0, 20).map(
      ({ preferenceKey, ...notification }) => notification
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error(
      "Admin notifications retrieval failed:",
      error.message
    );

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve notifications.",
    });
  }
});


// GET /api/admin/clients?page=1&limit=10&status=pending&search=
router.get("/clients", async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      50,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 10)
    );
    const offset = (page - 1) * limit;

    const allowedStatuses = [
      "pending",
      "active",
      "rejected",
      "suspended",
    ];

    const status =
      typeof req.query.status === "string" ? req.query.status : "";

    const search =
      typeof req.query.search === "string"
        ? req.query.search.trim().slice(0, 100)
        : "";

    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid account status filter.",
      });
    }

    const conditions = ["u.role = 'client'"];
    const params = [];

    if (status) {
      conditions.push("u.account_status = ?");
      params.push(status);
    }

    if (search) {
      conditions.push("(u.full_name LIKE ? OR u.email LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    const whereClause = conditions.join(" AND ");

    const [countRows] = await db.execute(
      `SELECT COUNT(*) AS total
       FROM users u
       WHERE ${whereClause}`,
      params
    );

    const [clients] = await db.execute(
      `SELECT
         u.id,
         u.full_name,
         u.email,
         u.account_status,
         DATE(u.created_at) AS joinDate,
         u.last_login,
         cp.business_name,
         cp.phone,
         cp.country
       FROM users u
       LEFT JOIN client_profiles cp ON cp.user_id = u.id
       WHERE ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return res.status(200).json({
      success: true,
      data: clients,
      pagination: {
        page,
        limit,
        total: countRows[0].total,
        totalPages: Math.ceil(countRows[0].total / limit),
      },
    });
  } catch (error) {
    console.error("Admin client listing failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve client accounts.",
    });
  }
});

// GET /api/admin/clients/:id
router.get("/clients/:id", async (req, res) => {
  const clientId = Number(req.params.id);

  if (!Number.isSafeInteger(clientId) || clientId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid client ID.",
    });
  }

  try {
    const [clients] = await db.execute(
      `SELECT
         u.id,
         u.full_name,
         u.email,
         u.account_status,
         u.created_at,
         u.last_login,
         cp.business_name,
         cp.phone,
         cp.address,
         cp.country,
         cp.tax_reference,
         cp.internal_notes
       FROM users u
       LEFT JOIN client_profiles cp ON cp.user_id = u.id
       WHERE u.id = ? AND u.role = 'client'
       LIMIT 1`,
      [clientId]
    );

    if (clients.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Client account not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: clients[0],
    });
  } catch (error) {
    console.error("Admin client detail failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve client details.",
    });
  }
});

// PATCH /api/admin/clients/:id/status

router.patch("/clients/:id/status", async (req, res) => {
  const clientId = Number(req.params.id);
  const { status } = req.body ?? {};

  if (!Number.isSafeInteger(clientId) || clientId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid client ID.",
    });
  }

  const allowedTransitions = {
    pending: ["active", "rejected"],
    active: ["suspended"],
    suspended: ["active"],
    rejected: [],
  };

  if (
    typeof status !== "string" ||
    !["active", "rejected", "suspended"].includes(status)
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid requested account status.",
    });
  }

  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `SELECT id, account_status
       FROM users
       WHERE id = ? AND role = 'client'
       FOR UPDATE`,
      [clientId]
    );

    if (rows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Client account not found.",
      });
    }

    // FIX: Use the actual MySQL column name.
    const currentStatus = rows[0].account_status;

    if (!currentStatus) {
      await connection.rollback();

      return res.status(500).json({
        success: false,
        message: "Client account has no current status.",
      });
    }

    const validNextStatuses =
      allowedTransitions[currentStatus] ?? [];

    if (!validNextStatuses.includes(status)) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: `Cannot change account status from ${currentStatus} to ${status}.`,
      });
    }

    await connection.execute(
      `UPDATE users
       SET account_status = ?
       WHERE id = ? AND role = 'client'`,
      [status, clientId]
    );

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: `Client account status changed to ${status}.`,
      data: {
        id: clientId,
        accountStatus: status,
      },
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error(
          "Status update rollback failed:",
          rollbackError.message
        );
      }
    }

    console.error(
      "Admin client status update failed:",
      error.message
    );

    return res.status(500).json({
      success: false,
      message: "Unable to update the client account.",
    });
  } finally {
    connection?.release();
  }
});


export default router;