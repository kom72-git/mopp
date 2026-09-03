const fs = require("fs/promises");
const path = require("path");
const { pathToFileURL } = require("url");
const { ObjectId } = require("mongodb");
const { getOptionalSession } = require("./_auth");

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
  if (resultOutcome === 0) return 0;
  const resultWinnerGoals = resultOutcome > 0 ? resultHome : resultAway;
  const tipWinnerGoals = tipOutcome > 0 ? tipHome : tipAway;
  if (tipWinnerGoals === resultWinnerGoals) return Number(scoring?.near) || 5;
  return Number(scoring?.winner) || 3;
}

async function loadMongoTournamentData(getDb, tournamentId, session) {
  const rawId = String(tournamentId).replace(/^db:/, "");
  if (!ObjectId.isValid(rawId)) throw new Error("Unknown Mongo tournament");
  const database = getDb();
  const tournament = await database.collection("tournaments").findOne({ _id: new ObjectId(rawId) });
  if (!tournament) throw new Error("Mongo tournament not found");

  const hasRoster = Array.isArray(tournament.tournamentPlayers);
  const roster = hasRoster ? tournament.tournamentPlayers : [];
  const participantUserIds = (hasRoster ? roster.map((player) => player?.userId) : tournament.participantUserIds || []).filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const userQuery = { _id: { $in: participantUserIds }, status: "active" };
  const users = await database.collection("users")
    .find(userQuery, { projection: { username: 1, displayName: 1, avatar: 1, entryFeePaid: 1 } })
    .sort({ createdAt: 1 })
    .toArray();
  const allowedUserIds = new Set(users.map((user) => user._id.toString()));
  const usersById = new Map(users.map((user) => [user._id.toString(), user]));
  const displayNameForUser = (user) => roster.find((player) => player.userId === user._id.toString())?.name || user.displayName || user.username;
  const longTermBankPayouts = tournament.payouts || [];
  const matches = await database.collection("matches")
    .find({ tournamentId: tournament._id })
    .sort({ round: 1, startsAt: 1 })
    .toArray();
  const tips = await database.collection("tips").find({ matchId: { $in: matches.map((match) => match._id) } }).toArray();
  const eligibleTips = tips.filter((tip) => allowedUserIds.has(tip.userId.toString()));
  const tipsByMatch = new Map();
  const pointsByUser = new Map(users.map((user) => [user._id.toString(), 0]));
  const now = Date.now();
  for (const tip of tips) {
    if (!allowedUserIds.has(tip.userId.toString())) continue;
    const match = matches.find((item) => item._id.equals(tip.matchId));
    const hasStarted = match && new Date(match.startsAt).getTime() <= now;
    const isOwnTip = Boolean(session) && tip.userId.toString() === session.sub;
    if (!tipsByMatch.has(tip.matchId.toString())) tipsByMatch.set(tip.matchId.toString(), []);
    const points = scoreTip(`${tip.homeScore}:${tip.awayScore}`, match?.score, tournament.scoring);
    if (Number.isFinite(points)) pointsByUser.set(tip.userId.toString(), (pointsByUser.get(tip.userId.toString()) || 0) + points);
    tipsByMatch.get(tip.matchId.toString()).push({ ...tip, points, tipValueHidden: !hasStarted && !isOwnTip });
  }

  // Hraci bez vlastniho tipu u jiz zahajeneho zapasu se zobrazi jako N/N misto uplneho chybeni z tabulky.
  for (const match of matches) {
    const hasStarted = new Date(match.startsAt).getTime() <= now;
    if (!hasStarted) continue;
    const matchKey = match._id.toString();
    const existingUserIds = new Set((tipsByMatch.get(matchKey) || []).map((tip) => tip.userId.toString()));
    for (const user of users) {
      if (existingUserIds.has(user._id.toString())) continue;
      if (!tipsByMatch.has(matchKey)) tipsByMatch.set(matchKey, []);
      tipsByMatch.get(matchKey).push({
        userId: user._id,
        homeScore: "N",
        awayScore: "N",
        tipValueHidden: false,
        points: 0,
        updatedAt: null,
        updatedState: "noBet",
      });
    }
  }

  const players = hasRoster
    ? roster.map((player) => {
      const user = usersById.get(player.userId);
      return { id: player.id, userId: player.userId || null, name: player.name, avatar: user?.avatar || "", entryFeePaid: Boolean(player.entryFeePaid), points: pointsByUser.get(player.userId) || 0 };
    })
    : users.map((user) => ({ id: user._id.toString(), userId: user._id.toString(), name: displayNameForUser(user), avatar: user.avatar || "", entryFeePaid: Boolean(user.entryFeePaid), points: pointsByUser.get(user._id.toString()) || 0 }));
  const longTermBankTotal = players.length * (Number(tournament.longTermContribution) || 0);

  return {
    tournament: {
      id: dbTournamentId(tournament._id),
      label: tournament.name,
      title: tournament.name,
      subtitle: tournament.subtitle || "",
      shortLabel: tournament.shortLabel || tournament.name,
      tabTitle: tournament.tabTitle || tournament.name,
      roundLabel: tournament.roundLabel || "den",
      stageLabel: tournament.stageLabel || "",
      stages: tournament.stages || [],
      scoring: tournament.scoring || { exact: 10, near: 5, winner: 3 },
      tieBreakOrder: tournament.tieBreakOrder || ["exact", "scored", "noBet"],
      heroLogo: tournament.heroLogo || "",
      startDate: tournament.startDate || "",
      endDate: tournament.endDate || "",
      plannedMatchCount: Number(tournament.plannedMatchCount) || 0,
      entryFee: tournament.entryFee || 10,
      longTermContribution: tournament.longTermContribution || 0,
      source: "mongodb",
      logoSet: tournament.logoSet || null,
      favicon: tournament.favicon || "",
      longTermBank: { totalAmount: longTermBankTotal, baseAmount: 0, contributionAmount: tournament.longTermContribution || 0, contributorCount: players.length, payouts: longTermBankPayouts, tieBreakHeading: "V případě shodného počtu bodů rozhoduje:", tieBreakRules: tournament.tieBreakRules?.length ? tournament.tieBreakRules : tieBreakRulesFor(tournament.tieBreakOrder || []) },
    },
    players,
    matches: matches.map((match) => ({
      id: match._id.toString(),
      round: match.round,
      startsAt: match.startsAt,
      home: match.home,
      away: match.away,
      score: match.score || null,
      bank: match.bank ?? null,
      selectedByName: usersById.has(String(match.selectedByUserId))
        ? displayNameForUser(usersById.get(String(match.selectedByUserId)))
        : match.selectedByUsername || null,
      updatedByAdminName: match.updatedByUsername || null,
      tipCount: eligibleTips.filter((tip) => tip.matchId.equals(match._id)).length,
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

async function loadFantasyArchiveModule() {
  const modulePath = path.resolve(__dirname, "../src/data/fantasyArchive.js");
  const moduleStats = await fs.stat(modulePath);
  return import(`${pathToFileURL(modulePath).href}?v=${moduleStats.mtimeMs}`);
}

async function replaceFantasyArchiveData(db, tournamentId) {
  const { fantasyPlayers, fantasySeasonStats, fantasyPrizeMoneyByPeriod, fantasyLongTermBankByPeriod, periods, fantasyRounds } = await loadFantasyArchiveModule();
  const now = new Date();
  await Promise.all([
    db.collection("fantasyPlayers").deleteMany({ tournamentId }),
    db.collection("fantasyPeriods").deleteMany({ tournamentId }),
    db.collection("fantasyRounds").deleteMany({ tournamentId }),
    db.collection("fantasySeasonStats").deleteMany({ tournamentId }),
    db.collection("fantasyPayouts").deleteMany({ tournamentId }),
  ]);
  await db.collection("fantasyPlayers").insertMany(fantasyPlayers.map((player, index) => ({ tournamentId, playerKey: player.nick, name: player.name, nick: player.nick, order: index + 1 })));
  await db.collection("fantasyPeriods").insertMany(periods.map((period, index) => ({ tournamentId, ...period, order: index + 1 })));
  await db.collection("fantasyRounds").insertMany(fantasyRounds.map(([date, scores], index) => ({ tournamentId, roundNumber: index + 1, date, scores: Object.fromEntries(fantasyPlayers.map((player, playerIndex) => [player.nick, scores[playerIndex] ?? null])) })));
  await db.collection("fantasySeasonStats").insertMany(Object.entries(fantasySeasonStats).map(([playerKey, stats]) => ({ tournamentId, playerKey, ...stats })));
  const payoutRows = [];
  for (const [periodId, payouts] of Object.entries(fantasyPrizeMoneyByPeriod)) {
    for (const [playerKey, prizeMoney] of Object.entries(payouts)) payoutRows.push({ tournamentId, periodId, playerKey, prizeMoney, longTermBank: fantasyLongTermBankByPeriod[periodId]?.[playerKey] ?? 0 });
  }
  for (const [periodId, payouts] of Object.entries(fantasyLongTermBankByPeriod)) {
    for (const [playerKey, longTermBank] of Object.entries(payouts)) {
      if (!payoutRows.some((row) => row.periodId === periodId && row.playerKey === playerKey)) payoutRows.push({ tournamentId, periodId, playerKey, prizeMoney: 0, longTermBank });
    }
  }
  if (payoutRows.length > 0) await db.collection("fantasyPayouts").insertMany(payoutRows);
  await db.collection("tournaments").updateOne({ _id: tournamentId }, { $set: { productType: "fantasy", updatedAt: now } });
  return { players: fantasyPlayers.length, rounds: fantasyRounds.length, periods: periods.length };
}

async function importFantasyArchiveTournament(db) {
  const now = new Date();
  const existing = await db.collection("tournaments").findOne({ productType: "fantasy", season: "2024/25" });
  const tournamentId = existing?._id ?? (await db.collection("tournaments").insertOne({
    name: "Fantasy ELH 2024/25",
    label: "ELH 2024/25",
    shortLabel: "ELH 2024/25",
    tabTitle: "Fantasy ELH 2024/25",
    subtitle: "Tipsport Fantasy",
    season: "2024/25",
    status: "finished",
    productType: "fantasy",
    roundLabel: "kolo",
    createdAt: now,
    updatedAt: now,
  })).insertedId;
  const result = await replaceFantasyArchiveData(db, tournamentId);
  return { tournamentId, ...result };
}

function registerSharedRoutes({ app, getDb, requireJwt, requireRole }) {
  app.get("/health", (req, res) => {
    res.json({ ok: true, service: "mopp-api" });
  });

  app.get("/api/ping", (req, res) => {
    res.json({ message: "MOPP API běží", ts: new Date().toISOString() });
  });

  app.get("/api/tournaments", async (req, res) => {
    try {
      const db = getDb();
      const [rows, activeUsers, firstMatches] = await Promise.all([
        db.collection("tournaments").find({ $or: [{ productType: { $exists: false } }, { productType: "tips" }] }).sort({ createdAt: -1 }).toArray(),
        db.collection("users").find({ status: "active" }, { projection: { _id: 1 } }).toArray(),
        db.collection("matches").aggregate([
          { $match: { startsAt: { $type: "string", $ne: "" } } },
          { $sort: { startsAt: 1 } },
          { $group: { _id: "$tournamentId", startsAt: { $first: "$startsAt" } } },
        ]).toArray(),
      ]);
      const firstMatchByTournament = new Map(firstMatches.map((match) => [String(match._id), match.startsAt]));
      return res.json({ ok: true, tournaments: rows.map((tournament) => ({
        id: dbTournamentId(tournament._id),
        label: tournament.name,
        title: tournament.name,
        subtitle: tournament.subtitle || "",
        shortLabel: tournament.shortLabel || tournament.name,
        tabTitle: tournament.tabTitle || tournament.name,
        roundLabel: tournament.roundLabel || "den",
        stageLabel: tournament.stageLabel || "",
        stages: tournament.stages || [],
        tournamentPlayers: tournament.tournamentPlayers || [],
        scoring: tournament.scoring || { exact: 10, near: 5, winner: 3 },
        tieBreakOrder: tournament.tieBreakOrder || ["exact", "scored", "noBet"],
        heroLogo: tournament.heroLogo || "",
        startDate: tournament.startDate || "",
        endDate: tournament.endDate || "",
        firstMatchStartsAt: firstMatchByTournament.get(String(tournament._id)) || "",
        plannedMatchCount: Number(tournament.plannedMatchCount) || 0,
        entryFee: tournament.entryFee || 10,
        longTermContribution: tournament.longTermContribution || 0,
        source: "mongodb",
        logoSet: tournament.logoSet || null,
        favicon: tournament.favicon || "",
        status: tournament.status,
        productType: tournament.productType || "tips",
        longTermBank: (() => {
          const participantIds = (tournament.participantUserIds || []).map(String);
          const contributorCount = Array.isArray(tournament.tournamentPlayers)
            ? tournament.tournamentPlayers.length
            : activeUsers.filter((user) => participantIds.includes(user._id.toString())).length;
          const baseAmount = 0;
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

  app.post("/api/admin/tournaments/:id/fantasy/import-static", requireJwt, requireRole("admin"), async (req, res) => {
    try {
      const rawTournamentId = String(req.params.id ?? "").trim();
      if (!ObjectId.isValid(rawTournamentId)) return res.status(400).json({ ok: false, message: "Turnaj není platný." });
      const result = await replaceFantasyArchiveData(getDb(), new ObjectId(rawTournamentId));
      return res.json({ ok: true, ...result, message: `Fantasy archiv načten: ${result.players} hráčů, ${result.rounds} kol.` });
    } catch (error) {
      return res.status(500).json({ ok: false, message: error?.message || "Fantasy archiv se nepodařilo načíst." });
    }
  });

  app.post("/api/admin/fantasy/import-archive", requireJwt, requireRole("admin"), async (req, res) => {
    try {
      const result = await importFantasyArchiveTournament(getDb());
      return res.json({ ok: true, tournamentId: dbTournamentId(result.tournamentId), ...result, message: `Fantasy archiv převeden do DB: ${result.players} hráčů, ${result.rounds} kol.` });
    } catch (error) {
      return res.status(500).json({ ok: false, message: error?.message || "Fantasy archiv se nepodařilo převést." });
    }
  });

  app.get("/api/admin/fantasy/tournaments", requireJwt, requireRole("admin"), async (req, res) => {
    try {
      const db = getDb();
      const tournaments = await db.collection("tournaments").find({ productType: "fantasy" }).sort({ createdAt: -1 }).toArray();
      return res.json({ ok: true, tournaments: tournaments.map((tournament) => ({ ...tournament, _id: tournament._id.toString() })) });
    } catch {
      return res.status(500).json({ ok: false, message: "Fantasy turnaje se nepodařilo načíst." });
    }
  });

  app.get("/api/fantasy/tournaments", async (req, res) => {
    try {
      const tournaments = await getDb().collection("tournaments").find({ productType: "fantasy" }).sort({ createdAt: -1 }).toArray();
      return res.json({ ok: true, tournaments: tournaments.map((tournament) => ({ _id: tournament._id.toString(), name: tournament.name, shortLabel: tournament.shortLabel || tournament.name, season: tournament.season, status: tournament.status, fantasyMonths: tournament.fantasyMonths || null, heroLogo: tournament.heroLogo || "", favicon: tournament.favicon || "", fantasyPeriodRankLabel: tournament.fantasyPeriodRankLabel || "Měsíční", fantasyMoneyRules: tournament.fantasyMoneyRules || null, tieBreakRules: tournament.tieBreakRules || [] })) });
    } catch {
      return res.status(500).json({ ok: false, message: "Fantasy turnaje se nepodařilo načíst." });
    }
  });

  app.post("/api/admin/fantasy/tournaments", requireJwt, requireRole("admin"), async (req, res) => {
    try {
      const name = String(req.body?.name ?? "").trim();
      const season = String(req.body?.season ?? "").trim();
      const fantasyMonths = Math.max(0, Number(req.body?.fantasyMonths) || 0);
      const heroLogo = String(req.body?.heroLogo ?? "").trim();
      const favicon = String(req.body?.favicon ?? "").trim();
      const fantasyPeriodRankLabel = String(req.body?.fantasyPeriodRankLabel ?? "Měsíční").trim() || "Měsíční";
      const fantasyMoneyRules = req.body?.fantasyMoneyRules && typeof req.body.fantasyMoneyRules === "object" ? req.body.fantasyMoneyRules : {};
      const tieBreakRules = Array.isArray(req.body?.tieBreakRules) ? req.body.tieBreakRules.map((rule) => String(rule ?? "").trim()).filter(Boolean).slice(0, 5) : [];
      if (name.length < 2 || name.length > 100) return res.status(400).json({ ok: false, message: "Název turnaje musí mít 2 až 100 znaků." });
      const now = new Date();
      const tournament = { name, shortLabel: name, tabTitle: name, subtitle: "Fantasy", season, status: "draft", productType: "fantasy", fantasyMonths, heroLogo, favicon, fantasyPeriodRankLabel, fantasyMoneyRules, tieBreakRules, roundLabel: "kolo", createdAt: now, updatedAt: now };
      const result = await getDb().collection("tournaments").insertOne(tournament);
      return res.status(201).json({ ok: true, tournament: { ...tournament, _id: result.insertedId.toString() }, message: "Fantasy turnaj byl založen." });
    } catch {
      return res.status(500).json({ ok: false, message: "Fantasy turnaj se nepodařilo založit." });
    }
  });

  app.patch("/api/admin/fantasy/tournaments/:id", requireJwt, requireRole("admin"), async (req, res) => {
    try {
      const rawTournamentId = String(req.params.id ?? "").trim();
      const name = String(req.body?.name ?? "").trim();
      const season = String(req.body?.season ?? "").trim();
      const fantasyMonths = Math.max(0, Number(req.body?.fantasyMonths) || 0);
      const heroLogo = String(req.body?.heroLogo ?? "").trim();
      const favicon = String(req.body?.favicon ?? "").trim();
      const status = String(req.body?.status ?? "draft").trim();
      const fantasyPeriodRankLabel = String(req.body?.fantasyPeriodRankLabel ?? "Měsíční").trim() || "Měsíční";
      const fantasyMoneyRules = req.body?.fantasyMoneyRules && typeof req.body.fantasyMoneyRules === "object" ? req.body.fantasyMoneyRules : {};
      const tieBreakRules = Array.isArray(req.body?.tieBreakRules) ? req.body.tieBreakRules.map((rule) => String(rule ?? "").trim()).filter(Boolean).slice(0, 5) : [];
      if (!ObjectId.isValid(rawTournamentId)) return res.status(400).json({ ok: false, message: "Turnaj není platný." });
      if (name.length < 2 || name.length > 100) return res.status(400).json({ ok: false, message: "Název turnaje musí mít 2 až 100 znaků." });
      if (!["draft", "active", "finished"].includes(status)) return res.status(400).json({ ok: false, message: "Neplatný stav turnaje." });
      const result = await getDb().collection("tournaments").findOneAndUpdate(
        { _id: new ObjectId(rawTournamentId), productType: "fantasy" },
        { $set: { name, shortLabel: name, tabTitle: name, season, status, fantasyMonths, heroLogo, favicon, fantasyPeriodRankLabel, fantasyMoneyRules, tieBreakRules, updatedAt: new Date() } },
        { returnDocument: "after" },
      );
      if (!result) return res.status(404).json({ ok: false, message: "Fantasy turnaj nebyl nalezen." });
      return res.json({ ok: true, tournament: { ...result, _id: result._id.toString() }, message: "Fantasy turnaj byl uložen." });
    } catch {
      return res.status(500).json({ ok: false, message: "Fantasy turnaj se nepodařilo uložit." });
    }
  });

  app.delete("/api/admin/fantasy/tournaments/:id", requireJwt, requireRole("admin"), async (req, res) => {
    try {
      const rawTournamentId = String(req.params.id ?? "").trim();
      if (!ObjectId.isValid(rawTournamentId)) return res.status(400).json({ ok: false, message: "Turnaj není platný." });
      const tournamentId = new ObjectId(rawTournamentId);
      await Promise.all([
        getDb().collection("fantasyPlayers").deleteMany({ tournamentId }),
        getDb().collection("fantasyPeriods").deleteMany({ tournamentId }),
        getDb().collection("fantasyRounds").deleteMany({ tournamentId }),
        getDb().collection("fantasySeasonStats").deleteMany({ tournamentId }),
        getDb().collection("fantasyPayouts").deleteMany({ tournamentId }),
      ]);
      await getDb().collection("tournaments").deleteOne({ _id: tournamentId, productType: "fantasy" });
      return res.json({ ok: true, message: "Fantasy turnaj byl smazán." });
    } catch {
      return res.status(500).json({ ok: false, message: "Fantasy turnaj se nepodařilo smazat." });
    }
  });

  app.put("/api/admin/fantasy/tournaments/:id/players", requireJwt, requireRole("admin"), async (req, res) => {
    try {
      const rawTournamentId = String(req.params.id ?? "").trim();
      if (!ObjectId.isValid(rawTournamentId)) return res.status(400).json({ ok: false, message: "Turnaj není platný." });
      const tournamentId = new ObjectId(rawTournamentId);
      const players = Array.isArray(req.body?.players) ? req.body.players : [];
      const cleanedPlayers = players.map((player, index) => ({
        tournamentId,
        playerKey: String(player?.nick || player?.name || `p${index + 1}`).trim(),
        nick: String(player?.nick || player?.name || `p${index + 1}`).trim(),
        name: String(player?.name || player?.nick || `Hráč ${index + 1}`).trim(),
        entryFeePaid: Boolean(player?.entryFeePaid),
        order: index + 1,
      })).filter((player) => player.name && player.nick).slice(0, 100);
      const db = getDb();
      const previousPlayers = await db.collection("fantasyPlayers").find({ tournamentId }).sort({ order: 1 }).toArray();
      await db.collection("fantasyPlayers").deleteMany({ tournamentId });
      if (cleanedPlayers.length > 0) await db.collection("fantasyPlayers").insertMany(cleanedPlayers);
      const renamedPlayers = cleanedPlayers
        .map((player, index) => ({ previousKey: previousPlayers[index]?.playerKey, nextKey: player.playerKey }))
        .filter((player) => player.previousKey && player.nextKey && player.previousKey !== player.nextKey);
      if (renamedPlayers.length > 0) {
        const rounds = await db.collection("fantasyRounds").find({ tournamentId }).toArray();
        await Promise.all(rounds.map((round) => {
          const scores = { ...(round.scores || {}) };
          let changed = false;
          for (const player of renamedPlayers) {
            if (Object.prototype.hasOwnProperty.call(scores, player.previousKey) && !Object.prototype.hasOwnProperty.call(scores, player.nextKey)) {
              scores[player.nextKey] = scores[player.previousKey];
              delete scores[player.previousKey];
              changed = true;
            }
          }
          return changed ? db.collection("fantasyRounds").updateOne({ _id: round._id }, { $set: { scores, updatedAt: new Date() } }) : Promise.resolve();
        }));
      }
      await db.collection("tournaments").updateOne({ _id: tournamentId }, { $set: { productType: "fantasy", updatedAt: new Date() } });
      return res.json({ ok: true, players: cleanedPlayers.map(({ name, nick }) => ({ name, nick })), message: "Hráči Fantasy byli uloženi." });
    } catch {
      return res.status(500).json({ ok: false, message: "Hráče Fantasy se nepodařilo uložit." });
    }
  });

  app.post("/api/admin/fantasy/tournaments/:id/rounds", requireJwt, requireRole("admin"), async (req, res) => {
    try {
      const rawTournamentId = String(req.params.id ?? "").trim();
      if (!ObjectId.isValid(rawTournamentId)) return res.status(400).json({ ok: false, message: "Turnaj není platný." });
      const tournamentId = new ObjectId(rawTournamentId);
      const date = String(req.body?.date ?? "").trim();
      const scores = req.body?.scores && typeof req.body.scores === "object" ? req.body.scores : {};
      const awards = req.body?.awards && typeof req.body.awards === "object" ? req.body.awards : {};
      const roundId = String(req.body?.roundId ?? "").trim();
      if (!date) return res.status(400).json({ ok: false, message: "Vyplň datum kola." });
      const db = getDb();
      const players = await db.collection("fantasyPlayers").find({ tournamentId }).sort({ order: 1 }).toArray();
      if (players.length === 0) return res.status(400).json({ ok: false, message: "Nejdřív založ hráče Fantasy." });
      const normalizedScores = Object.fromEntries(players.map((player) => {
        const value = scores[player.playerKey];
        const stringValue = String(value ?? "").trim();
        if (stringValue === "") return [player.playerKey, ""];
        if (stringValue.toUpperCase() === "N") return [player.playerKey, "N"];
        const number = Number(stringValue);
        return [player.playerKey, Number.isFinite(number) ? number : ""];
      }));
      const existing = ObjectId.isValid(roundId)
        ? await db.collection("fantasyRounds").findOne({ _id: new ObjectId(roundId), tournamentId })
        : await db.collection("fantasyRounds").findOne({ tournamentId, date });
      const roundNumber = existing?.roundNumber ?? await db.collection("fantasyRounds").countDocuments({ tournamentId }) + 1;
      await db.collection("fantasyRounds").updateOne(
        existing?._id ? { _id: existing._id } : { tournamentId, date },
        { $set: { tournamentId, date, scores: normalizedScores, awards, roundNumber, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true },
      );
      return res.json({ ok: true, message: "Fantasy kolo bylo uloženo." });
    } catch {
      return res.status(500).json({ ok: false, message: "Fantasy kolo se nepodařilo uložit." });
    }
  });

  app.delete("/api/admin/fantasy/tournaments/:id/rounds/:roundId", requireJwt, requireRole("admin"), async (req, res) => {
    try {
      const rawTournamentId = String(req.params.id ?? "").trim();
      const roundId = String(req.params.roundId ?? "").trim();
      if (!ObjectId.isValid(rawTournamentId) || !ObjectId.isValid(roundId)) return res.status(400).json({ ok: false, message: "Kolo není platné." });
      await getDb().collection("fantasyRounds").deleteOne({ _id: new ObjectId(roundId), tournamentId: new ObjectId(rawTournamentId) });
      return res.json({ ok: true, message: "Fantasy kolo bylo smazáno." });
    } catch {
      return res.status(500).json({ ok: false, message: "Fantasy kolo se nepodařilo smazat." });
    }
  });

  app.get("/api/data", async (req, res) => {
    try {
      const tournamentId = typeof req.query?.tournament === "string" ? req.query.tournament : undefined;
      if (tournamentId?.startsWith("db:")) {
        return res.json({ ok: true, tournamentId, ...(await loadMongoTournamentData(getDb, tournamentId, getOptionalSession(req))) });
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

  app.get("/api/fantasy/data", async (req, res) => {
    try {
      const rawTournamentId = String(req.query?.tournamentId ?? "").replace(/^db:/, "").trim();
      if (!ObjectId.isValid(rawTournamentId)) return res.status(400).json({ ok: false, message: "Turnaj není platný." });
      const tournamentId = new ObjectId(rawTournamentId);
      const db = getDb();
      const [tournament, players, periods, rounds, seasonStats, payouts] = await Promise.all([
        db.collection("tournaments").findOne({ _id: tournamentId, productType: "fantasy" }, { projection: { fantasyMonths: 1, heroLogo: 1, favicon: 1, fantasyPeriodRankLabel: 1, fantasyMoneyRules: 1, tieBreakRules: 1 } }),
        db.collection("fantasyPlayers").find({ tournamentId }).sort({ order: 1 }).toArray(),
        db.collection("fantasyPeriods").find({ tournamentId }).sort({ order: 1 }).toArray(),
        db.collection("fantasyRounds").find({ tournamentId }).sort({ roundNumber: 1 }).toArray(),
        db.collection("fantasySeasonStats").find({ tournamentId }).toArray(),
        db.collection("fantasyPayouts").find({ tournamentId }).toArray(),
      ]);
      if (players.length === 0 && rounds.length === 0) return res.json({ ok: true, players: [], periods: [{ id: "all", label: "Celkem" }], rounds: [], seasonStats: {}, prizeMoneyByPeriod: {}, longTermBankByPeriod: {}, tipsportStatsByPeriod: {}, fantasyMonths: tournament?.fantasyMonths || 0, heroLogo: tournament?.heroLogo || "", favicon: tournament?.favicon || "", fantasyPeriodRankLabel: tournament?.fantasyPeriodRankLabel || "Měsíční", fantasyMoneyRules: tournament?.fantasyMoneyRules || null, tieBreakRules: tournament?.tieBreakRules || [] });
      const playerKeys = players.map((player) => player.playerKey);
      const prizeMoneyByPeriod = {};
      const longTermBankByPeriod = {};
      const tipsportStatsByPeriod = {};
      for (const payout of payouts) {
        if (!prizeMoneyByPeriod[payout.periodId]) prizeMoneyByPeriod[payout.periodId] = {};
        if (!longTermBankByPeriod[payout.periodId]) longTermBankByPeriod[payout.periodId] = {};
        if (!tipsportStatsByPeriod[payout.periodId]) tipsportStatsByPeriod[payout.periodId] = {};
        prizeMoneyByPeriod[payout.periodId][payout.playerKey] = Number(payout.prizeMoney) || 0;
        longTermBankByPeriod[payout.periodId][payout.playerKey] = Number(payout.longTermBank) || 0;
        tipsportStatsByPeriod[payout.periodId][payout.playerKey] = { bestDailyRank: payout.bestDailyRank ?? null, bestPeriodRank: payout.bestPeriodRank ?? null, fantasyNets: Number(payout.fantasyNets) || 0 };
      }
      const monthLabels = { "1": "Leden", "2": "Únor", "3": "Březen", "4": "Duben", "5": "Květen", "6": "Červen", "7": "Červenec", "8": "Srpen", "9": "Září", "10": "Říjen", "11": "Listopad", "12": "Prosinec" };
      const generatedPeriods = [{ id: "all", label: "Celkem" }, ...[...new Set(rounds.map((round) => String(round.date).split('.')[1]).filter(Boolean))].map((month) => ({ id: month, label: monthLabels[month] || month, months: [month] }))];
      return res.json({
        ok: true,
        players: players.map((player) => ({ name: player.name, nick: player.nick || player.playerKey, entryFeePaid: Boolean(player.entryFeePaid) })),
        periods: (periods.length ? periods : generatedPeriods).map(({ id, label, months }) => ({ id, label, months })),
        rounds: rounds.map((round) => [round.date, playerKeys.map((key) => Object.prototype.hasOwnProperty.call(round.scores || {}, key) ? round.scores[key] : ''), round.awards || {}]),
        seasonStats: Object.fromEntries(seasonStats.map(({ playerKey, ...stats }) => [playerKey, { bestDailyRank: stats.bestDailyRank, bestPeriodRank: stats.bestPeriodRank, finalFantasyRank: stats.finalFantasyRank, fantasyNets: stats.fantasyNets }])),
        prizeMoneyByPeriod,
        longTermBankByPeriod,
        tipsportStatsByPeriod,
        fantasyMonths: tournament?.fantasyMonths || 0,
        heroLogo: tournament?.heroLogo || "",
        favicon: tournament?.favicon || "",
        fantasyPeriodRankLabel: tournament?.fantasyPeriodRankLabel || "Měsíční",
        fantasyMoneyRules: tournament?.fantasyMoneyRules || null,
        tieBreakRules: tournament?.tieBreakRules || [],
      });
    } catch (error) {
      return res.status(500).json({ ok: false, message: error?.message || "Fantasy data nejsou dostupná." });
    }
  });

  app.put("/api/admin/fantasy/tournaments/:id/periods", requireJwt, requireRole("admin"), async (req, res) => {
    try {
      const rawTournamentId = String(req.params.id ?? "").trim();
      if (!ObjectId.isValid(rawTournamentId)) return res.status(400).json({ ok: false, message: "Turnaj není platný." });
      const tournamentId = new ObjectId(rawTournamentId);
      const periods = Array.isArray(req.body?.periods) ? req.body.periods : [];
      const cleanedPeriods = [{ tournamentId, id: "all", label: "Celkem", order: 1 }, ...periods.map((period, index) => ({
        tournamentId,
        id: String(period?.id || `p${index + 1}`).trim(),
        label: String(period?.label || "").trim(),
        months: Array.isArray(period?.months) ? period.months.map(String).filter(Boolean) : [],
        order: index + 2,
      })).filter((period) => period.id && period.label && period.months.length > 0).slice(0, 24)];
      const db = getDb();
      await db.collection("fantasyPeriods").deleteMany({ tournamentId });
      await db.collection("fantasyPeriods").insertMany(cleanedPeriods);
      return res.json({ ok: true, periods: cleanedPeriods.map(({ id, label, months }) => ({ id, label, months })), message: "Fantasy období byla uložena." });
    } catch {
      return res.status(500).json({ ok: false, message: "Fantasy období se nepodařilo uložit." });
    }
  });

  app.put("/api/admin/fantasy/tournaments/:id/payouts", requireJwt, requireRole("admin"), async (req, res) => {
    try {
      const rawTournamentId = String(req.params.id ?? "").trim();
      if (!ObjectId.isValid(rawTournamentId)) return res.status(400).json({ ok: false, message: "Turnaj není platný." });
      const tournamentId = new ObjectId(rawTournamentId);
      const periodId = String(req.body?.periodId ?? "").trim();
      const payouts = req.body?.payouts && typeof req.body.payouts === "object" ? req.body.payouts : {};
      if (!periodId) return res.status(400).json({ ok: false, message: "Vyber období." });
      const db = getDb();
      const players = await db.collection("fantasyPlayers").find({ tournamentId }).toArray();
      const rows = players.map((player) => ({
        playerKey: player.playerKey,
        prizeMoney: payouts[player.playerKey]?.prizeMoney,
        longTermBank: payouts[player.playerKey]?.longTermBank,
        bestDailyRank: payouts[player.playerKey]?.bestDailyRank,
        bestPeriodRank: payouts[player.playerKey]?.bestPeriodRank,
        fantasyNets: payouts[player.playerKey]?.fantasyNets,
      }));
      await Promise.all(rows.map((row) => {
        const set = {};
        if (row.prizeMoney !== undefined) set.prizeMoney = Number(row.prizeMoney) || 0;
        if (row.longTermBank !== undefined) set.longTermBank = Number(row.longTermBank) || 0;
        if (row.bestDailyRank !== undefined) set.bestDailyRank = Number(row.bestDailyRank) || null;
        if (row.bestPeriodRank !== undefined) set.bestPeriodRank = Number(row.bestPeriodRank) || null;
        if (row.fantasyNets !== undefined) set.fantasyNets = Number(row.fantasyNets) || 0;
        return Object.keys(set).length === 0
          ? Promise.resolve()
          : db.collection("fantasyPayouts").updateOne({ tournamentId, periodId, playerKey: row.playerKey }, { $set: { tournamentId, periodId, playerKey: row.playerKey, ...set } }, { upsert: true });
      }));
      return res.json({ ok: true, message: "Fantasy výplaty byly uloženy." });
    } catch {
      return res.status(500).json({ ok: false, message: "Fantasy výplaty se nepodařilo uložit." });
    }
  });

  app.get("/api/admin/fantasy/tournaments/:id/rounds", requireJwt, requireRole("admin"), async (req, res) => {
    try {
      const rawTournamentId = String(req.params.id ?? "").trim();
      if (!ObjectId.isValid(rawTournamentId)) return res.status(400).json({ ok: false, message: "Turnaj není platný." });
      const tournamentId = new ObjectId(rawTournamentId);
      const rounds = await getDb().collection("fantasyRounds").find({ tournamentId }).sort({ roundNumber: 1 }).toArray();
      return res.json({ ok: true, rounds: rounds.map((round) => ({ _id: round._id.toString(), date: round.date, roundNumber: round.roundNumber, scores: round.scores || {}, awards: round.awards || {} })) });
    } catch {
      return res.status(500).json({ ok: false, message: "Fantasy kola se nepodařilo načíst." });
    }
  });
}

module.exports = { registerSharedRoutes };
