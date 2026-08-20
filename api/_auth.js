const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { ObjectId } = require("mongodb");
const nodemailer = require("nodemailer");
const cheerio = require("cheerio");

const COOKIE_NAME = "mopp_session";
const SESSION_TTL = "7d";

function publicUser(user) {
  return {
    id: user._id.toString(),
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
  };
}

function signSession(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: SESSION_TTL },
  );
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  };
}

function setSessionCookie(res, user) {
  res.cookie(COOKIE_NAME, signSession(user), sessionCookieOptions());
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "lax", path: "/" });
}

function readSessionToken(req) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);

  const cookies = String(req.headers.cookie ?? "")
    .split(";")
    .map((item) => item.trim())
    .map((item) => {
      const separator = item.indexOf("=");
      return separator < 0 ? [item, ""] : [item.slice(0, separator), item.slice(separator + 1)];
    })
    .filter(([name]) => name);
  const value = cookies.find(([name]) => name === COOKIE_NAME)?.[1] ?? "";
  return decodeURIComponent(value);
}

function requireJwt(req, res, next) {
  try {
    if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not configured");
    req.session = jwt.verify(readSessionToken(req), process.env.JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ ok: false, message: "Přihlášení je nutné" });
  }
}

function getOptionalSession(req) {
  try {
    if (!process.env.JWT_SECRET) return null;
    return jwt.verify(readSessionToken(req), process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.session?.role !== role) {
      return res.status(403).json({ ok: false, message: "Nemáš potřebné oprávnění" });
    }
    return next();
  };
}

function validateRegistration(body) {
  const email = String(body?.email ?? "").trim().toLowerCase();
  const username = String(body?.username ?? email.split("@")[0] ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const confirmPassword = String(body?.confirmPassword ?? "");
  const displayName = String(body?.displayName ?? username).trim();

  if (!/^[a-z0-9_.-]{3,30}$/.test(username)) {
    return { error: "Uživatelské jméno musí mít 3 až 30 znaků." };
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return { error: "Zadej platný e-mail." };
  }
  if (password.length < 8) {
    return { error: "Heslo musí mít alespoň 8 znaků." };
  }
  if (password !== confirmPassword) {
    return { error: "Hesla se neshodují." };
  }
  if (displayName.length < 1 || displayName.length > 60) {
    return { error: "Jméno musí mít 1 až 60 znaků." };
  }

  return { value: { username, email, password, displayName } };
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function sendVerificationEmail({ email, token }) {
  const appUrl = process.env.APP_URL || "http://localhost:4173";
  const verificationUrl = `${appUrl}/?verify=${encodeURIComponent(token)}`;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD || !process.env.MAIL_FROM) {
    return { verificationUrl, sent: false };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 465,
    secure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    tls: { rejectUnauthorized: String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED).toLowerCase() !== "false" },
  });
  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to: email,
    subject: "Ověření účtu MOPP",
    text: `Pro aktivaci účtu na MOPP (Master of PP) klikni na tento odkaz:\n\n${verificationUrl}`,
    html: `<p>Pro aktivaci účtu na MOPP (Master of PP) klikni na tento odkaz:</p><p><a href="${verificationUrl}">Ověřit e-mail</a></p>`,
  });
  return { verificationUrl, sent: true };
}

function validateNewPassword(password) {
  if (String(password ?? "").length < 8) return "Heslo musí mít alespoň 8 znaků.";
  return "";
}

async function importScheduleFromUrl(db, tournamentId, scheduleUrl) {
  const parsedUrl = new URL(scheduleUrl);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error("URL rozpisu musí začínat http:// nebo https://");
  const response = await fetch(parsedUrl, { headers: { "user-agent": "MOPP schedule importer/1.0" } });
  if (!response.ok) throw new Error(`Zdroj rozpisu vrátil HTTP ${response.status}`);
  const html = await response.text();
  const $ = cheerio.load(html);
  const importedAt = new Date();
  const importedMatches = [];
  const year = Number(String(new URLSearchParams(parsedUrl.search).get('matchList-filter-season') || new Date().getFullYear()));

  $('.showcase-matches').each((showcaseIndex, showcase) => {
    const headingText = $(showcase).prevAll('h1, h2, h3, h4').first().text().replace(/\s+/g, ' ').trim();
    const roundMatch = headingText.match(/(\d+)\.\s*kolo/i);
    const round = roundMatch ? Number(roundMatch[1]) : null;
    if (!round) return;
    $(showcase).find('tr').each((rowIndex, row) => {
      const names = $(row).find('.preview__name--medium').map((_, element) => $(element).text().replace(/\s+/g, ' ').trim()).get();
      const parts = $(row).find('.preview__desktop .col-1_3').map((_, element) => $(element).text().replace(/\s+/g, ' ').trim()).get();
      if (names.length < 2 || parts.length < 3) return;
      const dateMatch = parts[1].match(/^(\d{1,2})\.\s*(\d{1,2})\.$/);
      const timeMatch = parts[2].match(/^(\d{1,2}):(\d{2})$/);
      if (!dateMatch || !timeMatch) return;
      const sourceKey = `${round}-${names[0]}-${names[1]}-${year}-${dateMatch[1]}-${dateMatch[2]}-${timeMatch[1]}-${timeMatch[2]}`;
      importedMatches.push({ tournamentId, sourceKey, round, startsAt: `${year}-${String(dateMatch[2]).padStart(2, '0')}-${String(dateMatch[1]).padStart(2, '0')}T${String(timeMatch[1]).padStart(2, '0')}:${timeMatch[2]}`, home: names[0], away: names[1], sourceUrl: scheduleUrl, importedAt });
    });
  });

  if (importedMatches.length === 0) throw new Error("Ve zdroji se nepodařilo najít žádné zápasy.");
  await db.collection("scheduleMatches").deleteMany({ tournamentId });
  await db.collection("scheduleMatches").insertMany(importedMatches);
  return { importedAt, matches: importedMatches };
}

