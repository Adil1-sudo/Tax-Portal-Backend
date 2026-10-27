import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const requiredVariables = [
  "DB_HOST",
  "DB_USER",
  "DB_NAME",
];

for (const variable of requiredVariables) {
  if (!process.env[variable]) {
    throw new Error(
      `Missing required environment variable: ${variable}`
    );
  }
}

const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: "utf8mb4",
});

export async function checkDatabaseConnection() {
  const connection = await db.getConnection();

  try {
    await connection.query("SELECT 1");
    return true;
  } finally {
    connection.release();
  }
}

export default db;
