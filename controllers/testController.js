// controllers/testController.js
const database = require("../config/database");

class TestController {
  async create(req, res) {
    const { title, description, time_limit, questions } = req.body;
    const created_by = req.user.id;

    if (!title || !questions || questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Title and at least one question are required",
      });
    }

    const db = database.getPool();
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const [testResult] = await connection.execute(
        "INSERT INTO tests (title, description, time_limit, created_by) VALUES (?, ?, ?, ?)",
        [title, description || null, time_limit || 30, created_by]
      );

      const testId = testResult.insertId;

      for (const question of questions) {
        await connection.execute(
          "INSERT INTO questions (test_id, question_text, question_type, options, correct_answer) VALUES (?, ?, ?, ?, ?)",
          [
            testId,
            question.question_text,
            question.question_type,
            question.options || null,
            question.correct_answer || null,
          ]
        );
      }

      await connection.commit();

      res.status(201).json({
        success: true,
        message: "Test created successfully",
        testId,
      });
    } catch (error) {
      await connection.rollback();
      console.error("Error creating test:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create test",
      });
    } finally {
      connection.release();
    }
  }

  async getMyTests(req, res) {
    try {
      const db = database.getPool();
      const [tests] = await db.execute(
        `SELECT t.id, t.title, t.description, t.time_limit, t.created_at,
                COUNT(q.id) as question_count 
         FROM tests t 
         LEFT JOIN questions q ON t.id = q.test_id 
         WHERE t.created_by = ? 
         GROUP BY t.id 
         ORDER BY t.created_at DESC`,
        [req.user.id]
      );

      res.json({
        success: true,
        tests,
      });
    } catch (error) {
      console.error("Error fetching tests:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch tests",
      });
    }
  }

  async getAvailableTests(req, res) {
    try {
      const db = database.getPool();
      const [tests] = await db.execute(
        `SELECT t.id, t.title, t.description, t.time_limit, t.created_at,
                COUNT(q.id) as question_count,
                u.name as created_by_name
         FROM tests t 
         LEFT JOIN questions q ON t.id = q.test_id 
         LEFT JOIN users u ON t.created_by = u.id
         GROUP BY t.id 
         ORDER BY t.created_at DESC`
      );

      res.json({
        success: true,
        tests,
      });
    } catch (error) {
      console.error("Error fetching tests:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch tests",
      });
    }
  }

  async getTestById(req, res) {
    try {
      const db = database.getPool();
      const [tests] = await db.execute("SELECT * FROM tests WHERE id = ?", [
        req.params.id,
      ]);

      if (tests.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Test not found",
        });
      }

      const test = tests[0];

      if (test.created_by !== req.user.id && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Unauthorized",
        });
      }

      const [questions] = await db.execute(
        "SELECT id, question_text, question_type, options, correct_answer FROM questions WHERE test_id = ? ORDER BY id",
        [req.params.id]
      );

      const parsedQuestions = questions.map((q) => ({
        ...q,
        options: q.options ? JSON.parse(q.options) : [],
      }));

      res.json({
        success: true,
        test: {
          ...test,
          questions: parsedQuestions,
        },
      });
    } catch (error) {
      console.error("Error fetching test:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch test",
      });
    }
  }

  async getTestForTaking(req, res) {
    try {
      const db = database.getPool();
      const [tests] = await db.execute(
        "SELECT id, title, description, time_limit FROM tests WHERE id = ?",
        [req.params.id]
      );

      if (tests.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Test not found",
        });
      }

      const [questions] = await db.execute(
        "SELECT id, question_text, question_type, options FROM questions WHERE test_id = ? ORDER BY id",
        [req.params.id]
      );

      const parsedQuestions = questions.map((q) => ({
        ...q,
        options: Array.isArray(q.options)
          ? q.options
          : typeof q.options === "string" && q.options.length > 0
          ? q.options.split(",")
          : [],
      }));

      res.json({
        success: true,
        test: {
          ...tests[0],
          questions: parsedQuestions,
        },
      });
    } catch (error) {
      console.error("Error fetching test:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch test",
      });
    }
  }

  async submitTest(req, res) {
    const { answers } = req.body;
    const testId = req.params.id;
    const userId = req.user.id;

    if (!answers || typeof answers !== "object") {
      return res.status(400).json({
        success: false,
        message: "Answers are required",
      });
    }

    const db = database.getPool();
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const [tests] = await connection.execute(
        "SELECT * FROM tests WHERE id = ?",
        [testId]
      );

      if (tests.length === 0) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: "Test not found",
        });
      }

      const [questions] = await connection.execute(
        "SELECT id, question_type, correct_answer FROM questions WHERE test_id = ?",
        [testId]
      );

      if (questions.length === 0) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: "No questions found for this test",
        });
      }

      let correctCount = 0;
      let totalAutoGraded = 0;

      for (const question of questions) {
        const userAnswer = answers[question.id];
        let isCorrect = false;

        if (
          question.question_type === "multiple_choice" ||
          question.question_type === "true_false"
        ) {
          totalAutoGraded++;
          isCorrect = userAnswer === question.correct_answer;
          if (isCorrect) correctCount++;
        }

        await connection.execute(
          "INSERT INTO answers (candidate_id, question_id, answer, is_correct) VALUES (?, ?, ?, ?)",
          [userId, question.id, userAnswer || null, isCorrect ? 1 : 0]
        );
      }

      const score =
        totalAutoGraded > 0
          ? Math.round((correctCount / totalAutoGraded) * 100)
          : 0;

      const remarks = this.calculateRemarks(score);

      await connection.execute(
        "INSERT INTO results (candidate_id, test_id, total_questions, correct_answers, score, remarks) VALUES (?, ?, ?, ?, ?, ?)",
        [userId, testId, totalAutoGraded, correctCount, score, remarks]
      );

      await connection.execute(
        "INSERT INTO candidates_tests (candidate_id, test_id, start_time, end_time, score, status) VALUES (?, ?, NOW(), NOW(), ?, ?) ON DUPLICATE KEY UPDATE end_time = NOW(), score = ?, status = ?",
        [userId, testId, score, "completed", score, "completed"]
      );

      await connection.commit();

      res.status(201).json({
        success: true,
        message: "Test submitted successfully",
        submission: {
          score,
          total_questions: totalAutoGraded,
          correct_answers: correctCount,
          remarks,
        },
      });
    } catch (error) {
      await connection.rollback();
      console.error("Error submitting test:", error);
      res.status(500).json({
        success: false,
        message: "Failed to submit test",
      });
    } finally {
      connection.release();
    }
  }

  async update(req, res) {
    const { title, description, time_limit, questions } = req.body;
    const testId = req.params.id;

    const db = database.getPool();

    try {
      const [tests] = await db.execute(
        "SELECT created_by FROM tests WHERE id = ?",
        [testId]
      );

      if (tests.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Test not found",
        });
      }

      if (tests[0].created_by !== req.user.id && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Unauthorized",
        });
      }

      const connection = await db.getConnection();

      try {
        await connection.beginTransaction();

        await connection.execute(
          "UPDATE tests SET title = ?, description = ?, time_limit = ? WHERE id = ?",
          [title, description || null, time_limit || 30, testId]
        );

        if (questions && questions.length > 0) {
          await connection.execute("DELETE FROM questions WHERE test_id = ?", [
            testId,
          ]);

          for (const question of questions) {
            await connection.execute(
              "INSERT INTO questions (test_id, question_text, question_type, options, correct_answer) VALUES (?, ?, ?, ?, ?)",
              [
                testId,
                question.question_text,
                question.question_type,
                question.options || null,
                question.correct_answer || null,
              ]
            );
          }
        }

        await connection.commit();

        res.json({
          success: true,
          message: "Test updated successfully",
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error("Error updating test:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update test",
      });
    }
  }

  async delete(req, res) {
    try {
      const db = database.getPool();
      const [tests] = await db.execute(
        "SELECT created_by FROM tests WHERE id = ?",
        [req.params.id]
      );

      if (tests.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Test not found",
        });
      }

      if (tests[0].created_by !== req.user.id && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Unauthorized",
        });
      }

      await db.execute("DELETE FROM tests WHERE id = ?", [req.params.id]);

      res.json({
        success: true,
        message: "Test deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting test:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete test",
      });
    }
  }

  async getTestResults(req, res) {
    try {
      const db = database.getPool();
      const [tests] = await db.execute(
        "SELECT created_by FROM tests WHERE id = ?",
        [req.params.id]
      );

      if (tests.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Test not found",
        });
      }

      if (tests[0].created_by !== req.user.id && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Unauthorized",
        });
      }

      const [results] = await db.execute(
        `SELECT r.*, u.name as candidate_name, u.email as candidate_email
         FROM results r
         JOIN users u ON r.candidate_id = u.id
         WHERE r.test_id = ?
         ORDER BY r.taken_at DESC`,
        [req.params.id]
      );

      res.json({
        success: true,
        results,
      });
    } catch (error) {
      console.error("Error fetching test results:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch test results",
      });
    }
  }

  calculateRemarks(score) {
    if (score >= 90) return "Excellent";
    if (score >= 75) return "Very Good";
    if (score >= 60) return "Good";
    if (score >= 50) return "Fair";
    return "Needs Improvement";
  }
}

module.exports = new TestController();
