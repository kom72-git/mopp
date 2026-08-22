const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const { spawn } = require("child_process");
const { MongoClient } = require("mongodb");
const { createAuthRoutes, requireJwt, requireRole } = require("./_auth");
const { registerSharedRoutes } = require("./_shared-routes");

const app = express();
const port = process.env.PORT || 4000;
const mongoClient = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 8000,
});
let database;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "128kb" }));

function getDb() {
  if (!database) throw new Error("MongoDB není připojená");
  return database;
}

createAuthRoutes({ app, getDb });
registerSharedRoutes({ app, getDb, requireJwt, requireRole });

app.post("/api/sync-sheet", (req, res) => {
  const scriptPath = path.resolve(__dirname, "../scripts/sync-sheet.mjs");
  const child = spawn("node", [scriptPath, "--json"], {
    cwd: path.resolve(__dirname, ".."),
    env: process.env,
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });

  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  child.on("close", (code) => {
    if (code !== 0) {
      return res.status(500).json({
        ok: false,
        message: stderr.trim() || stdout.trim() || `Sync failed with exit code ${code}`,
      });
    }

    try {
      const payload = JSON.parse(stdout.trim());
      return res.json(payload);
    } catch {
      return res.status(500).json({
        ok: false,
        message: "Sync finished but API response could not be parsed",
      });
    }
  });
});

async function start() {
  if (!process.env.MONGODB_URI || !process.env.MONGODB_DB_NAME || !process.env.JWT_SECRET) {
    throw new Error("MONGODB_URI, MONGODB_DB_NAME a JWT_SECRET musí být nastavené");
  }

  await mongoClient.connect();
  database = mongoClient.db(process.env.MONGODB_DB_NAME);
  await database.collection("users").createIndex({ username: 1 }, { unique: true });
  await database.collection("users").createIndex({ email: 1 }, { unique: true });
  await database.collection("passwordResetTokens").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await database.collection("emailVerificationTokens").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  app.listen(port, () => {
    console.log(`MOPP API listening on http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error(`MOPP API start failed: ${error.message}`);
  process.exit(1);
});
