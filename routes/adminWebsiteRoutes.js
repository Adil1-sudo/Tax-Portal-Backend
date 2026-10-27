
import { Router } from "express";
import db from "../config/db.js";
import {
  authenticateToken,
  authorizeRoles,
} from "../middleware/authMiddleware.js";

const router = Router();

router.use(authenticateToken, authorizeRoles("admin"));

const PAGE_KEYS = ["about", "services", "contact"];

function parseContent(content) {
  if (typeof content !== "string") return content;

  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

function validateText(value, maxLength, required = false) {
  return (
    typeof value === "string" &&
    value.length <= maxLength &&
    (!required || value.trim().length > 0)
  );
}

function validId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// -------------------- WEBSITE PAGES --------------------

// GET /api/admin/website/pages
router.get("/pages", async (req, res) => {
  try {
    const [pages] = await db.query(
      `SELECT page_key AS pageKey,
              title,
              description,
              content,
              is_published AS isPublished,
              updated_by AS updatedBy
       FROM website_pages
       ORDER BY page_key`
    );

    const data = pages.map((page) => ({
      ...page,
      content: parseContent(page.content),
    }));

    return res.json({ success: true, data });
  } catch (error) {
    console.error("Website page list failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve website pages.",
    });
  }
});

// GET /api/admin/website/pages/:pageKey
router.get("/pages/:pageKey", async (req, res) => {
  const { pageKey } = req.params;

  if (!PAGE_KEYS.includes(pageKey)) {
    return res.status(400).json({
      success: false,
      message: "Unsupported page key.",
    });
  }

  try {
    const [pages] = await db.query(
      `SELECT page_key AS pageKey,
              title,
              description,
              content,
              is_published AS isPublished,
              updated_by AS updatedBy
       FROM website_pages
       WHERE page_key = ?
       LIMIT 1`,
      [pageKey]
    );

    if (!pages.length) {
      return res.status(404).json({
        success: false,
        message: "Website page has not been created yet.",
      });
    }

    return res.json({
      success: true,
      data: {
        ...pages[0],
        content: parseContent(pages[0].content),
      },
    });
  } catch (error) {
    console.error("Website page retrieval failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve this website page.",
    });
  }
});

// POST /api/admin/website/pages
// Creates a page if it doesn't exist, otherwise updates it.
router.post("/pages", async (req, res) => {
  const { pageKey, title, description = "", content = {}, isPublished = false } =
    req.body;

  if (!PAGE_KEYS.includes(pageKey)) {
    return res.status(400).json({
      success: false,
      message: "pageKey must be about, services, or contact.",
    });
  }

  if (!validateText(title, 150, true)) {
    return res.status(400).json({
      success: false,
      message: "A title of 150 characters or fewer is required.",
    });
  }

  if (!validateText(description, 2000)) {
    return res.status(400).json({
      success: false,
      message: "Description must be 2000 characters or fewer.",
    });
  }

  if (typeof isPublished !== "boolean") {
    return res.status(400).json({
      success: false,
      message: "isPublished must be true or false.",
    });
  }

if (
  !["string", "object"].includes(typeof content) ||
  content === null
) {
    return res.status(400).json({
      success: false,
      message: "Content must be a string or an array.",
    });
  }

  let contentText;

  try {
    contentText =
      typeof content === "string" ? content : JSON.stringify(content);
  } catch {
    return res.status(400).json({
      success: false,
      message: "Content could not be processed.",
    });
  }

  if (contentText.length > 500000) {
    return res.status(400).json({
      success: false,
      message: "Page content is too large.",
    });
  }

  try {
    await db.query(
      `INSERT INTO website_pages
         (page_key, title, description, content, is_published, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title),
         description = VALUES(description),
         content = VALUES(content),
         is_published = VALUES(is_published),
         updated_by = VALUES(updated_by)`,
      [
        pageKey,
        title.trim(),
        description.trim(),
        contentText,
        isPublished,
        req.user.id,
      ]
    );

    const [pages] = await db.query(
      `SELECT page_key AS pageKey,
              title,
              description,
              content,
              is_published AS isPublished,
              updated_by AS updatedBy
       FROM website_pages
       WHERE page_key = ?
       LIMIT 1`,
      [pageKey]
    );

    return res.status(200).json({
      success: true,
      message: "Website page saved successfully.",
      data: {
        ...pages[0],
        content: parseContent(pages[0].content),
      },
    });
  } catch (error) {
    console.error("Website page save failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to save this website page.",
    });
  }
});

// -------------------- SERVICES --------------------

