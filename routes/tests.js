// backend/routes/tests.js
const express = require('express');
const router = express.Router();
const db = require('../config/database'); // Your MySQL connection
const authMiddleware = require('../middleware/auth'); // Your auth middleware

// Create a new test with questions
router.post('/create', authMiddleware, async (req, res) => {
  const { title, description, time_limit, questions } = req.body;
  const created_by = req.user.id; // From auth middleware

  // Validation
  if (!title || !questions || questions.length === 0) {
    return res.status(400).json({ 
      success: false, 
      message: 'Title and at least one question are required' 
    });
  }

  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();

    // Insert test
    const [testResult] = await connection.execute(
      'INSERT INTO tests (title, description, time_limit, created_by) VALUES (?, ?, ?, ?)',
      [title, description, time_limit, created_by]
    );

    const testId = testResult.insertId;

    // Insert questions
    for (const question of questions) {
      await connection.execute(
        'INSERT INTO questions (test_id, question_text, question_type, options, correct_answer) VALUES (?, ?, ?, ?, ?)',
        [
          testId,
          question.question_text,
          question.question_type,
          question.options,
          question.correct_answer
        ]
      );
    }

    await connection.commit();

    res.status(201).json({
      success: true,
      message: 'Test created successfully',
      testId
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error creating test:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create test' 
    });
  } finally {
    connection.release();
  }
});

// Get all tests created by the user
router.get('/my-tests', authMiddleware, async (req, res) => {
  try {
    const [tests] = await db.execute(
      `SELECT t.*, COUNT(q.id) as question_count 
       FROM tests t 
       LEFT JOIN questions q ON t.id = q.test_id 
       WHERE t.created_by = ? 
       GROUP BY t.id 
       ORDER BY t.created_at DESC`,
      [req.user.id]
    );

    res.json({ success: true, tests });
  } catch (error) {
    console.error('Error fetching tests:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch tests' 
    });
  }
});

// Get test details with questions
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const [tests] = await db.execute(
      'SELECT * FROM tests WHERE id = ?',
      [req.params.id]
    );

    if (tests.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Test not found' 
      });
    }

    const [questions] = await db.execute(
      'SELECT * FROM questions WHERE test_id = ? ORDER BY id',
      [req.params.id]
    );

    res.json({
      success: true,
      test: {
        ...tests[0],
        questions
      }
    });
  } catch (error) {
    console.error('Error fetching test:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch test' 
    });
  }
});

module.exports = router;    