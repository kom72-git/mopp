const fs = require('fs/promises')
const path = require('path')

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, message: 'Method not allowed' })
    return
  }

  try {
    const { fetchSheetData } = await import('../scripts/sheet-data.mjs')
    const tournamentId = typeof req.query.tournament === 'string' ? req.query.tournament : undefined
    const tipAuditFile = path.resolve(process.cwd(), 'public/tip-audit.json')

    let tipAuditByKey = {}
    try {
      const auditText = await fs.readFile(tipAuditFile, 'utf8')
      const auditPayload = JSON.parse(auditText)
      const tips = auditPayload?.byTournament?.[tournamentId]?.tips
      if (tips && typeof tips === 'object') {
        tipAuditByKey = tips
      }
    } catch {
      tipAuditByKey = {}
    }

    const data = await fetchSheetData({ tournamentId, tipAuditByKey })
    res.setHeader('Cache-Control', 'no-store, max-age=0')
    res.status(200).json({ ok: true, tournamentId: tournamentId ?? null, ...data })
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error?.message || 'Nepodařilo se načíst data z Google Sheetu',
    })
  }
}