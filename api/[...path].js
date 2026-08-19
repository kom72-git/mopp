const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");
const { createAuthRoutes, requireJwt, requireRole } = require("./auth");
const { registerSharedRoutes } = require("./_shared-routes");

// Mongo pripojeni se cachuje mezi volanimi v ramci stejne "teple" serverless instance.
let cachedClientPromise = null;
let cachedDb = null;
let indexesEnsured = false;

function getMongoClientPromise() {
  if (!cachedClientPromise) {
    const client = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 8000,
    });
    cachedClientPromise = client.connect();
  }
  return cachedClientPromise;
}

async function ensureDb() {
  if (cachedDb) return cachedDb;
  if (!process.env.MONGODB_URI || !process.env.MONGODB_DB_NAME || !process.env.JWT_SECRET) {
    throw new Error("MONGODB_URI, MONGODB_DB_NAME a JWT_SECRET musí být nastavené");
  }
  const client = await getMongoClientPromise();
  cachedDb = client.db(process.env.MONGODB_DB_NAME);
  if (!indexesEnsured) {
    indexesEnsured = true;
    await Promise.all([
      cachedDb.collection("users").createIndex({ username: 1 }, { unique: true }),
      cachedDb.collection("users").createIndex({ email: 1 }, { unique: true }),
      cachedDb.collection("passwordResetTokens").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      cachedDb.collection("emailVerificationTokens").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]).catch(() => {
      indexesEnsured = false;
    });
  }
  return cachedDb;
}

function getDb() {
  if (!cachedDb) throw new Error("MongoDB není připojená");
  return cachedDb;
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(async (req, res, next) => {
  try {
    await ensureDb();
    return next();
  } catch (error) {
    return res.status(500).json({ ok: false, message: error?.message || "Databáze není dostupná" });
  }
});

createAuthRoutes({ app, getDb });
registerSharedRoutes({ app, getDb, requireJwt, requireRole });

module.exports = (req, res) => app(req, res);
