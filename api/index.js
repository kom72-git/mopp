const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs/promises");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");
const { MongoClient } = require("mongodb");
const { ObjectId } = require("mongodb");
const { createAuthRoutes, getOptionalSession, requireJwt, requireRole } = require("./auth");

const app = express();
const port = process.env.PORT || 4000;
const mongoClient = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 8000,
});
let database;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

function getDb() {
  if (!database) throw new Error("MongoDB není připojená");
  return database;
}

createAuthRoutes({ app, getDb });

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "mopp-api" });
});

app.get("/api/ping", (req, res) => {
  res.json({ message: "MOPP API běží", ts: new Date().toISOString() });
});

function dbTournamentId(id) {
  return `db:${id.toString()}`;
}

function tieBreakRulesFor(order = []) {
  const labels = {
    exact: "Počet přesných výsledků za 10 bodů.",
    scored: "Celkový počet bodovaných tipů.",
    noBet: "Menší počet netipovaných výsledků N/N.",
  };
  return order.map((criterion) => labels[criterion]).filter(Boolean);
}

function scoreTip(tipPick, matchResult, scoring) {
  if (!matchResult || !/^\d+:\d+$/.test(String(matchResult))) return null;
  const [resultHome, resultAway] = matchResult.split(':').map(Number);
  const [tipHome, tipAway] = String(tipPick ?? '').split(':').map(Number);
  if (![resultHome, resultAway, tipHome, tipAway].every(Number.isFinite)) return 0;
  if (tipHome === resultHome && tipAway === resultAway) return Number(scoring?.exact) || 10;
  const resultOutcome = Math.sign(resultHome - resultAway);
  const tipOutcome = Math.sign(tipHome - tipAway);
  if (resultOutcome !== tipOutcome) return 0;
  if (tipHome === resultHome || tipAway === resultAway) return Number(scoring?.near) || 5;
  return Number(scoring?.winner) || 3;
}

async function loadMongoTournamentData(tournamentId, session) {
  const rawId = String(tournamentId).replace(/^db:/, "");
  if (!ObjectId.isValid(rawId)) throw new Error("Unknown Mongo tournament");
  const database = getDb();
  const tournament = await database.collection("tournaments").findOne({ _id: new ObjectId(rawId) });
  if (!tournament) throw new Error("Mongo tournament not found");

  const participantUserIds = (tournament.participantUserIds || []).filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const userQuery = participantUserIds.length > 0
    ? { _id: { $in: participantUserIds }, status: "active" }
    : { status: "active" };
  const users = await database.collection("users")
    .find(userQuery, { projection: { username: 1, displayName: 1 } })
    .sort({ createdAt: 1 })
    .toArray();
  const longTermBankTotal = (Number(tournament.longTermBank) || 0)
    + users.length * (Number(tournament.longTermContribution) || 0);
  const longTermBankPayouts = tournament.payouts || [];
  const matches = await database.collection("matches")
    .find({ tournamentId: tournament._id })
    .sort({ round: 1, startsAt: 1 })
    .toArray();
  const tips = await database.collection("tips").find({ matchId: { $in: matches.map((match) => match._id) } }).toArray();
  const tipsByMatch = new Map();
  const pointsByUser = new Map(users.map((user) => [user._id.toString(), 0]));
  const now = Date.now();
  const canSeeAllTipRows = session?.role === "admin";
  for (const tip of tips) {
    const match = matches.find((item) => item._id.equals(tip.matchId));
    const hasStarted = match && new Date(match.startsAt).getTime() <= now;
    if (!canSeeAllTipRows && !hasStarted && tip.userId.toString() !== session?.sub) continue;
    if (!tipsByMatch.has(tip.matchId.toString())) tipsByMatch.set(tip.matchId.toString(), []);
    const points = scoreTip(`${tip.homeScore}:${tip.awayScore}`, match?.score, tournament.scoring);
    if (Number.isFinite(points)) pointsByUser.set(tip.userId.toString(), (pointsByUser.get(tip.userId.toString()) || 0) + points);
    tipsByMatch.get(tip.matchId.toString()).push({ ...tip, points, tipValueHidden: canSeeAllTipRows && !hasStarted && tip.userId.toString() !== session?.sub });
  }

  return {
    tournament: {
      id: dbTournamentId(tournament._id),
      label: tournament.name,
      title: tournament.name,
      tabTitle: tournament.name,
      roundLabel: tournament.roundLabel || "den",
      stageLabel: tournament.stageLabel || "",
      stages: tournament.stages || [],
      scoring: tournament.scoring || { exact: 10, near: 5, winner: 3 },
      tieBreakOrder: tournament.tieBreakOrder || ["exact", "scored", "noBet"],
      heroLogo: tournament.heroLogo || "",
      startDate: tournament.startDate || "",
      endDate: tournament.endDate || "",
      entryFee: tournament.entryFee || 10,
      longTermContribution: tournament.longTermContribution || 0,
      source: "mongodb",
      logoSet: tournament.logoSet || null,
      longTermBank: { totalAmount: longTermBankTotal, baseAmount: tournament.longTermBank || 0, contributionAmount: tournament.longTermContribution || 0, contributorCount: users.length, payouts: longTermBankPayouts, tieBreakHeading: "V případě shodného počtu bodů rozhoduje:", tieBreakRules: tournament.tieBreakRules?.length ? tournament.tieBreakRules : tieBreakRulesFor(tournament.tieBreakOrder || []) },
    },
    players: users.map((user) => ({ id: user._id.toString(), name: user.displayName || user.username, points: pointsByUser.get(user._id.toString()) || 0 })),
    matches: matches.map((match) => ({
      id: match._id.toString(),
      round: match.round,
      startsAt: match.startsAt,
      home: match.home,
      away: match.away,
      score: match.score || null,
      bank: match.bank || 0,
      tipCount: tips.filter((tip) => tip.matchId.equals(match._id)).length,
      playerCount: users.length,
      tipsVisible: new Date(match.startsAt).getTime() <= now,
      ownTip: session ? (() => {
        const tip = tips.find((item) => item.matchId.equals(match._id) && item.userId.toString() === session.sub);
        return tip ? { homeScore: tip.homeScore, awayScore: tip.awayScore } : null;
      })() : null,
      tips: (tipsByMatch.get(match._id.toString()) || []).map((tip) => ({
        playerId: tip.userId.toString(),
        pick: tip.tipValueHidden ? null : `${tip.homeScore}:${tip.awayScore}`,
        tipValueHidden: Boolean(tip.tipValueHidden),
        points: tip.points,
        updatedAt: tip.updatedAt || null,
        updatedState: tip.updatedState || "updated",
      })),
    })),
  };
}

