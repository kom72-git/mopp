// Jednorazovy patch: doplni bestDailyRank/bestPeriodRank/fantasyNets do existujicich fantasyPayouts
// pro archivni Fantasy turnaj, podle dat vytazenych z Google Sheetu (viz konverzace).
const path = require('path');
const { MongoClient } = require('mongodb');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// klic = cislo mesice (nebo "2-3" pro slouceny unor+brezen), hodnota = { nick: { bestDailyRank, bestPeriodRank, fantasyNets } }
const sheetStatsByMonthKey = {
  '9': { joudik: { bestDailyRank: 95, bestPeriodRank: 1581, fantasyNets: 70 }, komurka72: { bestDailyRank: 437, bestPeriodRank: 3531, fantasyNets: 10 }, aleprochazkova: { bestDailyRank: 763, bestPeriodRank: 5393, fantasyNets: 0 }, Slana22: { bestDailyRank: 3260, bestPeriodRank: 6307, fantasyNets: 0 }, Libero15: { bestDailyRank: 3443, bestPeriodRank: 11294, fantasyNets: 0 } },
  '10': { Libero15: { bestDailyRank: 571, bestPeriodRank: 6191, fantasyNets: 0 }, joudik: { bestDailyRank: 524, bestPeriodRank: 4893, fantasyNets: 0 }, Slana22: { bestDailyRank: 911, bestPeriodRank: 9571, fantasyNets: 0 }, aleprochazkova: { bestDailyRank: 1420, bestPeriodRank: 8888, fantasyNets: 0 }, komurka72: { bestDailyRank: 1866, bestPeriodRank: 12877, fantasyNets: 0 } },
  '11': { joudik: { bestDailyRank: 49, bestPeriodRank: 76, fantasyNets: 385 }, aleprochazkova: { bestDailyRank: 933, bestPeriodRank: 1114, fantasyNets: 30 }, Libero15: { bestDailyRank: 1054, bestPeriodRank: 11807, fantasyNets: 0 }, Slana22: { bestDailyRank: 4014, bestPeriodRank: 9662, fantasyNets: 0 }, komurka72: { bestDailyRank: 3454, bestPeriodRank: 17709, fantasyNets: 0 } },
  '12': { komurka72: { bestDailyRank: 214, bestPeriodRank: 849, fantasyNets: 75 }, joudik: { bestDailyRank: 247, bestPeriodRank: 1941, fantasyNets: 45 }, aleprochazkova: { bestDailyRank: 1765, bestPeriodRank: 2541, fantasyNets: 0 }, Slana22: { bestDailyRank: 3846, bestPeriodRank: 8879, fantasyNets: 0 }, Libero15: { bestDailyRank: 3053, bestPeriodRank: 10599, fantasyNets: 0 } },
  '1': { aleprochazkova: { bestDailyRank: 1297, bestPeriodRank: 3456, fantasyNets: 0 }, Libero15: { bestDailyRank: 1401, bestPeriodRank: 5927, fantasyNets: 0 }, joudik: { bestDailyRank: 334, bestPeriodRank: 6311, fantasyNets: 10 }, komurka72: { bestDailyRank: 726, bestPeriodRank: 11553, fantasyNets: 0 }, Slana22: { bestDailyRank: 1409, bestPeriodRank: 10980, fantasyNets: 0 } },
  '2': { Libero15: { bestDailyRank: 598, bestPeriodRank: 4001, fantasyNets: 0 }, komurka72: { bestDailyRank: 897, bestPeriodRank: 1050, fantasyNets: 30 }, aleprochazkova: { bestDailyRank: 1193, bestPeriodRank: 3558, fantasyNets: 50 }, joudik: { bestDailyRank: 1921, bestPeriodRank: 7970, fantasyNets: 100 }, Slana22: { bestDailyRank: 3984, bestPeriodRank: 12132, fantasyNets: 0 } },
};
// 'all' (celkem) bereme primo z fantasySeasonStats, tam uz spravna data jsou (viz drivejsi oprava v FantasyOverview.jsx).

async function main() {
  if (!process.env.MONGODB_URI || !process.env.MONGODB_DB_NAME) throw new Error('Missing MONGODB_URI or MONGODB_DB_NAME');
  const tournamentArg = process.argv.find((arg) => arg.startsWith('--tournament-id='));
  const rawTournamentId = tournamentArg?.split('=')[1];
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME);
  const { ObjectId } = require('mongodb');

  let tournament;
  if (rawTournamentId && ObjectId.isValid(rawTournamentId)) {
    tournament = await db.collection('tournaments').findOne({ _id: new ObjectId(rawTournamentId), productType: 'fantasy' });
  } else {
    const fantasyTournaments = await db.collection('tournaments').find({ productType: 'fantasy' }).toArray();
    if (fantasyTournaments.length !== 1) {
      console.log(`Nalezeno ${fantasyTournaments.length} Fantasy turnaju, over --tournament-id=<id>:`);
      fantasyTournaments.forEach((t) => console.log(`  ${t._id} - ${t.name} (${t.season || 'bez sezony'})`));
      await client.close();
      return;
    }
    [tournament] = fantasyTournaments;
  }
  if (!tournament) throw new Error('Turnaj nenalezen');
  console.log(`Pouziva se turnaj: ${tournament.name} (${tournament._id})`);

  const periods = await db.collection('fantasyPeriods').find({ tournamentId: tournament._id }).toArray();
  const players = await db.collection('fantasyPlayers').find({ tournamentId: tournament._id }).toArray();
  const nickByPlayerKey = new Map(players.map((p) => [p.playerKey, p.nick || p.playerKey]));

  let updates = 0;
  for (const period of periods) {
    const months = (period.months || []).map(String);
    // najdi vsechny mesicni bloky, ktere spadaji do tohoto obdobi (podpora slouceni napr. unor+brezen)
    const relevantMonthKeys = months.filter((m) => sheetStatsByMonthKey[m]);
    if (relevantMonthKeys.length === 0) continue;

    for (const player of players) {
      const nick = nickByPlayerKey.get(player.playerKey) || player.playerKey;
      // pokud je obdobi slouceno z vic mesicu, bereme posledni dostupny mesic (nejaktualnejsi snapshot)
      const lastMonthKey = relevantMonthKeys[relevantMonthKeys.length - 1];
      const stats = sheetStatsByMonthKey[lastMonthKey][nick];
      if (!stats) continue;

      const result = await db.collection('fantasyPayouts').updateOne(
        { tournamentId: tournament._id, periodId: period.id, playerKey: player.playerKey },
        { $set: { bestDailyRank: stats.bestDailyRank, bestPeriodRank: stats.bestPeriodRank, fantasyNets: stats.fantasyNets } },
        { upsert: true },
      );
      if (result.matchedCount > 0 || result.upsertedCount > 0) updates += 1;
      if (result.upsertedCount > 0) console.log(`  Novy radek: perioda ${period.id} (${period.label}), hrac ${nick}`);
    }
  }
  console.log(`Hotovo, aktualizovano ${updates} radku fantasyPayouts.`);
  await client.close();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
