const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

let isHealthy = true; // default state

// Root endpoint
app.get("/", (req, res) => {
  res.send("Hello from DevSecOps App 🚀...You can now Deploy you Application");
});

// Health check endpoint
app.get("/health", (req, res) => {
  if (isHealthy) {
    res.status(200).json({ status: "healthy" });
  } else {
    res.status(500).json({ status: "unhealthy" });
  }
});

// Toggle health state (used for tests)
app.post("/toggle-health", (req, res) => {
  isHealthy = req.body.healthy;
  res.json({ updated: isHealthy });
});

// Start server
const server = {
  start: (port) => {
    if (
      typeof port !== "number" ||
      isNaN(port) ||
      port <= 0 ||
      port >= 65536 ||
      !Number.isInteger(port)
    ) {
      throw new Error("Invalid port number");
    }

    return new Promise((resolve) => {
      const instance = app.listen(port, () => {
        console.log(`Server running on http://localhost:${port}`);
        resolve(instance); // return actual instance
      });
    });
  },
};

module.exports = { app, server };

// If this file is run directly, start the server on port 3000
if (require.main === module) {
  server.start(3000);
}
