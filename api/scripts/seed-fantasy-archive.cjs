const path = require('path');
const { pathToFileURL } = require('url');
const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function readFantasyData() {
  return import(pathToFileURL(path.resolve(__dirname, '../../src/data/fantasyArchive.js')).href);
}

async function main() {
  if (!process.env.MONGODB_URI || !process.env.MONGODB_DB_NAME) throw new Error('Missing MONGODB_URI or MONGODB_DB_NAME');
  const tournamentArg = process.argv.find((arg) => arg.startsWith('--tournament-id='));
  const rawTournamentId = tournamentArg?.split('=')[1];
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME);
  const now = new Date();
  let tournamentId = rawTournamentId && ObjectId.isValid(rawTournamentId) ? new ObjectId(rawTournamentId) : null;
  if (!tournamentId) {
    const existing = await db.collection('tournaments').findOne({ name: 'Fantasy ELH 2024/25', productType: 'fantasy' });
    tournamentId = existing?._id ?? (await db.collection('tournaments').insertOne({
      name: 'Fantasy ELH 2024/25',
      shortLabel: 'ELH 2024/25',
      tabTitle: 'Fantasy ELH 2024/25',
      subtitle: 'Tipsport Fantasy',
      season: '2024/25',
      status: 'finished',
      productType: 'fantasy',
      roundLabel: 'kolo',
      createdAt: now,
      updatedAt: now,
    })).insertedId;
  }

  const { fantasyPlayers, fantasySeasonStats, fantasyPrizeMoneyByPeriod, fantasyLongTermBankByPeriod, periods, fantasyRounds } = await readFantasyData();
  await Promise.all([
    db.collection('fantasyPlayers').deleteMany({ tournamentId }),
    db.collection('fantasyPeriods').deleteMany({ tournamentId }),
    db.collection('fantasyRounds').deleteMany({ tournamentId }),
    db.collection('fantasySeasonStats').deleteMany({ tournamentId }),
    db.collection('fantasyPayouts').deleteMany({ tournamentId }),
  ]);

  await db.collection('fantasyPlayers').insertMany(fantasyPlayers.map((player, index) => ({ tournamentId, playerKey: player.nick, name: player.name, nick: player.nick, order: index + 1 })));
  await db.collection('fantasyPeriods').insertMany(periods.map((period, index) => ({ tournamentId, ...period, order: index + 1 })));
  await db.collection('fantasyRounds').insertMany(fantasyRounds.map(([date, scores], index) => ({ tournamentId, roundNumber: index + 1, date, scores: Object.fromEntries(fantasyPlayers.map((player, playerIndex) => [player.nick, scores[playerIndex] ?? null])) })));
  await db.collection('fantasySeasonStats').insertMany(Object.entries(fantasySeasonStats).map(([playerKey, stats]) => ({ tournamentId, playerKey, ...stats })));
  const payoutRows = [];
  for (const [periodId, payouts] of Object.entries(fantasyPrizeMoneyByPeriod)) {
    for (const [playerKey, prizeMoney] of Object.entries(payouts)) payoutRows.push({ tournamentId, periodId, playerKey, prizeMoney, longTermBank: fantasyLongTermBankByPeriod[periodId]?.[playerKey] ?? 0 });
  }
  for (const [periodId, payouts] of Object.entries(fantasyLongTermBankByPeriod)) {
    for (const [playerKey, longTermBank] of Object.entries(payouts)) {
      if (payoutRows.some((row) => row.periodId === periodId && row.playerKey === playerKey)) continue;
      payoutRows.push({ tournamentId, periodId, playerKey, prizeMoney: 0, longTermBank });
    }
  }
  if (payoutRows.length) await db.collection('fantasyPayouts').insertMany(payoutRows);
  await db.collection('tournaments').updateOne({ _id: tournamentId }, { $set: { productType: 'fantasy', updatedAt: now } });
  console.log(`Fantasy archive seeded: db:${tournamentId.toString()}`);
  await client.close();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
