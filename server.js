import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/authRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import healthRoutes from "./routes/healthRoutes.js";
import adminFeeRoutes from "./routes/adminFeeRoutes.js";
import adminDocumentRoutes from "./routes/adminDocumentRoutes.js";
import adminWebsiteRoutes from "./routes/adminWebsiteRoutes.js";
import publicWebsiteRoutes from "./routes/publicWebsiteRoutes.js";
import contactRoutes from "./routes/contactRoutes.js";
import adminSettingsRoutes from "./routes/adminSettingsRoutes.js";
import adminEnquiryRoutes from "./routes/adminEnquiryRoutes.js";
import clientRoutes from "./routes/clientRoutes.js";
import publicSettingsRoutes from "./routes/publicSettingsRoutes.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 5000);

app.disable("x-powered-by");

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Welcome to the Zafar Law Chamber API.",
  });
});

app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/documents", adminDocumentRoutes);
app.use("/api/admin/fees", adminFeeRoutes);
app.use("/api/admin/website", adminWebsiteRoutes);
app.use("/api/public/website", publicWebsiteRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/admin/settings", adminSettingsRoutes);
app.use("/api/admin/enquiries", adminEnquiryRoutes);
app.use("/api/public/settings", publicSettingsRoutes);
app.use("/api/client", clientRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API endpoint not found.",
  });
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON request body.",
    });
  }

  console.error("Unhandled server error:", error.message);

  return res.status(500).json({
    success: false,
    message: "An unexpected server error occurred.",
  });
});

app.listen(PORT, () => {
  console.log(`Zafar Law Chamber API running at http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`Database check: http://localhost:${PORT}/api/health/db`);
});
