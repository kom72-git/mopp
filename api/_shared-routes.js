const fs = require("fs/promises");
const path = require("path");
const { pathToFileURL } = require("url");
const { ObjectId } = require("mongodb");
const { getOptionalSession } = require("./_auth");

function dbTournamentId(id) {
  return `db:${id.toString()}`;
}

function sanitizeEntryFeePaidByPeriod(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => typeof key === "string" && key.trim())
      .slice(0, 24)
      .map(([key, paid]) => [key.trim().slice(0, 40), Boolean(paid)]),
  );
}

function normalizeFantasyIdentity(value) {
  return String(value ?? '').trim().toLowerCase();
}

function parseMatchStartTime(value) {
  const text = String(value ?? '').trim();
  if (!text) return Number.NaN;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) return new Date(text).getTime();
  const naive = new Date(`${text}:00Z`);
  if (Number.isNaN(naive.getTime())) return Number.NaN;
  const offsetLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Prague', timeZoneName: 'longOffset' }).formatToParts(naive).find((part) => part.type === 'timeZoneName')?.value || 'GMT+00:00';
  const offsetMatch = offsetLabel.match(/GMT([+-])(\d{2}):?(\d{2})/);
  const offsetMinutes = offsetMatch ? (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3])) * (offsetMatch[1] === '-' ? -1 : 1) : 0;
  return naive.getTime() - offsetMinutes * 60 * 1000;
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
    const hasStarted = match && parseMatchStartTime(match.startsAt) <= now;
    const isOwnTip = Boolean(session) && tip.userId.toString() === session.sub;
    if (!tipsByMatch.has(tip.matchId.toString())) tipsByMatch.set(tip.matchId.toString(), []);
    const points = scoreTip(`${tip.homeScore}:${tip.awayScore}`, match?.score, tournament.scoring);
    if (Number.isFinite(points)) pointsByUser.set(tip.userId.toString(), (pointsByUser.get(tip.userId.toString()) || 0) + points);
    tipsByMatch.get(tip.matchId.toString()).push({ ...tip, points, tipValueHidden: !hasStarted && !isOwnTip });
  }

  // Hraci bez vlastniho tipu se v tabulce zobrazi vzdy (N/N po zacatku zapasu, jinak jen "ceka na tip"),
  // aby ve sloupci poradi nevznikaly mezery pro hrace, kteri v tabulce chybi.
  for (const match of matches) {
    const hasStarted = parseMatchStartTime(match.startsAt) <= now;
    const matchKey = match._id.toString();
    const existingUserIds = new Set((tipsByMatch.get(matchKey) || []).map((tip) => tip.userId.toString()));
    for (const user of users) {
      if (existingUserIds.has(user._id.toString())) continue;
      if (!tipsByMatch.has(matchKey)) tipsByMatch.set(matchKey, []);
      tipsByMatch.get(matchKey).push(
        hasStarted
          ? { userId: user._id, homeScore: "N", awayScore: "N", tipValueHidden: false, points: 0, updatedAt: null, updatedState: "noBet" }
          : { userId: user._id, homeScore: null, awayScore: null, tipValueHidden: false, points: null, updatedAt: null, updatedState: "pending", notSubmitted: true },
      );
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
      tipsVisible: parseMatchStartTime(match.startsAt) <= now,
      ownTip: session ? (() => {
        const tip = tips.find((item) => item.matchId.equals(match._id) && item.userId.toString() === session.sub);
        return tip ? { homeScore: tip.homeScore, awayScore: tip.awayScore } : null;
      })() : null,
      tips: (tipsByMatch.get(match._id.toString()) || []).map((tip) => ({
        playerId: tip.userId.toString(),
        pick: tip.notSubmitted ? null : (tip.tipValueHidden ? null : `${tip.homeScore}:${tip.awayScore}`),
        tipValueHidden: Boolean(tip.tipValueHidden),
        notSubmitted: Boolean(tip.notSubmitted),
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

function parseFantasySheetCsv(csvText, options = {}) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];
    if (character === '"') {
      if (quoted && csvText[index + 1] === '"') { cell += '"'; index += 1; } else quoted = !quoted;
    } else if (character === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && csvText[index + 1] === '\n') index += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += character;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }

  const columnIndex = (column) => {
    let result = 0;
    for (const character of String(column || '').toUpperCase()) result = result * 26 + character.charCodeAt(0) - 64;
    return result - 1;
  };
  const headerRow = rows.findIndex((data) => data.some((value) => String(value).trim().toLowerCase() === 'hráč') && data.some((value) => String(value).trim().toLowerCase() === 'nick'));
  if (headerRow < 0) throw new Error('V záložce se nepodařilo najít hlavní tabulku s hlavičkami Hráč a nick.');
  const headers = rows[headerRow].map((value) => String(value || '').trim().toLowerCase());
  const headerColumn = (value) => headers.findIndex((header) => header === value);
  const playerNameColumn = headerColumn('hráč');
  const nickColumn = headerColumn('nick');
  const findHeaderAfter = (value, from = 0) => headers.findIndex((header, index) => index >= from && header === value);
  const dailyColumn = findHeaderAfter('nej fantasy umístění');
  const periodColumn = dailyColumn >= 0 ? dailyColumn + 1 : -1;
  const finalRankColumn = headerColumn('konečné umístění');
  const netsColumn = headerColumn('vyhrané nety');
  const prizeColumn = headerColumn('vyhrané peníze');
  const parseNumber = (value) => {
    const clean = String(value ?? '').replace(/[^0-9-]/g, '');
    return clean ? Number(clean) : null;
  };
  const players = rows.slice(headerRow + 1)
    .map((data) => ({
      name: String(data[playerNameColumn] || '').split('\n')[0].trim(),
      nick: String(data[nickColumn] || '').trim(),
      bestDailyRank: parseNumber(data[dailyColumn]),
      bestPeriodRank: parseNumber(data[periodColumn]),
      finalFantasyRank: parseNumber(data[finalRankColumn]),
      fantasyNets: parseNumber(data[netsColumn]) || 0,
      prizeMoney: parseNumber(data[prizeColumn]) || 0,
    }))
    .filter((player) => player.name && player.nick);
  if (!players.length) throw new Error('V záložce se nepodařilo najít hráče ve sloupcích Hráč/nick.');
  const playerRows = new Map(rows.slice(headerRow + 1).map((data) => [String(data[nickColumn] || '').trim(), data]));
  const rounds = [];
  const periodDates = new Map();
  let currentPeriodLabel = '';
  const roundStartColumn = columnIndex(options.roundStart || 'DC');
  const roundEndColumn = columnIndex(options.roundEnd || 'EH');
  if (roundStartColumn < 0 || roundEndColumn < roundStartColumn) throw new Error('Rozsah kol není platný. Zkontroluj první a poslední sloupec.');
  for (let column = roundStartColumn; column <= roundEndColumn; column += 1) {
    const date = String(rows[2]?.[column] || '').trim();
    if (!/^\d{1,2}\.\d{1,2}\.$/.test(date)) continue;
    const headerPeriod = String(rows[1]?.[column] || '').trim();
    if (headerPeriod) currentPeriodLabel = headerPeriod;
    const periodId = currentPeriodLabel ? `period-${currentPeriodLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : 'all';
    if (periodId !== 'all') {
      if (!periodDates.has(periodId)) periodDates.set(periodId, { id: periodId, label: currentPeriodLabel, months: [], roundDates: [] });
      periodDates.get(periodId).roundDates.push(date);
    }
    const scores = {};
    let hasScore = false;
    for (const player of players) {
      const rawScore = String(playerRows.get(player.nick)?.[column] || '').trim();
      if (!rawScore) { scores[player.nick] = ''; continue; }
      if (rawScore.toUpperCase() === 'N') { scores[player.nick] = 'N'; hasScore = true; continue; }
      const score = Number(rawScore.replace(/\s/g, ''));
      scores[player.nick] = Number.isFinite(score) ? score : '';
      hasScore = hasScore || Number.isFinite(score);
    }
    if (hasScore) rounds.push([date, players.map((player) => scores[player.nick]), {}]);
  }
  return { players, periods: [{ id: 'all', label: 'Celkem', months: [] }, ...periodDates.values()], rounds };
}

async function loadFantasySheetPreview(url, options = {}) {
  const matched = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!matched) throw new Error('Odkaz Google Sheetu nemá očekávaný formát.');
  const gidMatch = String(url).match(/[?#&]gid=([0-9]+)/);
  const exportUrl = `https://docs.google.com/spreadsheets/d/${matched[1]}/export?format=csv${gidMatch ? `&gid=${gidMatch[1]}` : ''}`;
  const response = await fetch(exportUrl);
  if (!response.ok) throw new Error('Google Sheet se nepodařilo načíst.');
  const parsed = parseFantasySheetCsv(await response.text(), options);
  return { ...parsed, sourceUrl: url, exportUrl };
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

  app.post("/api/admin/fantasy/import-preview", requireJwt, requireRole("admin"), async (req, res) => {
    try {
      const url = String(req.body?.url || '').trim();
      if (!/^https:\/\/docs\.google\.com\/spreadsheets\/d\//.test(url)) return res.status(400).json({ ok: false, message: 'Zadej odkaz na Google Sheet.' });
      return res.json({ ok: true, ...(await loadFantasySheetPreview(url, { roundStart: req.body?.roundStart, roundEnd: req.body?.roundEnd })) });
    } catch (error) {
      return res.status(400).json({ ok: false, message: error.message || 'Náhled se nepodařilo načíst.' });
    }
  });

  app.post("/api/admin/fantasy/import-confirm", requireJwt, requireRole("admin"), async (req, res) => {
    try {
      const name = String(req.body?.name || '').trim();
      const season = String(req.body?.season || '').trim();
      const sourceUrl = String(req.body?.sourceUrl || '').trim();
      const imported = req.body?.data && typeof req.body.data === 'object' ? req.body.data : {};
      const players = Array.isArray(imported.players) ? imported.players.slice(0, 100) : [];
      if (name.length < 2 || players.length === 0) return res.status(400).json({ ok: false, message: 'Chybí název turnaje nebo hráči.' });
      const db = getDb();
      const now = new Date();
      const existing = await db.collection('tournaments').findOne({ productType: 'fantasy', sourceUrl });
      if (existing?.published !== false) return res.status(409).json({ ok: false, message: 'Archiv s tímto zdrojem už byl publikován nebo není ve stagingu.' });
      const tournamentId = existing?._id || (await db.collection('tournaments').insertOne({ name, shortLabel: name, tabTitle: name, subtitle: 'Fantasy soutěž', season, status: 'finished', published: false, productType: 'fantasy', sourceUrl, createdAt: now, updatedAt: now })).insertedId;
      await Promise.all([
        db.collection('fantasyPlayers').deleteMany({ tournamentId }),
        db.collection('fantasyPeriods').deleteMany({ tournamentId }),
        db.collection('fantasyRounds').deleteMany({ tournamentId }),
        db.collection('fantasySeasonStats').deleteMany({ tournamentId }),
        db.collection('fantasyPayouts').deleteMany({ tournamentId }),
      ]);
      await db.collection('tournaments').updateOne({ _id: tournamentId }, { $set: { name, shortLabel: name, tabTitle: name, season, status: 'finished', published: false, productType: 'fantasy', sourceUrl, updatedAt: now } });
      await db.collection('fantasyPlayers').insertMany(players.map((player, index) => ({ tournamentId, playerKey: String(player.nick).trim(), nick: String(player.nick).trim(), name: String(player.name).trim(), order: index + 1 })));
      if (Array.isArray(imported.periods) && imported.periods.length > 0) await db.collection('fantasyPeriods').insertMany(imported.periods.map((period, index) => ({ tournamentId, id: String(period.id), label: String(period.label), months: Array.isArray(period.months) ? period.months : [], roundDates: Array.isArray(period.roundDates) ? period.roundDates : [], order: index + 1 })));
      else await db.collection('fantasyPeriods').insertOne({ tournamentId, id: 'all', label: 'Celkem', months: [], order: 1 });
      if (Array.isArray(imported.rounds) && imported.rounds.length > 0) await db.collection('fantasyRounds').insertMany(imported.rounds.map(([date, scores, awards], index) => ({ tournamentId, roundNumber: index + 1, date: String(date), scores: Object.fromEntries(players.map((player, playerIndex) => [String(player.nick).trim(), scores[playerIndex] ?? ''])), awards: awards || {} })));
      await db.collection('fantasySeasonStats').insertMany(players.map((player) => ({ tournamentId, playerKey: String(player.nick).trim(), bestDailyRank: player.bestDailyRank ?? null, bestPeriodRank: player.bestPeriodRank ?? null, finalFantasyRank: player.finalFantasyRank ?? null, fantasyNets: Number(player.fantasyNets) || 0 })));
      await db.collection('fantasyPayouts').insertMany(players.map((player) => ({ tournamentId, periodId: 'all', playerKey: String(player.nick).trim(), prizeMoney: Number(player.prizeMoney) || 0, longTermBank: 0, bestDailyRank: player.bestDailyRank ?? null, bestPeriodRank: player.bestPeriodRank ?? null, fantasyNets: Number(player.fantasyNets) || 0 })));
      return res.status(201).json({ ok: true, tournamentId: dbTournamentId(tournamentId), message: 'Archiv byl importován jako neveřejný náhled. Zkontroluj ho v adminu a potom ho publikuj.' });
    } catch (error) {
      return res.status(500).json({ ok: false, message: error.message || 'Archiv se nepodařilo importovat.' });
    }
  });

  app.post("/api/admin/fantasy/tournaments/:id/publish", requireJwt, requireRole("admin"), async (req, res) => {
    try {
      if (!ObjectId.isValid(String(req.params.id))) return res.status(400).json({ ok: false, message: 'Turnaj není platný.' });
      const result = await getDb().collection('tournaments').updateOne({ _id: new ObjectId(req.params.id), productType: 'fantasy' }, { $set: { published: true, updatedAt: new Date() } });
      if (!result.matchedCount) return res.status(404).json({ ok: false, message: 'Turnaj nebyl nalezen.' });
      return res.json({ ok: true, message: 'Archiv byl publikován.' });
    } catch { return res.status(500).json({ ok: false, message: 'Archiv se nepodařilo publikovat.' }); }
  });

  app.get("/api/admin/fantasy/users", requireJwt, requireRole("admin"), async (req, res) => {
    try {
      const users = await getDb().collection("users")
        .find({ status: "active" }, { projection: { username: 1, displayName: 1, avatar: 1, role: 1 } })
        .sort({ displayName: 1, username: 1 })
        .toArray();
      return res.json({ ok: true, users: users.map((user) => ({ ...user, _id: user._id.toString() })) });
    } catch {
      return res.status(500).json({ ok: false, message: "Účty se nepodařilo načíst." });
    }
  });

  app.get("/api/fantasy/tournaments", async (req, res) => {
    try {
      const canSeeStaged = getOptionalSession(req)?.role === "admin";
      const query = canSeeStaged ? { productType: "fantasy" } : { productType: "fantasy", published: { $ne: false } };
      const tournaments = await getDb().collection("tournaments").find(query).sort({ createdAt: -1 }).toArray();
      return res.json({ ok: true, tournaments: tournaments.map((tournament) => ({ _id: tournament._id.toString(), name: tournament.name, shortLabel: tournament.shortLabel || tournament.name, subtitle: tournament.subtitle || "Fantasy soutěž", season: tournament.season, status: tournament.status, published: tournament.published !== false, startDate: tournament.startDate || "", endDate: tournament.endDate || "", fantasyMonths: tournament.fantasyMonths || null, heroLogo: tournament.heroLogo || "", favicon: tournament.favicon || "", fantasyPeriodRankLabel: tournament.fantasyPeriodRankLabel || "Měsíční", fantasyMoneyRules: tournament.fantasyMoneyRules || null, tieBreakRules: tournament.tieBreakRules || [] })) });
    } catch {
      return res.status(500).json({ ok: false, message: "Fantasy turnaje se nepodařilo načíst." });
    }
  });

  app.post("/api/admin/fantasy/tournaments", requireJwt, requireRole("admin"), async (req, res) => {
    try {
      const name = String(req.body?.name ?? "").trim();
      const season = String(req.body?.season ?? "").trim();
      const startDate = String(req.body?.startDate ?? "").trim();
      const endDate = String(req.body?.endDate ?? "").trim();
      const fantasyMonths = Math.max(0, Number(req.body?.fantasyMonths) || 0);
      const heroLogo = String(req.body?.heroLogo ?? "").trim();
      const favicon = String(req.body?.favicon ?? "").trim();
      const shortLabel = String(req.body?.shortLabel ?? "").trim().slice(0, 60);
      const subtitle = String(req.body?.subtitle ?? "Fantasy soutěž").trim().slice(0, 80) || "Fantasy soutěž";
      const fantasyPeriodRankLabel = String(req.body?.fantasyPeriodRankLabel ?? "Měsíční").trim() || "Měsíční";
      const fantasyMoneyRules = req.body?.fantasyMoneyRules && typeof req.body.fantasyMoneyRules === "object" ? req.body.fantasyMoneyRules : {};
      const tieBreakRules = Array.isArray(req.body?.tieBreakRules) ? req.body.tieBreakRules.map((rule) => String(rule ?? "").trim()).filter(Boolean).slice(0, 5) : [];
      if (name.length < 2 || name.length > 100) return res.status(400).json({ ok: false, message: "Název turnaje musí mít 2 až 100 znaků." });
      const now = new Date();
      const tournament = { name, shortLabel: shortLabel || name, tabTitle: shortLabel || name, subtitle, season, startDate, endDate, status: "draft", productType: "fantasy", fantasyMonths, heroLogo, favicon, fantasyPeriodRankLabel, fantasyMoneyRules, tieBreakRules, roundLabel: "kolo", createdAt: now, updatedAt: now };
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
      const startDate = String(req.body?.startDate ?? "").trim();
      const endDate = String(req.body?.endDate ?? "").trim();
      const fantasyMonths = Math.max(0, Number(req.body?.fantasyMonths) || 0);
      const heroLogo = String(req.body?.heroLogo ?? "").trim();
      const favicon = String(req.body?.favicon ?? "").trim();
      const status = String(req.body?.status ?? "draft").trim();
      const shortLabel = String(req.body?.shortLabel ?? "").trim().slice(0, 60);
      const subtitle = String(req.body?.subtitle ?? "Fantasy soutěž").trim().slice(0, 80) || "Fantasy soutěž";
      const fantasyPeriodRankLabel = String(req.body?.fantasyPeriodRankLabel ?? "Měsíční").trim() || "Měsíční";
      const fantasyMoneyRules = req.body?.fantasyMoneyRules && typeof req.body.fantasyMoneyRules === "object" ? req.body.fantasyMoneyRules : {};
      const tieBreakRules = Array.isArray(req.body?.tieBreakRules) ? req.body.tieBreakRules.map((rule) => String(rule ?? "").trim()).filter(Boolean).slice(0, 5) : [];
      if (!ObjectId.isValid(rawTournamentId)) return res.status(400).json({ ok: false, message: "Turnaj není platný." });
      if (name.length < 2 || name.length > 100) return res.status(400).json({ ok: false, message: "Název turnaje musí mít 2 až 100 znaků." });
      if (!["draft", "active", "finished"].includes(status)) return res.status(400).json({ ok: false, message: "Neplatný stav turnaje." });
      const result = await getDb().collection("tournaments").findOneAndUpdate(
        { _id: new ObjectId(rawTournamentId), productType: "fantasy" },
        { $set: { name, shortLabel: shortLabel || name, tabTitle: shortLabel || name, subtitle, season, status, startDate, endDate, fantasyMonths, heroLogo, favicon, fantasyPeriodRankLabel, fantasyMoneyRules, tieBreakRules, updatedAt: new Date() } },
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
        userId: ObjectId.isValid(String(player?.userId ?? "")) ? String(player.userId) : "",
        playerKey: String(player?.nick || player?.name || `p${index + 1}`).trim(),
        nick: String(player?.nick || player?.name || `p${index + 1}`).trim(),
        name: String(player?.name || player?.nick || `Hráč ${index + 1}`).trim(),
        nameOverride: Boolean(player?.nameOverride),
        entryFeePaidByPeriod: sanitizeEntryFeePaidByPeriod(player?.entryFeePaidByPeriod),
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
      const [tournament, players, periods, rounds, seasonStats, payouts, users] = await Promise.all([
        db.collection("tournaments").findOne({ _id: tournamentId, productType: "fantasy" }, { projection: { fantasyMonths: 1, heroLogo: 1, favicon: 1, fantasyPeriodRankLabel: 1, fantasyMoneyRules: 1, tieBreakRules: 1 } }),
        db.collection("fantasyPlayers").find({ tournamentId }).sort({ order: 1 }).toArray(),
        db.collection("fantasyPeriods").find({ tournamentId }).sort({ order: 1 }).toArray(),
        db.collection("fantasyRounds").find({ tournamentId }).sort({ roundNumber: 1 }).toArray(),
        db.collection("fantasySeasonStats").find({ tournamentId }).toArray(),
        db.collection("fantasyPayouts").find({ tournamentId }).toArray(),
        db.collection("users").find({}, { projection: { username: 1, displayName: 1, avatar: 1 } }).toArray(),
      ]);
      if (players.length === 0 && rounds.length === 0) return res.json({ ok: true, players: [], periods: [{ id: "all", label: "Celkem" }], rounds: [], seasonStats: {}, prizeMoneyByPeriod: {}, longTermBankByPeriod: {}, tipsportStatsByPeriod: {}, fantasyMonths: tournament?.fantasyMonths || 0, heroLogo: tournament?.heroLogo || "", favicon: tournament?.favicon || "", fantasyPeriodRankLabel: tournament?.fantasyPeriodRankLabel || "Měsíční", fantasyMoneyRules: tournament?.fantasyMoneyRules || null, tieBreakRules: tournament?.tieBreakRules || [] });
      const playerKeys = players.map((player) => player.playerKey);
      const usersByIdentity = new Map();
      for (const user of users) {
        const avatar = String(user.avatar || '').trim();
        if (!avatar) continue;
        for (const identity of [user.username, user.displayName]) {
          const key = normalizeFantasyIdentity(identity);
          if (key && !usersByIdentity.has(key)) usersByIdentity.set(key, avatar);
        }
      }
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
        players: players.map((player) => {
          const nick = player.nick || player.playerKey;
          const linkedUser = player.userId ? users.find((user) => user._id.toString() === String(player.userId)) : null;
          const avatar = linkedUser?.avatar || usersByIdentity.get(normalizeFantasyIdentity(nick)) || usersByIdentity.get(normalizeFantasyIdentity(player.name)) || '';
          const name = player.nameOverride ? player.name : (linkedUser?.displayName || linkedUser?.username || player.name);
          return { id: player._id?.toString() || player.playerKey, userId: player.userId || '', name, nameOverride: Boolean(player.nameOverride), nick, avatar, entryFeePaidByPeriod: sanitizeEntryFeePaidByPeriod(player.entryFeePaidByPeriod) };
        }),
        periods: (periods.length ? periods : generatedPeriods).map(({ id, label, months, roundDates }) => ({ id, label, months, roundDates })),
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
        finalFantasyRank: payouts[player.playerKey]?.finalFantasyRank,
      }));
      await Promise.all(rows.map((row) => {
        const set = {};
        if (row.prizeMoney !== undefined) set.prizeMoney = Number(row.prizeMoney) || 0;
        if (row.longTermBank !== undefined) set.longTermBank = Number(row.longTermBank) || 0;
        if (row.bestDailyRank !== undefined) set.bestDailyRank = Number(row.bestDailyRank) || null;
        if (row.bestPeriodRank !== undefined) set.bestPeriodRank = Number(row.bestPeriodRank) || null;
        if (row.fantasyNets !== undefined) set.fantasyNets = Number(row.fantasyNets) || 0;
        const payoutWrite = Object.keys(set).length === 0
          ? Promise.resolve()
          : db.collection("fantasyPayouts").updateOne({ tournamentId, periodId, playerKey: row.playerKey }, { $set: { tournamentId, periodId, playerKey: row.playerKey, ...set } }, { upsert: true });
        const seasonStatsWrite = row.finalFantasyRank !== undefined
          ? db.collection("fantasySeasonStats").updateOne(
            { tournamentId, playerKey: row.playerKey },
            { $set: { finalFantasyRank: Number(row.finalFantasyRank) || null }, $setOnInsert: { tournamentId, playerKey: row.playerKey } },
            { upsert: true },
          )
          : Promise.resolve();
        return Promise.all([payoutWrite, seasonStatsWrite]);
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
