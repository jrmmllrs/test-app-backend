// controllers/testController.js
const database = require("../config/database");
const EmailService = require("../services/emailService");

class TestController {
  // New endpoint: Check test status for candidate
  async getTestStatus(req, res) {
    try {
      const db = database.getPool();
      const testId = req.params.id;
      const userId = req.user.id;

      // Check if test has been completed
      const [results] = await db.execute(
        `SELECT id, score, taken_at FROM results 
         WHERE candidate_id = ? AND test_id = ?`,
        [userId, testId]
      );

      if (results.length > 0) {
        return res.json({
          success: true,
          status: "completed",
          result: results[0],
        });
      }

      // Check if test is in progress
      const [candidateTests] = await db.execute(
        `SELECT start_time, saved_answers, time_remaining 
         FROM candidates_tests 
         WHERE candidate_id = ? AND test_id = ? AND status = 'in_progress'`,
        [userId, testId]
      );

      if (candidateTests.length > 0) {
        const ct = candidateTests[0];
        return res.json({
          success: true,
          status: "in_progress",
          start_time: ct.start_time,
          time_remaining: ct.time_remaining,
          saved_answers: ct.saved_answers ? JSON.parse(ct.saved_answers) : {},
        });
      }

      // Test not started yet
      res.json({
        success: true,
        status: "not_started",
      });
    } catch (error) {
      console.error("Error checking test status:", error);
      res.status(500).json({
        success: false,
        message: "Failed to check test status",
      });
    }
  }

  async saveProgress(req, res) {
    try {
      const db = database.getPool();
      const testId = req.params.id;
      const userId = req.user.id;
      const { answers, time_remaining } = req.body;

      console.log("Saving progress with time_remaining:", time_remaining);

      // Validate time_remaining
      if (time_remaining === undefined || time_remaining === null || time_remaining < 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid time_remaining value",
        });
      }

      // Get test details
      const [tests] = await db.execute(
        "SELECT time_limit FROM tests WHERE id = ?",
        [testId]
      );

