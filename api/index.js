const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs/promises");
const { spawn } = require("child_process");

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "mopp-api" });
});

app.get("/api/ping", (req, res) => {
  res.json({ message: "MOPP API běží", ts: new Date().toISOString() });
});

app.get("/api/data", async (req, res) => {
  try {
    const { fetchSheetData } = await import(path.resolve(__dirname, "../scripts/sheet-data.mjs"));
    const tournamentId = typeof req.query?.tournament === "string" ? req.query.tournament : undefined;
    const tipAuditFile = path.resolve(__dirname, "../public/tip-audit.json");

    let tipAuditByKey = {};
    try {
      const auditText = await fs.readFile(tipAuditFile, "utf8");
      const auditPayload = JSON.parse(auditText);
      const tips = auditPayload?.byTournament?.[tournamentId]?.tips;
      if (tips && typeof tips === "object") {
        tipAuditByKey = tips;
      }
    } catch {
      tipAuditByKey = {};
    }

    const data = await fetchSheetData({ tournamentId, tipAuditByKey });
    res.set("Cache-Control", "no-store");
    return res.json({ ok: true, tournamentId: tournamentId ?? null, ...data });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error?.message || "Nepodařilo se načíst data z Google Sheetu",
    });
  }
});

app.post("/api/sync-sheet", (req, res) => {
  const scriptPath = path.resolve(__dirname, "../scripts/sync-sheet.mjs");
  const child = spawn("node", [scriptPath, "--json"], {
    cwd: path.resolve(__dirname, ".."),
    env: process.env,
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });

  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  child.on("close", (code) => {
    if (code !== 0) {
      return res.status(500).json({
        ok: false,
        message: stderr.trim() || stdout.trim() || `Sync failed with exit code ${code}`,
      });
    }

    try {
      const payload = JSON.parse(stdout.trim());
      return res.json(payload);
    } catch {
      return res.status(500).json({
        ok: false,
        message: "Sync finished but API response could not be parsed",
      });
    }
  });
});

app.listen(port, () => {
  console.log(`MOPP API listening on http://localhost:${port}`);
});
