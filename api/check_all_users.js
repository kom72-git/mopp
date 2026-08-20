const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME;

async function run() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const users = await db.collection('users').find({}, { projection: { username: 1 } }).toArray();
    console.log("Users in database:", users);
  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}
run();
