const express = require("express");
const cors = require("cors");

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "mopp-api" });
});

app.get("/api/ping", (req, res) => {
  res.json({ message: "MOPP API bezi", ts: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(`MOPP API listening on http://localhost:${port}`);
});
