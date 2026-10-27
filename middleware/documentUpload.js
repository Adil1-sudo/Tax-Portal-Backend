import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

const storageDirectory = path.resolve(
  process.cwd(),
  "storage",
  "documents"
);

fs.mkdirSync(storageDirectory, { recursive: true });

const allowedTypes = {
  ".pdf": ["application/pdf"],
  ".png": ["image/png"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".doc": ["application/msword"],
  ".docx": [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  ".xls": ["application/vnd.ms-excel"],
  ".xlsx": [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
};

const storage = multer.diskStorage({
  destination: (req, file, callback) => {
    callback(null, storageDirectory);
  },

  filename: (req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();

    // Never use the original client-supplied filename on disk.
    callback(null, `${randomUUID()}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const acceptedMimes = allowedTypes[extension];

    if (!acceptedMimes || !acceptedMimes.includes(file.mimetype)) {
      return callback(
        new Error("Unsupported file type. Upload PDF, PNG, JPG, DOC, DOCX, XLS, or XLSX.")
      );
    }

    callback(null, true);
  },
});

export function uploadDocument(req, res, next) {
  upload.single("document")(req, res, (error) => {
    if (!error) {
      return next();
    }

    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          success: false,
          message: "The maximum document size is 10 MB.",
        });
      }

      return res.status(400).json({
        success: false,
        message: "The upload could not be processed.",
      });
    }

    return res.status(400).json({
      success: false,
      message: error.message || "Invalid document upload.",
    });
  });
}

export { storageDirectory };