      if (tests.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Test not found",
        });
      }

      // Check if record exists
      const [existingRecord] = await db.execute(
        `SELECT id, start_time FROM candidates_tests 
         WHERE candidate_id = ? AND test_id = ?`,
        [userId, testId]
      );

      if (existingRecord.length > 0) {
        // Update existing record
        await db.execute(
          `UPDATE candidates_tests 
           SET saved_answers = ?, time_remaining = ?, status = 'in_progress'
           WHERE candidate_id = ? AND test_id = ?`,
          [
            JSON.stringify(answers),
            time_remaining,
            userId,
            testId
          ]
        );
      } else {
        // Insert new record
        await db.execute(
          `INSERT INTO candidates_tests 
           (candidate_id, test_id, start_time, saved_answers, time_remaining, status) 
           VALUES (?, ?, NOW(), ?, ?, 'in_progress')`,
          [
            userId,
            testId,
            JSON.stringify(answers),
            time_remaining
          ]
        );
      }

      console.log("Progress saved successfully with time:", time_remaining);

      res.json({
        success: true,
        message: "Progress saved",
        time_remaining: time_remaining,
      });
    } catch (error) {
      console.error("Error saving progress:", error);
      res.status(500).json({
        success: false,
        message: "Failed to save progress",
      });
    }
  }

  async create(req, res) {
    const { 
      title, 
      description, 
      time_limit, 
      questions,
      enable_proctoring = true,
      max_tab_switches = 3,
      allow_copy_paste = false,
      require_fullscreen = true
    } = req.body;
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
        `INSERT INTO tests (title, description, time_limit, created_by, 
         enable_proctoring, max_tab_switches, allow_copy_paste, require_fullscreen) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          title, 
          description || null, 
          time_limit || 30, 
          created_by,
          enable_proctoring ? 1 : 0,
          max_tab_switches,
          allow_copy_paste ? 1 : 0,
          require_fullscreen ? 1 : 0
        ]
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
                t.enable_proctoring, t.max_tab_switches,
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
      const userId = req.user.id;
      
      // First get all tests
      const [tests] = await db.execute(
        `SELECT t.id, t.title, t.description, t.time_limit, t.created_at,
                t.enable_proctoring, u.name as created_by_name
         FROM tests t 
         LEFT JOIN users u ON t.created_by = u.id
         ORDER BY t.created_at DESC`
      );

      // Then enrich with question count and status for each test
      const enrichedTests = await Promise.all(
        tests.map(async (test) => {
          // Get question count
          const [questions] = await db.execute(
            'SELECT COUNT(*) as count FROM questions WHERE test_id = ?',
            [test.id]
          );

          // Check if completed
          const [results] = await db.execute(
            'SELECT id FROM results WHERE test_id = ? AND candidate_id = ?',
            [test.id, userId]
          );

          // Check if in progress
          const [candidateTests] = await db.execute(
            'SELECT status FROM candidates_tests WHERE test_id = ? AND candidate_id = ?',
            [test.id, userId]
          );

          return {
            ...test,
            question_count: questions[0].count,
            is_completed: results.length > 0,
            is_in_progress: candidateTests.length > 0 && candidateTests[0].status === 'in_progress'
          };
        })
      );

      res.json({
        success: true,
        tests: enrichedTests,
      });
    } catch (error) {
      console.error("Error fetching tests:", error);
      console.error("Error details:", error.stack);
      res.status(500).json({
        success: false,
        message: "Failed to fetch tests",
        error: error.message
      });
    }
  }

  // FIXED: Parse options correctly whether they're JSON or comma-separated strings
  parseOptions(options) {
    if (!options) return [];
    
    // If it's already an array, return it
    if (Array.isArray(options)) return options;
    
    // If it's a string
    if (typeof options === 'string') {
      // Try to parse as JSON first
      if (options.startsWith('[') || options.startsWith('{')) {
        try {
          return JSON.parse(options);
        } catch (e) {
          // If JSON parse fails, fall through to comma-separated
        }
      }
      
      // Parse as comma-separated string
      return options.split(',').map(opt => opt.trim()).filter(opt => opt.length > 0);
    }
    
    return [];
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

      // FIXED: Use parseOptions helper to handle both formats
      const parsedQuestions = questions.map((q) => ({
        ...q,
        options: this.parseOptions(q.options),
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
      const userId = req.user.id;
      const testId = req.params.id;

      // Check if already completed
      const [results] = await db.execute(
        "SELECT id FROM results WHERE candidate_id = ? AND test_id = ?",
        [userId, testId]
      );

      if (results.length > 0) {
        return res.status(403).json({
          success: false,
          message: "You have already completed this test.",
        });
      }

      const [tests] = await db.execute(
        "SELECT id, title, description, time_limit FROM tests WHERE id = ?",
        [testId]
      );

      if (tests.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Test not found",
        });
      }

      const [questions] = await db.execute(
        "SELECT id, question_text, question_type, options FROM questions WHERE test_id = ? ORDER BY id",
        [testId]
      );

      // FIXED: Use parseOptions helper
      const parsedQuestions = questions.map((q) => ({
        ...q,
        options: this.parseOptions(q.options),
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

      // Check if already completed
      const [existingResults] = await connection.execute(
        "SELECT id FROM results WHERE candidate_id = ? AND test_id = ?",
        [userId, testId]
      );

      if (existingResults.length > 0) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          message: "You have already submitted this test.",
        });
      }

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

      // Update candidates_tests to completed status
      await connection.execute(
        `INSERT INTO candidates_tests (candidate_id, test_id, start_time, end_time, score, status) 
         VALUES (?, ?, NOW(), NOW(), ?, 'completed') 
         ON DUPLICATE KEY UPDATE end_time = NOW(), score = ?, status = 'completed', saved_answers = NULL, time_remaining = NULL`,
        [userId, testId, score, score]
      );

      await connection.commit();

      // Send completion email & update invitation
      try {
        const [users] = await db.execute(
          'SELECT name, email FROM users WHERE id = ?', 
          [userId]
        );
        
        if (users.length > 0) {
          const user = users[0];
          const test = tests[0];
          
          await EmailService.sendCompletionNotification(
            user.email,
            user.name,
            test.title,
            {
              completionTime: new Date().toLocaleString(),
              totalQuestions: totalAutoGraded,
              correctAnswers: correctCount,
              score: score,
              remarks: remarks
            },
            db
          );
          
          await db.execute(
            'UPDATE test_invitations SET status = ?, completed_at = NOW() WHERE candidate_email = ? AND test_id = ? AND status != ?',
            ['completed', user.email, testId, 'completed']
          );
        }
      } catch (emailError) {
        console.error('Error sending completion email:', emailError);
      }

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
    const { 
      title, 
      description, 
      time_limit, 
      questions,
      enable_proctoring,
      max_tab_switches,
      allow_copy_paste,
      require_fullscreen
    } = req.body;
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
          `UPDATE tests SET title = ?, description = ?, time_limit = ?,
           enable_proctoring = ?, max_tab_switches = ?, allow_copy_paste = ?, require_fullscreen = ?
           WHERE id = ?`,
          [
            title, 
            description || null, 
            time_limit || 30,
            enable_proctoring !== undefined ? (enable_proctoring ? 1 : 0) : 1,
            max_tab_switches !== undefined ? max_tab_switches : 3,
            allow_copy_paste !== undefined ? (allow_copy_paste ? 1 : 0) : 0,
            require_fullscreen !== undefined ? (require_fullscreen ? 1 : 0) : 1,
            testId
          ]
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
        `SELECT r.*, u.name as candidate_name, u.email as candidate_email,
                ct.tab_switch_count, ct.violation_count, ct.flagged
         FROM results r
         JOIN users u ON r.candidate_id = u.id
         LEFT JOIN candidates_tests ct ON r.candidate_id = ct.candidate_id AND r.test_id = ct.test_id
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