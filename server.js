// server.js
const app = require("./app");
const database = require("./config/database");

async function startServer() {
  try {
    await database.initialize();

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`✓ Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();