import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import db from "../config/db.js";

dotenv.config();

async function createInitialAdmin() {
  const name = process.env.INITIAL_ADMIN_NAME?.trim();
  const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.INITIAL_ADMIN_PASSWORD;

  if (!name || !email || !password) {
    throw new Error(
      "Set INITIAL_ADMIN_NAME, INITIAL_ADMIN_EMAIL, and INITIAL_ADMIN_PASSWORD in .env."
    );
  }

  if (name.length < 2 || name.length > 120) {
    throw new Error("Admin name must be between 2 and 120 characters.");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("Provide a valid administrator email address.");
  }

  if (
    password.length < 12 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    throw new Error(
      "Use an initial admin password of at least 12 characters and no more than 72 UTF-8 bytes."
    );
  }

  const [existingAdmins] = await db.execute(
    "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
  );

  if (existingAdmins.length > 0) {
    throw new Error(
      "An administrator already exists. Initial admin creation is disabled."
    );
  }

  const [existingUsers] = await db.execute(
    "SELECT id FROM users WHERE email = ? LIMIT 1",
    [email]
  );

  if (existingUsers.length > 0) {
    throw new Error(
      "This email already belongs to an account. Use a different email."
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await db.execute(
    `INSERT INTO users
      (full_name, email, password_hash, role, account_status)
     VALUES (?, ?, ?, 'admin', 'active')`,
    [name, email, passwordHash]
  );

  console.log("Initial administrator created successfully.");
  console.log(`Admin email: ${email}`);
}

createInitialAdmin()
  .catch((error) => {
    console.error("Could not create initial administrator:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });