import { defaultTournamentId, getTournamentById } from '../src/data/tournaments.js'

function toInt(value) {
  const clean = String(value ?? '').replace(/[^0-9-]/g, '')
  const parsed = Number.parseInt(clean, 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

function isValidTimestamp(value) {
  const text = String(value ?? '').trim()
  if (!text) return false
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(text)) return true
  const time = Number(new Date(text))
  return Number.isFinite(time)
}

function parseManualTipTimestampEntry(entry) {
  const text = String(entry ?? '').trim()
  if (!text) return null

  const matched = text.match(/^\s*(m\d+)\s*[,;|]\s*(p\d+)\s*[,;|]\s*(.+?)\s*$/i)
  if (!matched) return null

  const [, matchIdRaw, playerIdRaw, timestampRaw] = matched
  const matchId = matchIdRaw.toLowerCase()
  const playerId = playerIdRaw.toLowerCase()
  const timestamp = timestampRaw.trim()

  if (!isValidTimestamp(timestamp)) return null

  return {
    key: `${matchId}:${playerId}`,
    timestamp,
  }
}

function toManualTipAuditByKey(manualByMatchId) {
  const manualByKey = new Map()
  const manualMatchIds = new Set()
  const source = manualByMatchId && typeof manualByMatchId === 'object' ? manualByMatchId : {}

  for (const [matchId, byPlayer] of Object.entries(source)) {
    if (!byPlayer || typeof byPlayer !== 'object') continue
    manualMatchIds.add(String(matchId).toLowerCase())

    for (const [playerId, timestamp] of Object.entries(byPlayer)) {
      if (!isValidTimestamp(timestamp)) continue
      manualByKey.set(`${matchId}:${playerId}`, String(timestamp))
    }
  }

  return { manualByKey, manualMatchIds }
}

function toManualTipAuditByKeyFromEntries(entries) {
  const manualByKey = new Map()
  const manualMatchIds = new Set()
  const rows = Array.isArray(entries) ? entries : []

  for (const row of rows) {
    const parsed = parseManualTipTimestampEntry(row)
    if (!parsed) continue
    manualByKey.set(parsed.key, parsed.timestamp)
    manualMatchIds.add(parsed.key.split(':')[0])
  }

  return { manualByKey, manualMatchIds }
}

function parseCsv(csvText) {
  const rows = csvText.split(/\r?\n/).map((line) => line.split(','))
  const header = rows[3] ?? []
  const totals = rows[5] ?? []

  const playerNameCols = []
  for (let i = 0; i < header.length; i += 1) {
    const value = (header[i] ?? '').trim()
    if (!value) continue
    if (['Den', 'Kdy', 'Čas', 'Domácí', 'Hosté', 'Výsledek', 'Bank', 'vs.'].includes(value)) {
      continue
    }
    if (/^\(\d+\.\)$/.test(value)) continue
    if (i >= 15 && (i - 15) % 10 === 0) playerNameCols.push(i)
  }

  const players = playerNameCols.map((nameCol, idx) => ({
    id: `p${idx + 1}`,
    name: (header[nameCol] ?? '').trim(),
    points: toInt(totals[nameCol + 2] ?? ''),
    baseCol: nameCol - 1,
  }))

  const matches = []

  for (let r = 7; r < rows.length; r += 1) {
    const row = rows[r] ?? []

    const day = (row[1] ?? '').trim()
    const dayMatch = day.match(/\d+/)
    const round = dayMatch ? Number(dayMatch[0]) : null
    const date = (row[2] ?? '').trim()
    const time = (row[3] ?? '').trim()
    const home = (row[5] ?? '').trim()
    const away = (row[7] ?? '').trim()

    if (!home || !away) continue

    const scoreHome = (row[9] ?? '').trim()
    const scoreAway = (row[11] ?? '').trim()
    const score = scoreHome && scoreAway ? `${scoreHome}:${scoreAway}` : null
    const bank = toInt(row[12] ?? '')

    const startsAt = [day, date, time].filter(Boolean).join(' ')
    const matchId = `m${matches.length + 1}`

    const tips = players.map((player) => {
      const c = player.baseCol
      const pickHome = (row[c] ?? '').trim()
      const pickAway = (row[c + 2] ?? '').trim()
      const pick = pickHome && pickAway ? `${pickHome}:${pickAway}` : '-'
      const pointsRaw = (row[c + 3] ?? '').trim()
      const points = pointsRaw === '' ? null : Number(pointsRaw)

      return {
        playerId: player.id,
        pick,
        points: Number.isFinite(points) ? points : null,
      }
    })

    matches.push({
      id: matchId,
      round,
      startsAt,
      home,
      away,
      score,
      bank,
      tips,
    })
  }

  return {
    players: players.map(({ baseCol, ...player }) => player),
    matches,
  }
}

export async function fetchSheetData(options = {}) {
  const tournamentId = options.tournamentId ?? defaultTournamentId
  const tournament = getTournamentById(tournamentId)

  if (!tournament) {
    throw new Error(`Unknown tournament: ${tournamentId}`)
  }

  const url = `https://docs.google.com/spreadsheets/d/${tournament.sheetId}/export?format=csv&gid=${tournament.gid}`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Google Sheet download failed with ${response.status}`)
  }

  const csv = await response.text()
  const parsed = parseCsv(csv)

  const localAuditByKey = options.tipAuditByKey && typeof options.tipAuditByKey === 'object'
    ? new Map(Object.entries(options.tipAuditByKey))
    : new Map()
  const manualObjectAudit = toManualTipAuditByKey(tournament.manualTipUpdatedAtByMatchId)
  const manualEntryAudit = toManualTipAuditByKeyFromEntries(tournament.manualTipTimestampEntries)
  const manualMatchIds = new Set([...manualObjectAudit.manualMatchIds, ...manualEntryAudit.manualMatchIds])

  const auditByTipKey = new Map()
  for (const [key, value] of localAuditByKey.entries()) {
    const matchId = String(key).split(':')[0]?.toLowerCase() ?? ''
    if (manualMatchIds.has(matchId)) continue
    auditByTipKey.set(key, value)
  }

  for (const [key, timestamp] of manualObjectAudit.manualByKey.entries()) {
    auditByTipKey.set(key, timestamp)
  }
  for (const [key, timestamp] of manualEntryAudit.manualByKey.entries()) {
    auditByTipKey.set(key, timestamp)
  }

  return {
    players: parsed.players,
    matches: parsed.matches.map((match) => ({
      ...match,
      tips: (match.tips ?? []).map((tip) => ({
        ...tip,
        updatedAt: auditByTipKey.get(`${match.id}:${tip.playerId}`) ?? null,
      })),
    })),
  }
}