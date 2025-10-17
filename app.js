// app.js
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { authMiddleware, requireRole } = require("./middleware/auth");

const authRoutes = require("./routes/authRoutes");
const testRoutes = require("./routes/testRoutes");
const resultRoutes = require("./routes/resultRoutes");
const resultController = require("./controllers/resultController");

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Admin route MUST come before other result routes
app.get("/api/admin/results", authMiddleware, requireRole("admin"), (req, res) => {
  resultController.getAllResults(req, res);
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/tests", testRoutes);
app.use("/api/results", resultRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Server is running" });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

module.exports = app;