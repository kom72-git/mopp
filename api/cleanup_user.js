const { MongoClient, ObjectId } = require('mongodb');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const uri = process.env.MONGO_URI;
const dbName = process.env.MONGO_DB_NAME;

if (!uri || !dbName) {
  console.error("Chybí MONGO_URI nebo MONGO_DB_NAME v .env!");
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
      console.log(JSON.stringify({ found: false, deletedCount: 0 }));
      return;
    }
    
    const userIdObj = user._id;
    const userIdStr = user._id.toString();
    
    // Tady smažeme příslušné dokumenty
    // 1. users
    const usersDel = await db.collection('users').deleteOne({ _id: userIdObj });
    
    // 2. tips (userId je ObjectId nebo string)
    const tipsDel = await db.collection('tips').deleteMany({
      userId: { $in: [userIdObj, userIdStr] }
    });
    
    // 3. scheduleSelections (userId je string nebo ObjectId)
    const scheduleDel = await db.collection('scheduleSelections').deleteMany({
      userId: { $in: [userIdObj, userIdStr] }
    });
    
    // 4. passwordResetTokens (userId)
    const passwordDel = await db.collection('passwordResetTokens').deleteMany({
      userId: { $in: [userIdObj, userIdStr] }
    });
    
    const totalDeletedRelated = tipsDel.deletedCount + scheduleDel.deletedCount + passwordDel.deletedCount;
    
    console.log(JSON.stringify({
      found: true,
      userDeleted: usersDel.deletedCount,
      relatedDeleted: {
        tips: tipsDel.deletedCount,
        scheduleSelections: scheduleDel.deletedCount,
        passwordResetTokens: passwordDel.deletedCount,
        total: totalDeletedRelated
      }
    }, null, 2));

  } catch (err) {
    console.error("Chyba při běhu skriptu:", err);
  } finally {
    await client.close();
  }
}

run();
