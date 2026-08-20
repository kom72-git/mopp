const { MongoClient, ObjectId } = require('mongodb');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME;

if (!uri || !dbName) {
  console.error("Chybí MONGODB_URI nebo MONGODB_DB_NAME v .env!");
  process.exit(1);
}

async function run() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    
    // Najdi uživatele podle username
    const username = 'kom_test1';
    const user = await db.collection('users').findOne({ username });
    
    if (!user) {
      console.log(JSON.stringify({ found: false }));
      return;
    }
    
    const userIdObj = user._id;
    const userIdStr = user._id.toString();
    
    const tipsCount = await db.collection('tips').countDocuments({
      userId: { $in: [userIdObj, userIdStr] }
    });
    
    const scheduleCount = await db.collection('scheduleSelections').countDocuments({
      userId: { $in: [userIdObj, userIdStr] }
    });
    
    const passwordCount = await db.collection('passwordResetTokens').countDocuments({
      userId: { $in: [userIdObj, userIdStr] }
    });
    
    console.log(JSON.stringify({
      found: true,
      username: username,
      userId: userIdStr,
      counts: {
        tips: tipsCount,
        scheduleSelections: scheduleCount,
        passwordResetTokens: passwordCount
      }
    }, null, 2));

  } catch (err) {
    console.error("Chyba při běhu skriptu:", err);
  } finally {
    await client.close();
  }
}

run();
