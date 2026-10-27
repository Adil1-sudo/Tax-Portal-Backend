
import { Router } from "express";
import db from "../config/db.js";

const router = Router();

const ALLOWED_PAGE_KEYS = ["about", "services", "contact"];

function parseContent(content) {
  if (typeof content !== "string") return content;

  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

// GET /api/public/website/pages/:pageKey
router.get("/pages/:pageKey", async (req, res) => {
  const { pageKey } = req.params;

  if (!ALLOWED_PAGE_KEYS.includes(pageKey)) {
    return res.status(404).json({
      success: false,
      message: "Website page not found.",
    });
  }

  try {
    const [pages] = await db.query(
      `SELECT
         page_key AS pageKey,
         title,
         description,
         content
       FROM website_pages
       WHERE page_key = ?
         AND is_published = TRUE
       LIMIT 1`,
      [pageKey]
    );

    if (pages.length === 0) {
      return res.status(404).json({
        success: false,
        message: "This page is not available.",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        ...pages[0],
        content: parseContent(pages[0].content),
      },
    });
  } catch (error) {
    console.error("Public website page retrieval failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to load this page.",
    });
  }
});

// GET /api/public/website/services
router.get("/services", async (req, res) => {
  try {
    const [services] = await db.query(
      `SELECT
         id,
         title,
         description,
         display_order AS displayOrder
       FROM website_services
       WHERE is_active = TRUE
       ORDER BY display_order ASC, id ASC`
    );

    return res.status(200).json({
      success: true,
      data: services,
    });
  } catch (error) {
    console.error("Public services retrieval failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to load services.",
    });
  }
});

// GET /api/public/website/values
router.get("/values", async (req, res) => {
  try {
    const [values] = await db.query(
      `SELECT
         id,
         title,
         description,
         display_order AS displayOrder
       FROM website_values
       WHERE is_active = TRUE
       ORDER BY display_order ASC, id ASC`
    );

    return res.status(200).json({
      success: true,
      data: values,
    });
  } catch (error) {
    console.error("Public company values retrieval failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to load company values.",
    });
  }
});

export default router;