// GET /api/admin/website/services
router.get("/services", async (req, res) => {
  try {
    const [services] = await db.query(
      `SELECT id, title, description,
              display_order AS displayOrder,
              is_active AS isActive,
              created_by AS createdBy,
              updated_by AS updatedBy
       FROM website_services
       ORDER BY display_order ASC, id ASC`
    );

    return res.json({ success: true, data: services });
  } catch (error) {
    console.error("Website services retrieval failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve website services.",
    });
  }
});

// POST /api/admin/website/services
router.post("/services", async (req, res) => {
  const {
    title,
    description = "",
    displayOrder = 0,
    isActive = true,
  } = req.body;

  if (!validateText(title, 150, true)) {
    return res.status(400).json({
      success: false,
      message: "Service title is required and must be 150 characters or fewer.",
    });
  }

  if (!validateText(description, 2000)) {
    return res.status(400).json({
      success: false,
      message: "Description must be 2000 characters or fewer.",
    });
  }

  if (
    !Number.isInteger(displayOrder) ||
    displayOrder < 0 ||
    displayOrder > 10000
  ) {
    return res.status(400).json({
      success: false,
      message: "displayOrder must be an integer from 0 to 10000.",
    });
  }

  if (typeof isActive !== "boolean") {
    return res.status(400).json({
      success: false,
      message: "isActive must be true or false.",
    });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO website_services
         (title, description, display_order, is_active, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        title.trim(),
        description.trim(),
        displayOrder,
        isActive,
        req.user.id,
        req.user.id,
      ]
    );

    const [services] = await db.query(
      `SELECT id, title, description,
              display_order AS displayOrder,
              is_active AS isActive,
              created_by AS createdBy,
              updated_by AS updatedBy
       FROM website_services
       WHERE id = ?`,
      [result.insertId]
    );

    return res.status(201).json({
      success: true,
      message: "Service created successfully.",
      data: services[0],
    });
  } catch (error) {
    console.error("Website service creation failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to create this service.",
    });
  }
});

// PATCH /api/admin/website/services/:id
router.patch("/services/:id", async (req, res) => {
  const id = validId(req.params.id);

  if (!id) {
    return res.status(400).json({
      success: false,
      message: "Invalid service ID.",
    });
  }

  const allowedFields = ["title", "description", "displayOrder", "isActive"];
  const updates = [];
  const values = [];

  for (const field of Object.keys(req.body)) {
    if (!allowedFields.includes(field)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported field: ${field}`,
      });
    }
  }

  if (!Object.keys(req.body).length) {
    return res.status(400).json({
      success: false,
      message: "Provide at least one field to update.",
    });
  }

  const { title, description, displayOrder, isActive } = req.body;

  if (title !== undefined) {
    if (!validateText(title, 150, true)) {
      return res.status(400).json({
        success: false,
        message: "Invalid service title.",
      });
    }
    updates.push("title = ?");
    values.push(title.trim());
  }

  if (description !== undefined) {
    if (!validateText(description, 2000)) {
      return res.status(400).json({
        success: false,
        message: "Invalid service description.",
      });
    }
    updates.push("description = ?");
    values.push(description.trim());
  }

  if (displayOrder !== undefined) {
    if (
      !Number.isInteger(displayOrder) ||
      displayOrder < 0 ||
      displayOrder > 10000
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid display order.",
      });
    }
    updates.push("display_order = ?");
    values.push(displayOrder);
  }

  if (isActive !== undefined) {
    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isActive must be true or false.",
      });
    }
    updates.push("is_active = ?");
    values.push(isActive);
  }

  updates.push("updated_by = ?");
  values.push(req.user.id, id);

  try {
    const [result] = await db.query(
      `UPDATE website_services
       SET ${updates.join(", ")}
       WHERE id = ?`,
      values
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        success: false,
        message: "Service not found.",
      });
    }

    const [services] = await db.query(
      `SELECT id, title, description,
              display_order AS displayOrder,
              is_active AS isActive,
              created_by AS createdBy,
              updated_by AS updatedBy
       FROM website_services
       WHERE id = ?`,
      [id]
    );

    return res.json({
      success: true,
      message: "Service updated successfully.",
      data: services[0],
    });
  } catch (error) {
    console.error("Website service update failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to update this service.",
    });
  }
});

// DELETE /api/admin/website/services/:id
router.delete("/services/:id", async (req, res) => {
  const id = validId(req.params.id);

  if (!id) {
    return res.status(400).json({
      success: false,
      message: "Invalid service ID.",
    });
  }

  try {
    const [result] = await db.query(
      "DELETE FROM website_services WHERE id = ?",
      [id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        success: false,
        message: "Service not found.",
      });
    }

    return res.json({
      success: true,
      message: "Service deleted successfully.",
    });
  } catch (error) {
    console.error("Website service deletion failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to delete this service.",
    });
  }
});

// -------------------- COMPANY VALUES --------------------

// GET /api/admin/website/values
router.get("/values", async (req, res) => {
  try {
    const [values] = await db.query(
      `SELECT id, title, description,
              display_order AS displayOrder,
              is_active AS isActive,
              updated_by AS updatedBy
       FROM website_values
       ORDER BY display_order ASC, id ASC`
    );

    return res.json({ success: true, data: values });
  } catch (error) {
    console.error("Website values retrieval failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve company values.",
    });
  }
});

// POST /api/admin/website/values
router.post("/values", async (req, res) => {
  const {
    title,
    description = "",
    displayOrder = 0,
    isActive = true,
  } = req.body;

  if (!validateText(title, 150, true)) {
    return res.status(400).json({
      success: false,
      message: "Value title is required and must be 150 characters or fewer.",
    });
  }

  if (!validateText(description, 2000)) {
    return res.status(400).json({
      success: false,
      message: "Description must be 2000 characters or fewer.",
    });
  }

  if (
    !Number.isInteger(displayOrder) ||
    displayOrder < 0 ||
    displayOrder > 10000 ||
    typeof isActive !== "boolean"
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid display order or active status.",
    });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO website_values
         (title, description, display_order, is_active, updated_by)
       VALUES (?, ?, ?, ?, ?)`,
      [
        title.trim(),
        description.trim(),
        displayOrder,
        isActive,
        req.user.id,
      ]
    );

    const [rows] = await db.query(
      `SELECT id, title, description,
              display_order AS displayOrder,
              is_active AS isActive,
              updated_by AS updatedBy
       FROM website_values
       WHERE id = ?`,
      [result.insertId]
    );

    return res.status(201).json({
      success: true,
      message: "Company value created successfully.",
      data: rows[0],
    });
  } catch (error) {
    console.error("Company value creation failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to create this company value.",
    });
  }
});

