const mysql = require("mysql2/promise");

class Database {
  constructor() {
    this.pool = null;
  }

  async initialize() {
    this.pool = mysql.createPool({
      host: process.env.DB_HOST || "localhost",
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASS || "",
      database: process.env.DB_NAME || "testgorilla_db",
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });

    try {
      const connection = await this.pool.getConnection();
      console.log("✓ Database connected successfully");
      connection.release();
    } catch (err) {
      console.error("✗ Database connection failed:", err.message);
      process.exit(1);
    }
  }

  getPool() {
    return this.pool;
  }
}

module.exports = new Database();