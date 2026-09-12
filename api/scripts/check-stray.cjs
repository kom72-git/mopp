const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME);
  const tournamentId = new ObjectId(process.argv[2]);
  const periods = await db.collection('fantasyPeriods').find({ tournamentId }).toArray();
  const validIds = new Set(['all', ...periods.map((p) => p.id)]);
  const rows = await db.collection('fantasyPayouts').find({ tournamentId }).toArray();
  const stray = rows.filter((r) => !validIds.has(r.periodId));
  console.log('stray rows:', stray.length);
  stray.forEach((r) => console.log(r.periodId, r.playerKey));
  await client.close();
})();