app.get("/api/tournaments", async (req, res) => {
  try {
    const db = getDb();
    const [rows, activeUsers] = await Promise.all([
      db.collection("tournaments").find({}).sort({ createdAt: -1 }).toArray(),
      db.collection("users").find({ status: "active" }, { projection: { _id: 1 } }).toArray(),
    ]);
    return res.json({ ok: true, tournaments: rows.map((tournament) => ({
      id: dbTournamentId(tournament._id),
      label: tournament.name,
      title: tournament.name,
      tabTitle: tournament.name,
      roundLabel: tournament.roundLabel || "den",
      stageLabel: tournament.stageLabel || "",
      stages: tournament.stages || [],
      scoring: tournament.scoring || { exact: 10, near: 5, winner: 3 },
      tieBreakOrder: tournament.tieBreakOrder || ["exact", "scored", "noBet"],
      heroLogo: tournament.heroLogo || "",
      startDate: tournament.startDate || "",
      endDate: tournament.endDate || "",
      entryFee: tournament.entryFee || 10,
      longTermContribution: tournament.longTermContribution || 0,
      source: "mongodb",
      logoSet: tournament.logoSet || null,
      status: tournament.status,
      longTermBank: (() => {
        const participantIds = (tournament.participantUserIds || []).map(String);
        const contributorCount = participantIds.length > 0
          ? activeUsers.filter((user) => participantIds.includes(user._id.toString())).length
          : activeUsers.length;
        const baseAmount = Number(tournament.longTermBank) || 0;
        const contributionAmount = Number(tournament.longTermContribution) || 0;
        return { totalAmount: baseAmount + contributorCount * contributionAmount, baseAmount, contributionAmount, contributorCount, payouts: tournament.payouts || [], tieBreakHeading: "V případě shodného počtu bodů rozhoduje:", tieBreakRules: tournament.tieBreakRules?.length ? tournament.tieBreakRules : tieBreakRulesFor(tournament.tieBreakOrder || []) };
      })(),
    })) });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error?.message || "Turnaje nejsou dostupné" });
  }
});

app.get("/api/admin/assets/tournament-logos", requireJwt, requireRole("admin"), async (req, res) => {
  try {
    const directory = path.resolve(__dirname, "../public/tournaments");
    const files = await fs.readdir(directory);
    const logos = files
      .filter((file) => /\.(png|jpe?g|webp|svg)$/i.test(file))
      .sort()
      .map((file) => ({ name: file, path: `/tournaments/${file}` }));
    return res.json({ ok: true, logos });
  } catch {
    return res.status(500).json({ ok: false, message: "Loga turnajů se nepodařilo načíst" });
  }
});

async function loadSheetDataModule() {
  const modulePath = path.resolve(__dirname, "../scripts/sheet-data.mjs");
  const tournamentsPath = path.resolve(__dirname, "../src/data/tournaments.js");
  const [moduleStats, tournamentsStats] = await Promise.all([
    fs.stat(modulePath),
    fs.stat(tournamentsPath),
  ]);
  const version = `${moduleStats.mtimeMs}-${tournamentsStats.mtimeMs}`;
  const moduleUrl = `${pathToFileURL(modulePath).href}?v=${version}`;
  return import(moduleUrl);
}

app.get("/api/data", async (req, res) => {
  try {
    const tournamentId = typeof req.query?.tournament === "string" ? req.query.tournament : undefined;
    if (tournamentId?.startsWith("db:")) {
      return res.json({ ok: true, tournamentId, ...(await loadMongoTournamentData(tournamentId, getOptionalSession(req))) });
    }
    const { fetchSheetData } = await loadSheetDataModule();
    const data = await fetchSheetData({ tournamentId });
    res.set("Cache-Control", "no-store");
    return res.json({ ok: true, tournamentId: tournamentId ?? null, ...data });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error?.message || "Nepodařilo se načíst data z Google Sheetu",
    });
  }
});

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
