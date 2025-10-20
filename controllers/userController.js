const bcrypt = require('bcryptjs');
const database = require('../config/database');

const userController = {
  // Get all users
  getAllUsers: async (req, res) => {
    try {
      const db = database.getPool();
      
      const [users] = await db.query(
        `SELECT id, name, email, role, created_at 
         FROM users 
         ORDER BY created_at DESC`
      );

      res.json({
        success: true,
        users: users
      });
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch users'
      });
    }
  },

  // Create new user
  createUser: async (req, res) => {
    try {
      const { name, email, password, role } = req.body;
      const db = database.getPool();

      // Validation
      if (!name || !email || !password) {
        return res.status(400).json({
          success: false,
          message: 'Name, email, and password are required'
        });
      }

      // Validate role
      const validRoles = ['admin', 'employer', 'candidate'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid role'
        });
      }

      // Check if email already exists
      const [existingUser] = await db.query(
        'SELECT id FROM users WHERE email = ?',
        [email]
      );

      if (existingUser.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Email already exists'
        });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Insert user
      const [result] = await db.query(
        'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
        [name, email, hashedPassword, role]
      );

      res.status(201).json({
        success: true,
        message: 'User created successfully',
        userId: result.insertId
      });
    } catch (error) {
      console.error('Error creating user:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create user'
      });
    }
  },

  // Update user
  updateUser: async (req, res) => {
    try {
      const { id } = req.params;
      const { name, email, password, role } = req.body;
      const db = database.getPool();

      // Validation
      if (!name || !email) {
        return res.status(400).json({
          success: false,
          message: 'Name and email are required'
        });
      }

      // Validate role
      const validRoles = ['admin', 'employer', 'candidate'];
      if (role && !validRoles.includes(role)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid role'
        });
      }

      // Check if user exists
      const [user] = await db.query(
        'SELECT id FROM users WHERE id = ?',
        [id]
      );

      if (user.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Check if email is taken by another user
      const [emailCheck] = await db.query(
        'SELECT id FROM users WHERE email = ? AND id != ?',
        [email, id]
      );

      if (emailCheck.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Email already exists'
        });
      }

      // Build update query
      let updateQuery = 'UPDATE users SET name = ?, email = ?, role = ?';
      let params = [name, email, role];

      // If password is provided, hash and update it
      if (password && password.trim() !== '') {
        const hashedPassword = await bcrypt.hash(password, 10);
        updateQuery += ', password = ?';
        params.push(hashedPassword);
      }

      updateQuery += ' WHERE id = ?';
      params.push(id);

      await db.query(updateQuery, params);

      res.json({
        success: true,
        message: 'User updated successfully'
      });
    } catch (error) {
      console.error('Error updating user:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update user'
      });
    }
  },

  // Delete user
  deleteUser: async (req, res) => {
    try {
      const { id } = req.params;
      const db = database.getPool();

      // Check if user exists
      const [user] = await db.query(
        'SELECT id, email FROM users WHERE id = ?',
        [id]
      );

      if (user.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Prevent deleting yourself
      if (parseInt(id) === req.user.id) {
        return res.status(400).json({
          success: false,
          message: 'You cannot delete your own account'
        });
      }

      // Delete user (cascade will handle related records)
      await db.query('DELETE FROM users WHERE id = ?', [id]);

      res.json({
        success: true,
        message: 'User deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting user:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete user'
      });
    }
  }
};

module.exports = userController;