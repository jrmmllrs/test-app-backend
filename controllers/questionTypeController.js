// controllers/questionTypeController.js
const database = require("../config/database");

class QuestionTypeController {
  // Get all active question types
  async getQuestionTypes(req, res) {
    try {
      const db = database.getPool();
      const [types] = await db.execute(
        `SELECT 
          id, 
          type_key, 
          type_name, 
          description, 
          requires_options, 
          requires_correct_answer 
        FROM question_types 
        WHERE is_active = TRUE 
        ORDER BY type_name ASC`
      );

      res.json({
        success: true,
        questionTypes: types,
      });
    } catch (error) {
      console.error("Error fetching question types:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch question types",
      });
    }
  }

  // Create new question type (admin only)
  async createQuestionType(req, res) {
    try {
      const { type_key, type_name, description, requires_options, requires_correct_answer } = req.body;

      // Validate required fields
      if (!type_key || !type_name) {
        return res.status(400).json({
          success: false,
          message: "Type key and type name are required",
        });
      }

      // Validate type_key format (lowercase, underscore only)
      if (!/^[a-z_]+$/.test(type_key)) {
        return res.status(400).json({
          success: false,
          message: "Type key must contain only lowercase letters and underscores",
        });
      }

      const db = database.getPool();

      await db.execute(
        `INSERT INTO question_types 
        (type_key, type_name, description, requires_options, requires_correct_answer) 
        VALUES (?, ?, ?, ?, ?)`,
        [
          type_key,
          type_name,
          description || null,
          requires_options ? 1 : 0,
          requires_correct_answer ? 1 : 0,
        ]
      );

      res.status(201).json({
        success: true,
        message: "Question type created successfully",
      });
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") {
        return res.status(400).json({
          success: false,
          message: "Question type with this key already exists",
        });
      }

      console.error("Error creating question type:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create question type",
      });
    }
  }

  // Update question type (admin only)
  async updateQuestionType(req, res) {
    try {
      const { id } = req.params;
      const { type_name, description, requires_options, requires_correct_answer, is_active } = req.body;

      const db = database.getPool();

      const [result] = await db.execute(
        `UPDATE question_types 
        SET type_name = ?, 
            description = ?, 
            requires_options = ?, 
            requires_correct_answer = ?,
            is_active = ?
        WHERE id = ?`,
        [
          type_name,
          description || null,
          requires_options !== undefined ? (requires_options ? 1 : 0) : 0,
          requires_correct_answer !== undefined ? (requires_correct_answer ? 1 : 0) : 0,
          is_active !== undefined ? (is_active ? 1 : 0) : 1,
          id,
        ]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: "Question type not found",
        });
      }

      res.json({
        success: true,
        message: "Question type updated successfully",
      });
    } catch (error) {
      console.error("Error updating question type:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update question type",
      });
    }
  }

  // Delete (deactivate) question type (admin only)
  async deleteQuestionType(req, res) {
    try {
      const { id } = req.params;
      const db = database.getPool();

      // Soft delete by setting is_active to false
      const [result] = await db.execute(
        "UPDATE question_types SET is_active = FALSE WHERE id = ?",
        [id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: "Question type not found",
        });
      }

      res.json({
        success: true,
        message: "Question type deactivated successfully",
      });
    } catch (error) {
      console.error("Error deleting question type:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete question type",
      });
    }
  }
}

module.exports = new QuestionTypeController();