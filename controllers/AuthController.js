const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const database = require("../config/database");

class AuthController {
  async register(req, res) {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    if (!["employer", "candidate", "admin"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role",
      });
    }

    try {
      const db = database.getPool();
      const [existing] = await db.execute(
        "SELECT id FROM users WHERE email = ?",
        [email]
      );

      if (existing.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Email already registered",
        });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const [result] = await db.execute(
        "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)",
        [name, email, hashedPassword, role]
      );

      const token = this.generateToken({
        id: result.insertId,
        email,
        role,
      });

      res.status(201).json({
        success: true,
        message: "User registered successfully",
        token,
        user: { id: result.insertId, name, email, role },
      });
    } catch (error) {
      console.error("Register error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to register user",
      });
    }
  }

  async login(req, res) {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    try {
      const db = database.getPool();
      const [users] = await db.execute("SELECT * FROM users WHERE email = ?", [
        email,
      ]);

      if (users.length === 0) {
        return res.status(401).json({
          success: false,
          message: "Invalid credentials",
        });
      }

      const user = users[0];
      const passwordValid = await bcrypt.compare(password, user.password);

      if (!passwordValid) {
        return res.status(401).json({
          success: false,
          message: "Invalid credentials",
        });
      }

      const token = this.generateToken({
        id: user.id,
        email: user.email,
        role: user.role,
      });

      res.json({
        success: true,
        message: "Login successful",
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({
        success: false,
        message: "Login failed",
      });
    }
  }

  async getCurrentUser(req, res) {
    try {
      const db = database.getPool();
      const [users] = await db.execute(
        "SELECT id, name, email, role FROM users WHERE id = ?",
        [req.user.id]
      );

      if (users.length === 0) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      res.json({
        success: true,
        user: users[0],
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch user",
      });
    }
  }

  generateToken(payload) {
    return jwt.sign(payload, process.env.JWT_SECRET || "your-secret-key", {
      expiresIn: "24h",
    });
  }
}

module.exports = new AuthController();