// routes/authRoutes.js
const express = require("express");
const authController = require("../controllers/AuthController");
const { authMiddleware } = require("../middleware/auth");

const router = express.Router();

router.post("/register", (req, res) => authController.register(req, res));
router.post("/login", (req, res) => authController.login(req, res));
router.get("/me", authMiddleware, (req, res) =>
  authController.getCurrentUser(req, res)
);

module.exports = router;