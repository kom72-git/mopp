const { MongoClient } = require("mongodb");

const username = String(process.argv[2] ?? "").trim().toLowerCase();
if (!username) {
  console.error("Usage: node scripts/promote-admin.cjs <username>");
  process.exit(1);
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect();
    const result = await client.db(process.env.MONGODB_DB_NAME).collection("users").updateOne(
      { username },
      { $set: { role: "admin", updatedAt: new Date() } },
    );
    if (result.matchedCount !== 1) throw new Error("User not found");
    console.log(`Admin role assigned to ${username}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
