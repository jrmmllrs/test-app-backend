// server.js
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Database pool
let db;

async function initializeDatabase() {
  db = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASS || "",
    database: process.env.DB_NAME || "testgorilla_db",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  try {
    const connection = await db.getConnection();
    console.log("✓ Database connected successfully");
    connection.release();
  } catch (err) {
    console.error("✗ Database connection failed:", err.message);
    process.exit(1);
  }
}

// Auth Middleware
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res
      .status(401)
      .json({ success: false, message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "your-secret-key"
    );
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
};

// ==================== AUTH ROUTES ====================

// Register
app.post("/api/auth/register", async (req, res) => {
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

    const token = jwt.sign(
      { id: result.insertId, email, role },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "24h" }
    );

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
});

// Login
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email and password are required",
    });
  }

  try {
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

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "24h" }
    );

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
});

// Get current user
app.get("/api/auth/me", authMiddleware, async (req, res) => {
  try {
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
});

// ==================== TEST ROUTES ====================

// Create test
app.post("/api/tests/create", authMiddleware, async (req, res) => {
  const { title, description, time_limit, questions } = req.body;
  const created_by = req.user.id;

  if (!title || !questions || questions.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Title and at least one question are required",
    });
  }

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
});

// Get user's created tests (for employers)
app.get("/api/tests/my-tests", authMiddleware, async (req, res) => {
  try {
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
});

// Get all available tests (for candidates)
app.get("/api/tests/available", authMiddleware, async (req, res) => {
  try {
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
});

// Get test with questions (for employers/admin)
app.get("/api/tests/:id", authMiddleware, async (req, res) => {
  try {
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

    // Check authorization
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

    // Parse options for each question
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
});

// Get test for taking (without correct answers - for candidates)
// Get test for taking (without correct answers - for candidates)
app.get("/api/tests/:id/take", authMiddleware, async (req, res) => {
  try {
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
});

// Submit test answers
app.post("/api/tests/:id/submit", authMiddleware, async (req, res) => {
  const { answers } = req.body;
  const testId = req.params.id;
  const userId = req.user.id;

  if (!answers || typeof answers !== "object") {
    return res.status(400).json({
      success: false,
      message: "Answers are required",
    });
  }

  try {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      // Get test and questions
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

      // Calculate score
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

        // Store individual answer
        await connection.execute(
          "INSERT INTO answers (candidate_id, question_id, answer, is_correct) VALUES (?, ?, ?, ?)",
          [userId, question.id, userAnswer || null, isCorrect ? 1 : 0]
        );
      }

      // Calculate score based on auto-graded questions
      const score =
        totalAutoGraded > 0
          ? Math.round((correctCount / totalAutoGraded) * 100)
          : 0;

      // Determine remarks
      let remarks = "";
      if (score >= 90) remarks = "Excellent";
      else if (score >= 75) remarks = "Very Good";
      else if (score >= 60) remarks = "Good";
      else if (score >= 50) remarks = "Fair";
      else remarks = "Needs Improvement";

      // Store result
      await connection.execute(
        "INSERT INTO results (candidate_id, test_id, total_questions, correct_answers, score, remarks) VALUES (?, ?, ?, ?, ?, ?)",
        [userId, testId, totalAutoGraded, correctCount, score, remarks]
      );

      // Update candidate_tests table
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
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Error submitting test:", error);
    res.status(500).json({
      success: false,
      message: "Failed to submit test",
    });
  }
});

// Get user's test results (for candidates)
app.get("/api/results", authMiddleware, async (req, res) => {
  try {
    const [results] = await db.execute(
      `SELECT r.*, t.title, t.time_limit, t.description
       FROM results r
       JOIN tests t ON r.test_id = t.id
       WHERE r.candidate_id = ?
       ORDER BY r.taken_at DESC`,
      [req.user.id]
    );

    res.json({
      success: true,
      results,
    });
  } catch (error) {
    console.error("Error fetching results:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch results",
    });
  }
});

// Update test
app.put("/api/tests/:id", authMiddleware, async (req, res) => {
  const { title, description, time_limit, questions } = req.body;
  const testId = req.params.id;

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
});

// Delete test
app.delete("/api/tests/:id", authMiddleware, async (req, res) => {
  try {
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
});

// Get test results for specific test (for employers/admin)
app.get("/api/tests/:id/results", authMiddleware, async (req, res) => {
  try {
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
});

// ==================== ADMIN: Get all results ====================
app.get("/api/admin/results", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const [results] = await db.execute(
      `SELECT r.id, r.score, r.remarks, r.taken_at,
              t.title as test_title,
              u.name as candidate_name,
              u.email as candidate_email
       FROM results r
       JOIN tests t ON r.test_id = t.id
       JOIN users u ON r.candidate_id = u.id
       ORDER BY r.taken_at DESC`
    );

    res.json({
      success: true,
      results,
    });
  } catch (error) {
    console.error("Error fetching admin results:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch results",
    });
  }
});

// Initialize database and start server
initializeDatabase().then(() => {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`✓ Server running on port ${PORT}`);
  });
});