async function recalculateAutomaticBanks(db, tournamentId) {
  const tournament = await db.collection("tournaments").findOne({ _id: tournamentId }, { projection: { participantUserIds: 1 } });
  const matches = await db.collection("matches")
    .find({ tournamentId })
    .sort({ round: 1, startsAt: 1 })
    .toArray();
  const tips = await db.collection("tips").find({ matchId: { $in: matches.map((match) => match._id) } }).toArray();
  const tipsByMatchId = new Map();
  for (const tip of tips) {
    const key = tip.matchId.toString();
    if (!tipsByMatchId.has(key)) tipsByMatchId.set(key, []);
    tipsByMatchId.get(key).push(tip);
  }
  function hasExactWinner(match) {
    if (!match.score) return false;
    const matchTips = tipsByMatchId.get(match._id.toString()) ?? [];
    return matchTips.some((tip) => `${tip.homeScore}:${tip.awayScore}` === match.score);
  }

  let carriedBank = 0;
  const participantUserIds = (tournament?.participantUserIds ?? []).filter((id) => ObjectId.isValid(id));
  const playerQuery = participantUserIds.length > 0
    ? { _id: { $in: participantUserIds.map((id) => new ObjectId(id)) }, status: "active" }
    : { status: "active" };
  const playerCount = await db.collection("users").countDocuments(playerQuery);

  for (const match of matches) {
    if (match.bankSource === "manual") {
      carriedBank = match.score ? (hasExactWinner(match) ? 0 : Number(match.bank) || 0) : carriedBank;
      continue;
    }

    const entryFee = Number(match.entryFee) || 10;
    const baseBank = playerCount * entryFee;

    if (carriedBank === null) {
      // Predchozi zapas jeste nema vysledek, bank tohoto kola zatim neni znamy.
      await db.collection("matches").updateOne(
        { _id: match._id },
        { $set: { bank: null, baseBank, carriedBank: null, playerCount, entryFee, updatedAt: new Date() } },
      );
      continue;
    }

    const bank = baseBank + carriedBank;
    await db.collection("matches").updateOne(
      { _id: match._id },
      { $set: { bank, baseBank, carriedBank, playerCount, entryFee, updatedAt: new Date() } },
    );
    carriedBank = !match.score ? null : (hasExactWinner(match) ? 0 : bank);
  }
}

async function getTournamentParticipants(db, tournament) {
  const participantIds = (tournament.participantUserIds ?? []).filter((id) => ObjectId.isValid(String(id))).map(String);
  const query = participantIds.length > 0
    ? { _id: { $in: participantIds.map((id) => new ObjectId(id)) }, status: "active" }
    : { status: "active" };
  return db.collection("users").find(query, { projection: { username: 1, displayName: 1, createdAt: 1 } }).sort({ createdAt: 1 }).toArray();
}


