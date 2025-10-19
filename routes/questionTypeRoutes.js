// routes/questionTypeRoutes.js
const express = require("express");
const questionTypeController = require("../controllers/questionTypeController");
const { authMiddleware, adminMiddleware } = require("../middleware/auth");

const router = express.Router();

// Public route - get all active question types
router.get("/", authMiddleware, (req, res) =>
  questionTypeController.getQuestionTypes(req, res)
);

// Admin routes
router.post("/", authMiddleware, adminMiddleware, (req, res) =>
  questionTypeController.createQuestionType(req, res)
);

router.put("/:id", authMiddleware, adminMiddleware, (req, res) =>
  questionTypeController.updateQuestionType(req, res)
);

router.delete("/:id", authMiddleware, adminMiddleware, (req, res) =>
  questionTypeController.deleteQuestionType(req, res)
);

module.exports = router;