// PATCH /api/admin/website/values/:id
router.patch("/values/:id", async (req, res) => {
  const id = validId(req.params.id);
  if (!id) {
    return res.status(400).json({
      success: false,
      message: "Invalid company value ID.",
    });
  }

  const allowedFields = ["title", "description", "displayOrder", "isActive"];

  for (const field of Object.keys(req.body)) {
    if (!allowedFields.includes(field)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported field: ${field}`,
      });
    }
  }

  const updates = [];
  const values = [];
  const { title, description, displayOrder, isActive } = req.body;

  if (!Object.keys(req.body).length) {
    return res.status(400).json({
      success: false,
      message: "Provide at least one field to update.",
    });
  }

  if (title !== undefined) {
    if (!validateText(title, 150, true)) {
      return res.status(400).json({
        success: false,
        message: "Invalid value title.",
      });
    }
    updates.push("title = ?");
    values.push(title.trim());
  }

  if (description !== undefined) {
    if (!validateText(description, 2000)) {
      return res.status(400).json({
        success: false,
        message: "Invalid value description.",
      });
    }
    updates.push("description = ?");
    values.push(description.trim());
  }

  if (displayOrder !== undefined) {
    if (
      !Number.isInteger(displayOrder) ||
      displayOrder < 0 ||
      displayOrder > 10000
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid display order.",
      });
    }
    updates.push("display_order = ?");
    values.push(displayOrder);
  }

  if (isActive !== undefined) {
    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isActive must be true or false.",
      });
    }
    updates.push("is_active = ?");
    values.push(isActive);
  }

  updates.push("updated_by = ?");
  values.push(req.user.id, id);

  try {
    const [result] = await db.query(
      `UPDATE website_values
       SET ${updates.join(", ")}
       WHERE id = ?`,
      values
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        success: false,
        message: "Company value not found.",
      });
    }

    const [rows] = await db.query(
      `SELECT id, title, description,
              display_order AS displayOrder,
              is_active AS isActive,
              updated_by AS updatedBy
       FROM website_values
       WHERE id = ?`,
      [id]
    );

    return res.json({
      success: true,
      message: "Company value updated successfully.",
      data: rows[0],
    });
  } catch (error) {
    console.error("Company value update failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to update this company value.",
    });
  }
});

// DELETE /api/admin/website/values/:id
router.delete("/values/:id", async (req, res) => {
  const id = validId(req.params.id);

  if (!id) {
    return res.status(400).json({
      success: false,
      message: "Invalid company value ID.",
    });
  }

  try {
    const [result] = await db.query(
      "DELETE FROM website_values WHERE id = ?",
      [id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        success: false,
        message: "Company value not found.",
      });
    }

    return res.json({
      success: true,
      message: "Company value deleted successfully.",
    });
  } catch (error) {
    console.error("Company value deletion failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to delete this company value.",
    });
  }
});

export default router;