function createAuthRoutes({ app, getDb }) {
  app.post("/api/auth/register", async (req, res) => {
    try {
      const validated = validateRegistration(req.body);
      if (validated.error) return res.status(400).json({ ok: false, message: validated.error });

      const { username, email, password, displayName } = validated.value;
      const users = getDb().collection("users");
      const existing = await users.findOne({ $or: [{ username }, { email }] });
      if (existing) {
        return res.status(409).json({ ok: false, message: "Uživatelské jméno nebo e-mail už existuje" });
      }

      const now = new Date();
      const user = {
        username,
        email,
        displayName,
        passwordHash: await bcrypt.hash(password, 12),
        role: "player",
        status: "pending",
        createdAt: now,
        updatedAt: now,
      };
      const result = await users.insertOne(user);
      user._id = result.insertedId;
      const token = crypto.randomBytes(32).toString("hex");
      const emailResult = await getDb().collection("emailVerificationTokens").insertOne({
        userId: user._id,
        tokenHash: hashResetToken(token),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        createdAt: now,
      }).then(async () => sendVerificationEmail({ email, token }));
      const response = { ok: true, message: "Účet byl založen. Ověř e-mail pro aktivaci účtu." };
      if (!emailResult.sent && process.env.NODE_ENV !== "production") response.devVerificationToken = token;
      return res.status(201).json(response);
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({ ok: false, message: "Uživatelské jméno nebo e-mail už existuje" });
      }
      return res.status(500).json({ ok: false, message: "Registrace se nepodařila" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const usernameOrEmail = String(req.body?.usernameOrEmail ?? "").trim().toLowerCase();
      const password = String(req.body?.password ?? "");
      const user = await getDb().collection("users").findOne({
        $or: [{ username: usernameOrEmail }, { email: usernameOrEmail }],
      });

      if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        return res.status(401).json({ ok: false, message: "Neplatné přihlašovací údaje" });
      }
      if (user.status !== "active") return res.status(403).json({ ok: false, message: "Nejdřív ověř e-mail účtu" });

      setSessionCookie(res, user);
      return res.json({ ok: true, user: publicUser(user) });
    } catch {
      return res.status(500).json({ ok: false, message: "Přihlášení se nepodařilo" });
    }
  });

  app.post("/api/auth/verify-email", async (req, res) => {
    try {
      const token = String(req.body?.token ?? "").trim();
      const tokens = getDb().collection("emailVerificationTokens");
      const verification = await tokens.findOne({ tokenHash: hashResetToken(token), expiresAt: { $gt: new Date() } });
      if (!verification) return res.status(400).json({ ok: false, message: "Ověřovací odkaz není platný nebo vypršel." });
      const result = await getDb().collection("users").updateOne(
        { _id: new ObjectId(verification.userId), status: "pending" },
        { $set: { status: "active", updatedAt: new Date() } },
      );
      await tokens.deleteOne({ _id: verification._id });
      if (result.modifiedCount !== 1) return res.status(400).json({ ok: false, message: "Účet už byl ověřen nebo nebyl nalezen." });
      const user = await getDb().collection("users").findOne({ _id: new ObjectId(verification.userId) });
      const tournamentIds = await getDb().collection("matches").distinct("tournamentId");
      await Promise.all(tournamentIds.map((tournamentId) => recalculateAutomaticBanks(getDb(), tournamentId)));
      setSessionCookie(res, user);
      return res.json({ ok: true, user: publicUser(user), message: "E-mail byl ověřen a účet aktivován." });
    } catch {
      return res.status(400).json({ ok: false, message: "Ověřovací odkaz není platný." });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    clearSessionCookie(res);
    return res.json({ ok: true });
  });

  app.patch("/api/auth/profile", requireJwt, async (req, res) => {
    try {
      const displayName = String(req.body?.displayName ?? "").trim();
      if (displayName.length < 1 || displayName.length > 60) {
        return res.status(400).json({ ok: false, message: "Zobrazované jméno musí mít 1 až 60 znaků." });
      }
      const result = await getDb().collection("users").findOneAndUpdate(
        { _id: new ObjectId(req.session.sub), status: "active" },
        { $set: { displayName, updatedAt: new Date() } },
        { returnDocument: "after" },
      );
      if (!result) return res.status(404).json({ ok: false, message: "Účet nebyl nalezen." });
      return res.json({ ok: true, user: publicUser(result), message: "Zobrazované jméno bylo změněno." });
    } catch {
      return res.status(500).json({ ok: false, message: "Zobrazované jméno se nepodařilo změnit" });
    }
  });

  app.post("/api/auth/change-password", requireJwt, async (req, res) => {
    try {
      const currentPassword = String(req.body?.currentPassword ?? "");
      const newPassword = String(req.body?.newPassword ?? "");
      const confirmPassword = String(req.body?.confirmPassword ?? "");
      const user = await getDb().collection("users").findOne({ _id: new ObjectId(req.session.sub), status: "active" });
      if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
        return res.status(400).json({ ok: false, message: "Současné heslo není správné." });
      }
      const passwordError = validateNewPassword(newPassword);
      if (passwordError) return res.status(400).json({ ok: false, message: passwordError });
      if (newPassword !== confirmPassword) return res.status(400).json({ ok: false, message: "Hesla se neshodují." });
      const passwordHash = await bcrypt.hash(newPassword, 12);
      await getDb().collection("users").updateOne(
        { _id: user._id },
        { $set: { passwordHash, updatedAt: new Date() } },
      );
      return res.json({ ok: true, message: "Heslo bylo změněno." });
    } catch {
      return res.status(500).json({ ok: false, message: "Heslo se nepodařilo změnit" });
    }
  });

  app.post("/api/auth/forgot-password", async (req, res) => {
    const response = { ok: true, message: "Pokud účet existuje, pošleme instrukce k obnovení hesla." };

    try {
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ ok: false, message: "Zadej platný e-mail." });

      const user = await getDb().collection("users").findOne({ email, status: "active" });
      if (!user) return res.json(response);

      const token = crypto.randomBytes(32).toString("hex");
      await getDb().collection("passwordResetTokens").deleteMany({ userId: user._id });
      await getDb().collection("passwordResetTokens").insertOne({
        userId: user._id,
        tokenHash: hashResetToken(token),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        createdAt: new Date(),
      });

      if (process.env.NODE_ENV !== "production") {
        return res.json({ ...response, devResetToken: token });
      }
      return res.json(response);
    } catch {
      return res.json(response);
    }
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const token = String(req.body?.token ?? "").trim();
      const password = String(req.body?.password ?? "");
      const passwordError = validateNewPassword(password);
      if (!token) return res.status(400).json({ ok: false, message: "Resetovací odkaz není platný." });
      if (passwordError) return res.status(400).json({ ok: false, message: passwordError });

      const tokens = getDb().collection("passwordResetTokens");
      const reset = await tokens.findOne({ tokenHash: hashResetToken(token), expiresAt: { $gt: new Date() } });
      if (!reset) return res.status(400).json({ ok: false, message: "Resetovací odkaz není platný nebo vypršel." });

      const passwordHash = await bcrypt.hash(password, 12);
      const result = await getDb().collection("users").updateOne(
        { _id: new ObjectId(reset.userId) },
        { $set: { passwordHash, updatedAt: new Date() } },
      );
      await tokens.deleteOne({ _id: reset._id });
      if (result.matchedCount !== 1) return res.status(400).json({ ok: false, message: "Účet nebyl nalezen." });
      return res.json({ ok: true, message: "Heslo bylo změněno." });
    } catch {
      return res.status(400).json({ ok: false, message: "Resetovací odkaz není platný." });
    }
  });

  app.get("/api/auth/me", requireJwt, async (req, res) => {
    try {
      const user = await getDb().collection("users").findOne({ _id: new ObjectId(req.session.sub) });
      if (!user || user.status !== "active") return res.status(401).json({ ok: false, message: "Účet není aktivní" });
      return res.json({ ok: true, user: publicUser(user) });
    } catch {
      return res.status(401).json({ ok: false, message: "Přihlášení je neplatné" });
    }
  });

  app.get("/api/auth/admin-check", requireJwt, requireRole("admin"), (req, res) => {
    res.json({ ok: true, message: "Admin přihlášen" });
  });

  app.get("/api/player/matches", requireJwt, async (req, res) => {
    try {
      const matches = await getDb().collection("matches")
        .find({ status: "open", startsAt: { $gt: new Date().toISOString() } }, { projection: { tournamentId: 1, round: 1, startsAt: 1, home: 1, away: 1, bank: 1, status: 1 } })
        .sort({ round: 1, startsAt: 1 })
        .toArray();
      const tips = await getDb().collection("tips")
        .find({ userId: new ObjectId(req.session.sub) })
        .toArray();
      const tipsByMatchId = new Map(tips.map((tip) => [tip.matchId.toString(), tip]));
      return res.json({
        ok: true,
        matches: matches.map((match) => ({
          ...match,
          _id: match._id.toString(),
          tournamentId: match.tournamentId.toString(),
          tip: tipsByMatchId.get(match._id.toString()) ? {
            homeScore: tipsByMatchId.get(match._id.toString()).homeScore,
            awayScore: tipsByMatchId.get(match._id.toString()).awayScore,
          } : null,
          canEdit: new Date(match.startsAt).getTime() > Date.now(),
        })),
      });
    } catch {
      return res.status(500).json({ ok: false, message: "Zápasy se nepodařilo načíst" });
    }
  });

  app.put("/api/player/tips/:matchId", requireJwt, async (req, res) => {
    try {
      const matchId = String(req.params.matchId ?? "").trim();
      const homeScore = Number(req.body?.homeScore);
      const awayScore = Number(req.body?.awayScore);
      if (!ObjectId.isValid(matchId) || !Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0) {
        return res.status(400).json({ ok: false, message: "Zadej platné skóre." });
      }

      const db = getDb();
      const match = await db.collection("matches").findOne({ _id: new ObjectId(matchId), status: "open" });
      if (!match || new Date(match.startsAt).getTime() <= Date.now()) {
        return res.status(409).json({ ok: false, message: "Tento zápas už nelze tipovat." });
      }

      const now = new Date();
      const existingTip = await db.collection("tips").findOne({ matchId: match._id, userId: new ObjectId(req.session.sub) });
      const updatedState = existingTip ? "updated" : "inserted";
      await db.collection("tips").updateOne(
        { matchId: match._id, userId: new ObjectId(req.session.sub) },
        {
          $set: { homeScore, awayScore, updatedAt: now, updatedState },
          $unset: { updatedByUserId: "", updatedByUsername: "" },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true },
      );
      return res.json({ ok: true, tip: { homeScore, awayScore, updatedAt: now, updatedState } });
    } catch {
      return res.status(500).json({ ok: false, message: "Tip se nepodařilo uložit" });
    }
  });

  app.get("/api/player/schedule", requireJwt, async (req, res) => {
    try {
      const tournamentId = String(req.query?.tournamentId ?? "").replace(/^db:/, "").trim();
      if (!ObjectId.isValid(tournamentId)) return res.status(400).json({ ok: false, message: "Turnaj není platný." });
      const db = getDb();
      const tournament = await db.collection("tournaments").findOne({ _id: new ObjectId(tournamentId) });
      if (!tournament) return res.status(404).json({ ok: false, message: "Turnaj nebyl nalezen." });
      const participants = await getTournamentParticipants(db, tournament);
      const participantIndex = participants.findIndex((user) => user._id.toString() === req.session.sub);
      const scheduleMatches = await db.collection("scheduleMatches").find({ tournamentId }).sort({ round: 1, startsAt: 1 }).toArray();
      const selections = await db.collection("scheduleSelections").find({ tournamentId }).toArray();
      const allRounds = [...new Set(scheduleMatches.map((match) => Number(match.round)))].sort((a, b) => a - b);
      const rounds = allRounds.map((round) => {
        const matches = scheduleMatches.filter((match) => Number(match.round) === round).map((match) => ({
          id: match._id.toString(),
          home: match.home,
          away: match.away,
          startsAt: match.startsAt,
        }));
        const selection = selections.find((item) => Number(item.round) === round);
        const previousSelection = round > 1
          ? selections.find((item) => Number(item.round) === round - 1)
          : true;
        const selector = participants[(round - 1) % Math.max(1, participants.length)];
        return {
          round,
          matches,
          selectorUserId: selector?._id.toString() ?? null,
          selectorName: selector?.displayName || selector?.username || "-",
          canSelect: Boolean(previousSelection && selector && selector._id.toString() === req.session.sub && !selection),
          selection: selection ? { matchIds: selection.matchIds, userId: selection.userId, selectedAt: selection.selectedAt } : null,
        };
      });
      const visibleRounds = rounds.filter((round) => round.canSelect || round.selection?.userId === req.session.sub);
      return res.json({ ok: true, rounds: visibleRounds, participantIndex });
    } catch {
      return res.status(500).json({ ok: false, message: "Rozpis se nepodařilo načíst" });
    }
  });

  app.post("/api/player/schedule-selections/:round", requireJwt, async (req, res) => {
    try {
      const tournamentId = String(req.body?.tournamentId ?? "").replace(/^db:/, "").trim();
      const round = Number(req.params.round);
      const matchIds = Array.isArray(req.body?.matchIds) ? req.body.matchIds.map(String) : [];
      if (!ObjectId.isValid(tournamentId) || !Number.isInteger(round) || round < 1 || matchIds.length === 0) {
        return res.status(400).json({ ok: false, message: "Výběr zápasů není platný." });
      }
      const db = getDb();
      const tournament = await db.collection("tournaments").findOne({ _id: new ObjectId(tournamentId) });
      if (!tournament) return res.status(404).json({ ok: false, message: "Turnaj nebyl nalezen." });
      const participants = await getTournamentParticipants(db, tournament);
      const selector = participants[(round - 1) % Math.max(1, participants.length)];
      const previousSelection = round > 1
        ? await db.collection("scheduleSelections").findOne({ tournamentId, round: round - 1 })
        : true;
      if (!previousSelection) return res.status(403).json({ ok: false, message: "Nejdřív musí být dokončen výběr předchozího kola." });
      if (!selector || selector._id.toString() !== req.session.sub) return res.status(403).json({ ok: false, message: "V tomto kole nejsi na tahu." });
      const existing = await db.collection("scheduleSelections").findOne({ tournamentId, round });
      if (existing) return res.status(409).json({ ok: false, message: "Výběr tohoto kola už byl uzamčen." });
      const available = await db.collection("scheduleMatches").find({ tournamentId, round }).toArray();
      const availableIds = new Set(available.map((match) => match._id.toString()));
      if (matchIds.some((id) => !availableIds.has(id)) || new Set(matchIds).size !== available.length) {
        return res.status(400).json({ ok: false, message: "Vyber všechny zápasy tohoto kola." });
      }
      const selection = { tournamentId, round, userId: req.session.sub, matchIds, selectedAt: new Date() };
      await db.collection("scheduleSelections").insertOne(selection);
      return res.status(201).json({ ok: true, selection });
    } catch {
      return res.status(500).json({ ok: false, message: "Výběr se nepodařilo uložit" });
    }
  });

  app.get("/api/admin/overview", requireJwt, requireRole("admin"), async (req, res) => {
    try {
      const db = getDb();
      const [userDocuments, tournaments, matches, tips, tipBreakdown] = await Promise.all([
        db.collection("users").find({}, { projection: { username: 1, displayName: 1, role: 1, status: 1, createdAt: 1 } }).sort({ createdAt: 1 }).toArray(),
        db.collection("tournaments").countDocuments(),
        db.collection("matches").countDocuments(),
        db.collection("tips").countDocuments(),
        db.collection("tips").aggregate([
          { $group: { _id: "$userId", count: { $sum: 1 } } },
          { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" } },
          { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
          { $project: { _id: 0, username: { $ifNull: ["$user.username", "neznámý hráč"] }, count: 1 } },
          { $sort: { username: 1 } },
        ]).toArray(),
      ]);
      return res.json({
        ok: true,
        counts: { users: userDocuments.length, tournaments, matches, tips },
        users: userDocuments.map((user) => ({ ...user, _id: user._id.toString() })),
        tipBreakdown,
      });
    } catch {
      return res.status(500).json({ ok: false, message: "Admin přehled se nepodařilo načíst" });
    }
  });

  app.get("/api/admin/tournaments", requireJwt, requireRole("admin"), async (req, res) => {
    try {
      const tournaments = await getDb().collection("tournaments")
        .find({}, { projection: { name: 1, participantUserIds: 1, matchSelections: 1, subtitle: 1, shortLabel: 1, tabTitle: 1, season: 1, plannedMatchCount: 1, scheduleUrl: 1, status: 1, roundLabel: 1, startDate: 1, endDate: 1, stageLabel: 1, stages: 1, scoring: 1, tieBreakOrder: 1, tieBreakRules: 1, heroLogo: 1, logoSet: 1, favicon: 1, entryFee: 1, longTermContribution: 1, longTermBank: 1, payouts: 1, createdAt: 1 } })
        .sort({ createdAt: -1 })
        .toArray();
      return res.json({ ok: true, tournaments });
    } catch {
      return res.status(500).json({ ok: false, message: "Turnaje se nepodařilo načíst" });
    }
  });

  app.get("/api/admin/schedule", requireJwt, requireRole("admin"), async (req, res) => {
    try {
      const tournamentId = String(req.query?.tournamentId ?? "").trim();
      if (!ObjectId.isValid(tournamentId)) return res.status(400).json({ ok: false, message: "Turnaj není platný." });
      const matches = await getDb().collection("scheduleMatches").find({ tournamentId }).sort({ round: 1, startsAt: 1 }).toArray();
      return res.json({ ok: true, matches });
    } catch {
      return res.status(500).json({ ok: false, message: "Rozpis se nepodařilo načíst" });
    }
  });

  app.post("/api/admin/schedule/import", requireJwt, requireRole("admin"), async (req, res) => {
    try {
      const tournamentId = String(req.body?.tournamentId ?? "").trim();
      if (!ObjectId.isValid(tournamentId)) return res.status(400).json({ ok: false, message: "Turnaj není platný." });
      const tournament = await getDb().collection("tournaments").findOne({ _id: new ObjectId(tournamentId) }, { projection: { scheduleUrl: 1 } });
      if (!tournament?.scheduleUrl) return res.status(400).json({ ok: false, message: "Nejdřív ulož URL zdroje rozpisu." });
      const result = await importScheduleFromUrl(getDb(), tournamentId, tournament.scheduleUrl);
      return res.json({ ok: true, importedAt: result.importedAt, count: result.matches.length, matches: result.matches });
    } catch (error) {
      return res.status(400).json({ ok: false, message: error?.message || "Import rozpisu se nepodařil" });
    }
  });

  app.post("/api/admin/tournaments", requireJwt, requireRole("admin"), async (req, res) => {
    try {
      const name = String(req.body?.name ?? "").trim();
      const participantUserIds = Array.isArray(req.body?.participantUserIds)
        ? req.body.participantUserIds.filter((id) => ObjectId.isValid(String(id))).map((id) => String(id))
        : [];
      const matchSelections = Array.isArray(req.body?.matchSelections) ? req.body.matchSelections : [];
      const subtitle = String(req.body?.subtitle ?? "").trim();
      const shortLabel = String(req.body?.shortLabel ?? "").trim();
      const tabTitle = String(req.body?.shortLabel ?? req.body?.tabTitle ?? "").trim();
      const season = String(req.body?.season ?? "").trim();
      const plannedMatchCount = Math.max(0, Math.floor(Number(req.body?.plannedMatchCount) || 0));
      const scheduleUrl = String(req.body?.scheduleUrl ?? "").trim();
      const status = String(req.body?.status ?? "draft").trim();
      const roundLabel = String(req.body?.roundLabel ?? "den").trim();
      const startDate = String(req.body?.startDate ?? "").trim();
      const endDate = String(req.body?.endDate ?? "").trim();
      const stageLabel = String(req.body?.stageLabel ?? "").trim();
      const stages = Array.isArray(req.body?.stages) ? req.body.stages : [];
      const scoring = req.body?.scoring && typeof req.body.scoring === "object" ? req.body.scoring : {};
      const tieBreakOrder = Array.isArray(req.body?.tieBreakOrder) ? req.body.tieBreakOrder : ["exact", "scored", "noBet"];
      const tieBreakRules = Array.isArray(req.body?.tieBreakRules) ? req.body.tieBreakRules.slice(0, 5).map((rule) => String(rule).trim()).filter(Boolean) : [];
      const heroLogo = String(req.body?.heroLogo ?? "").trim();
      const logoSet = String(req.body?.logoSet ?? "").trim();
      const favicon = String(req.body?.favicon ?? "").trim();
      const entryFee = Number(req.body?.entryFee) || 10;
      const longTermContribution = Number(req.body?.longTermContribution) || 0;
      const longTermBank = Number(req.body?.longTermBank) || 0;
      const payouts = Array.isArray(req.body?.payouts) ? req.body.payouts.slice(0, 5).map((amount, index) => ({ place: index + 1, amount: Number(amount) || 0 })).filter((item) => item.amount > 0) : [];

      if (name.length < 2 || name.length > 100) {
        return res.status(400).json({ ok: false, message: "Název turnaje musí mít 2 až 100 znaků." });
      }
      if (tabTitle.length > 60) {
        return res.status(400).json({ ok: false, message: "Titulek záložky je příliš dlouhý." });
      }
      if (season.length > 30) {
        return res.status(400).json({ ok: false, message: "Sezóna je příliš dlouhá." });
      }
      if (!["draft", "active", "finished"].includes(status)) {
        return res.status(400).json({ ok: false, message: "Neplatný stav turnaje." });
      }
      if (entryFee < 0 || longTermContribution < 0 || longTermBank < 0) {
        return res.status(400).json({ ok: false, message: "Bank nemůže být záporný." });
      }
      const duplicate = await getDb().collection("tournaments").findOne({ name, season });
      if (duplicate) return res.status(409).json({ ok: false, message: "Turnaj se stejným názvem a sezónou už existuje." });

      const now = new Date();
      const tournament = { name, participantUserIds, matchSelections, subtitle, shortLabel, tabTitle, season, plannedMatchCount, scheduleUrl, status, roundLabel: roundLabel || "den", startDate, endDate, stageLabel, stages, scoring, tieBreakOrder, tieBreakRules, heroLogo, logoSet, favicon, entryFee, longTermContribution, longTermBank, payouts, createdAt: now, updatedAt: now };
      const result = await getDb().collection("tournaments").insertOne(tournament);
      return res.status(201).json({ ok: true, tournament: { ...tournament, _id: result.insertedId } });
    } catch {
      return res.status(500).json({ ok: false, message: "Turnaj se nepodařilo založit" });
    }
  });

  app.patch("/api/admin/tournaments/:id", requireJwt, requireRole("admin"), async (req, res) => {
    try {
      const tournamentId = String(req.params.id ?? "").trim();
      const name = String(req.body?.name ?? "").trim();
      const participantUserIds = Array.isArray(req.body?.participantUserIds)
        ? req.body.participantUserIds.filter((id) => ObjectId.isValid(String(id))).map((id) => String(id))
        : [];
      const matchSelections = Array.isArray(req.body?.matchSelections) ? req.body.matchSelections : [];
      const subtitle = String(req.body?.subtitle ?? "").trim();
      const shortLabel = String(req.body?.shortLabel ?? "").trim();
      const tabTitle = String(req.body?.shortLabel ?? req.body?.tabTitle ?? "").trim();
      const season = String(req.body?.season ?? "").trim();
      const plannedMatchCount = Math.max(0, Math.floor(Number(req.body?.plannedMatchCount) || 0));
      const scheduleUrl = String(req.body?.scheduleUrl ?? "").trim();
      const status = String(req.body?.status ?? "draft").trim();
      const roundLabel = String(req.body?.roundLabel ?? "").trim();
      const startDate = String(req.body?.startDate ?? "").trim();
      const endDate = String(req.body?.endDate ?? "").trim();
      const stageLabel = String(req.body?.stageLabel ?? "").trim();
      const stages = Array.isArray(req.body?.stages) ? req.body.stages : [];
      const scoring = req.body?.scoring && typeof req.body.scoring === "object" ? req.body.scoring : {};
      const tieBreakOrder = Array.isArray(req.body?.tieBreakOrder) ? req.body.tieBreakOrder : ["exact", "scored", "noBet"];
      const tieBreakRules = Array.isArray(req.body?.tieBreakRules) ? req.body.tieBreakRules.slice(0, 5).map((rule) => String(rule).trim()).filter(Boolean) : [];
      const heroLogo = String(req.body?.heroLogo ?? "").trim();
      const logoSet = String(req.body?.logoSet ?? "").trim();
      const favicon = String(req.body?.favicon ?? "").trim();
      const entryFee = Number(req.body?.entryFee) || 10;
      const longTermContribution = Number(req.body?.longTermContribution) || 0;
      const longTermBank = Number(req.body?.longTermBank) || 0;
      const payouts = Array.isArray(req.body?.payouts) ? req.body.payouts.slice(0, 5).map((amount, index) => ({ place: index + 1, amount: Number(amount) || 0 })).filter((item) => item.amount > 0) : [];

      if (!ObjectId.isValid(tournamentId)) return res.status(400).json({ ok: false, message: "Turnaj není platný." });
      if (name.length < 2 || name.length > 100) return res.status(400).json({ ok: false, message: "Název turnaje musí mít 2 až 100 znaků." });
      if (tabTitle.length > 60) return res.status(400).json({ ok: false, message: "Titulek záložky je příliš dlouhý." });
      if (season.length > 30) return res.status(400).json({ ok: false, message: "Sezóna je příliš dlouhá." });
      if (!roundLabel) return res.status(400).json({ ok: false, message: "Vyplň jednotku kola." });
      if (!["draft", "active", "finished"].includes(status)) return res.status(400).json({ ok: false, message: "Neplatný stav turnaje." });
      if (entryFee < 0 || longTermContribution < 0 || longTermBank < 0) return res.status(400).json({ ok: false, message: "Bank nemůže být záporný." });

      const result = await getDb().collection("tournaments").findOneAndUpdate(
        { _id: new ObjectId(tournamentId) },
        { $set: { name, participantUserIds, matchSelections, subtitle, shortLabel, tabTitle, season, plannedMatchCount, scheduleUrl, status, roundLabel, startDate, endDate, stageLabel, stages, scoring, tieBreakOrder, tieBreakRules, heroLogo, logoSet, favicon, entryFee, longTermContribution, longTermBank, payouts, updatedAt: new Date() } },
        { returnDocument: "after", projection: { name: 1, participantUserIds: 1, matchSelections: 1, subtitle: 1, shortLabel: 1, tabTitle: 1, season: 1, plannedMatchCount: 1, scheduleUrl: 1, status: 1, roundLabel: 1, startDate: 1, endDate: 1, stageLabel: 1, stages: 1, scoring: 1, tieBreakOrder: 1, tieBreakRules: 1, heroLogo: 1, logoSet: 1, favicon: 1, entryFee: 1, longTermContribution: 1, longTermBank: 1, payouts: 1, createdAt: 1 } },
      );
      if (!result) return res.status(404).json({ ok: false, message: "Turnaj nebyl nalezen." });
      await recalculateAutomaticBanks(getDb(), result._id);
      return res.json({ ok: true, tournament: result });
    } catch {
      return res.status(500).json({ ok: false, message: "Turnaj se nepodařilo upravit" });
    }
  });

  app.get("/api/admin/matches", requireJwt, requireRole("admin"), async (req, res) => {
    try {
      const tournamentId = String(req.query?.tournamentId ?? "").trim();
      const query = tournamentId ? { tournamentId: new ObjectId(tournamentId) } : {};
      const db = getDb();
      if (tournamentId && ObjectId.isValid(tournamentId)) await recalculateAutomaticBanks(db, new ObjectId(tournamentId));
      const matches = await db.collection("matches")
        .find(query, { projection: { tournamentId: 1, round: 1, startsAt: 1, home: 1, away: 1, score: 1, bank: 1, bankSource: 1, baseBank: 1, carriedBank: 1, status: 1, createdAt: 1 } })
        .sort({ round: 1, startsAt: 1 })
        .toArray();
      return res.json({ ok: true, matches });
    } catch {
      return res.status(500).json({ ok: false, message: "Zápasy se nepodařilo načíst" });
    }
  });

  app.post("/api/admin/matches", requireJwt, requireRole("admin"), async (req, res) => {
    try {
      const tournamentId = String(req.body?.tournamentId ?? "").trim();
      const round = Number(req.body?.round);
      const startsAt = String(req.body?.startsAt ?? "").trim();
      const home = String(req.body?.home ?? "").trim();
      const away = String(req.body?.away ?? "").trim();
      const score = String(req.body?.score ?? "").trim();
      const status = String(req.body?.status ?? "draft").trim();
      const manualBank = String(req.body?.manualBank ?? "").trim();

      if (!ObjectId.isValid(tournamentId)) return res.status(400).json({ ok: false, message: "Vyber platný turnaj." });
      if (!Number.isInteger(round) || round < 1) return res.status(400).json({ ok: false, message: "Číslo kola musí být kladné celé číslo." });
      if (!startsAt || !home || !away || home.length > 80 || away.length > 80) return res.status(400).json({ ok: false, message: "Vyplň datum, čas a oba týmy." });
      if (home === away) return res.status(400).json({ ok: false, message: "Domácí a hostující tým musí být rozdílné." });
      if (score && !/^\d+:\d+$/.test(score)) return res.status(400).json({ ok: false, message: "Výsledek musí mít formát domácí:hosté." });
      if (!["draft", "open", "locked", "evaluated"].includes(status)) return res.status(400).json({ ok: false, message: "Neplatný stav zápasu." });

      const db = getDb();
      const tournament = await db.collection("tournaments").findOne({ _id: new ObjectId(tournamentId) });
      if (!tournament) return res.status(404).json({ ok: false, message: "Turnaj nebyl nalezen." });

      const playerCount = await db.collection("users").countDocuments({ status: "active" });
      const entryFee = Number(tournament.entryFee) || 10;
      const baseBank = playerCount * entryFee;
      const previousMatch = await db.collection("matches").findOne(
        { tournamentId: new ObjectId(tournamentId), startsAt: { $lt: startsAt } },
        { sort: { startsAt: -1 } },
      );
      const carriedBank = previousMatch && previousMatch.status !== "evaluated" && !previousMatch.score
        ? Number(previousMatch.bank) || 0
        : 0;
      const automaticBank = baseBank + carriedBank;
      const bank = manualBank === "" ? automaticBank : Number(manualBank);
      if (!Number.isFinite(bank) || bank < 0) return res.status(400).json({ ok: false, message: "Bank musí být nezáporné číslo." });

      const now = new Date();
      const match = {
        tournamentId: new ObjectId(tournamentId),
        round,
        startsAt,
        home,
        away,
        score: score || null,
        bank,
        bankSource: manualBank === "" ? "automatic" : "manual",
        baseBank,
        carriedBank,
        playerCount,
        entryFee,
        status,
        createdAt: now,
        updatedAt: now,
      };
      const result = await db.collection("matches").insertOne(match);
      await recalculateAutomaticBanks(db, new ObjectId(tournamentId));
      const savedMatch = await db.collection("matches").findOne({ _id: result.insertedId });
      return res.status(201).json({ ok: true, match: savedMatch });
    } catch {
      return res.status(500).json({ ok: false, message: "Zápas se nepodařilo založit" });
    }
  });

  app.patch("/api/admin/matches/:id", requireJwt, requireRole("admin"), async (req, res) => {
    try {
      const matchId = String(req.params.id ?? "").trim();
      const round = Number(req.body?.round);
      const startsAt = String(req.body?.startsAt ?? "").trim();
      const home = String(req.body?.home ?? "").trim();
      const away = String(req.body?.away ?? "").trim();
      const score = String(req.body?.score ?? "").trim();
      const status = String(req.body?.status ?? "draft").trim();

      if (!ObjectId.isValid(matchId)) return res.status(400).json({ ok: false, message: "Zápas není platný." });
      if (!Number.isInteger(round) || round < 1) return res.status(400).json({ ok: false, message: "Číslo kola musí být kladné celé číslo." });
      if (!startsAt || !home || !away || home.length > 80 || away.length > 80) return res.status(400).json({ ok: false, message: "Vyplň datum, čas a oba týmy." });
      if (home === away) return res.status(400).json({ ok: false, message: "Domácí a hostující tým musí být rozdílné." });
      if (score && !/^\d+:\d+$/.test(score)) return res.status(400).json({ ok: false, message: "Výsledek musí mít formát domácí:hosté." });
      if (!["draft", "open", "locked", "evaluated"].includes(status)) return res.status(400).json({ ok: false, message: "Neplatný stav zápasu." });

      const result = await getDb().collection("matches").findOneAndUpdate(
        { _id: new ObjectId(matchId) },
        { $set: { round, startsAt, home, away, score: score || null, status, updatedAt: new Date() } },
        { returnDocument: "after", projection: { tournamentId: 1, round: 1, startsAt: 1, home: 1, away: 1, score: 1, bank: 1, bankSource: 1, baseBank: 1, carriedBank: 1, status: 1, createdAt: 1 } },
      );
      if (!result) return res.status(404).json({ ok: false, message: "Zápas nebyl nalezen." });
      await recalculateAutomaticBanks(getDb(), result.tournamentId);
      const savedMatch = await getDb().collection("matches").findOne({ _id: result._id });
      return res.json({ ok: true, match: savedMatch });
    } catch {
      return res.status(500).json({ ok: false, message: "Zápas se nepodařilo upravit" });
    }
  });

  app.delete("/api/admin/matches/:id", requireJwt, requireRole("admin"), async (req, res) => {
    try {
      const matchId = String(req.params.id ?? "").trim();
      if (!ObjectId.isValid(matchId)) return res.status(400).json({ ok: false, message: "Zápas není platný." });
      const db = getDb();
      const match = await db.collection("matches").findOne({ _id: new ObjectId(matchId) });
      if (!match) return res.status(404).json({ ok: false, message: "Zápas nebyl nalezen." });
      const result = await db.collection("matches").deleteOne({ _id: new ObjectId(matchId) });
      if (result.deletedCount !== 1) return res.status(404).json({ ok: false, message: "Zápas nebyl nalezen." });
      await db.collection("tips").deleteMany({ matchId: new ObjectId(matchId) });
      await recalculateAutomaticBanks(db, match.tournamentId);
      return res.json({ ok: true });
    } catch {
      return res.status(500).json({ ok: false, message: "Zápas se nepodařilo smazat" });
    }
  });
}

module.exports = { createAuthRoutes, getOptionalSession, requireJwt, requireRole, recalculateAutomaticBanks, importScheduleFromUrl };
