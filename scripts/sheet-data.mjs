import { defaultTournamentId, getTournamentById } from '../src/data/tournaments.js'

function toInt(value) {
  const clean = String(value ?? '').replace(/[^0-9-]/g, '')
  const parsed = Number.parseInt(clean, 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function toColumnLetter(columnNumber) {
  let value = Number(columnNumber)
  let output = ''
  while (value > 0) {
    const mod = (value - 1) % 26
    output = String.fromCharCode(65 + mod) + output
    value = Math.floor((value - 1) / 26)
  }
  return output
}

function normalizeTipAuditEntry(value, fallbackState = 'updated') {
  if (typeof value === 'string') {
    const updatedAt = value.trim()
    return updatedAt ? { updatedAt, updatedState: fallbackState } : null
  }

  if (!value || typeof value !== 'object') return null

  const updatedAt = String(value.updatedAt ?? value.timestamp ?? '').trim()
  if (!updatedAt) return null

  const state = String(value.updatedState ?? value.state ?? fallbackState).trim().toLowerCase()
  const updatedState = state === 'inserted' || state === 'vloženo' ? 'inserted' : 'updated'
  return { updatedAt, updatedState }
}

function normalizeStampTime(timeRaw) {
  const text = String(timeRaw ?? '').trim()
  if (!text) return ''

  const hhmmss = text.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (hhmmss) {
    const [, hh, mm, ss = '00'] = hhmmss
    return `${hh}:${mm}:${ss}`
  }

  return text
}

function toSortStamp(dateRaw, timeRaw) {
  const date = String(dateRaw ?? '').trim()
  const time = normalizeStampTime(timeRaw)
  if (!date || !time) return ''
  return `${date} ${time}`
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
    pickHomeColLetter: toColumnLetter(nameCol),
    pickAwayColLetter: toColumnLetter(nameCol + 2),
  }))

  const matches = []
  const matchIdBySheetRow = new Map()

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
      sheetRow: r + 1,
      tips,
    })

    matchIdBySheetRow.set(r + 1, matchId)
  }

  const playerMetaById = new Map(
    players.map((player) => [
      player.id,
      {
        name: player.name,
        allowedColumns: new Set([player.pickHomeColLetter, player.pickAwayColLetter]),
      },
    ]),
  )

  return {
    players: players.map(({ baseCol, pickHomeColLetter, pickAwayColLetter, ...player }) => player),
    matches: matches.map(({ sheetRow, ...match }) => match),
    meta: {
      playerMetaById,
      matchIdBySheetRow,
    },
  }
}

function parseTipStampCsv(csvText, parsedData) {
  const rows = csvText
    .split(/\r?\n/)
    .map((line) => line.split(','))
    .filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''))

  if (rows.length <= 1) return new Map()

  const playerIdByName = new Map(
    (parsedData.players ?? []).map((player) => [normalizeText(player.name), player.id]),
  )

  const playerMetaById = parsedData.meta?.playerMetaById ?? new Map()
  const matchIdBySheetRow = parsedData.meta?.matchIdBySheetRow ?? new Map()
  const historyByKey = new Map()

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] ?? []
    const date = String(row[0] ?? '').trim()
    const time = normalizeStampTime(row[1])
    const playerName = String(row[2] ?? '').trim()
    const column = String(row[3] ?? '').trim().toUpperCase()
    const sheetRowRaw = String(row[4] ?? '').trim()
    const version = String(row[8] ?? '').trim()

    const playerId = playerIdByName.get(normalizeText(playerName))
    if (!playerId) continue

    const sheetRow = Number.parseInt(sheetRowRaw, 10)
    if (!Number.isFinite(sheetRow)) continue

    const matchId = matchIdBySheetRow.get(sheetRow)
    if (!matchId) continue

    const allowedColumns = playerMetaById.get(playerId)?.allowedColumns
    if (allowedColumns && !allowedColumns.has(column)) continue

    const sortStamp = toSortStamp(date, time)
    if (!sortStamp) continue

    const key = `${matchId}:${playerId}`
    const existing = historyByKey.get(key)
    if (!existing) {
      historyByKey.set(key, {
        firstSortStamp: sortStamp,
        lastSortStamp: sortStamp,
        lastUpdatedAt: `${date} ${time.slice(0, 5)}`,
        hasEditedVersion: Boolean(version),
      })
      continue
    }

    if (sortStamp < existing.firstSortStamp) {
      existing.firstSortStamp = sortStamp
    }
    if (sortStamp >= existing.lastSortStamp) {
      existing.lastSortStamp = sortStamp
      existing.lastUpdatedAt = `${date} ${time.slice(0, 5)}`
    }
    if (version) {
      existing.hasEditedVersion = true
    }
  }

  const byTipKey = new Map()
  for (const [key, record] of historyByKey.entries()) {
    byTipKey.set(key, {
      updatedAt: record.lastUpdatedAt,
      updatedState: record.hasEditedVersion ? 'updated' : 'inserted',
    })
  }

  return byTipKey
}

export async function fetchSheetData(options = {}) {
  const tournamentId = options.tournamentId ?? defaultTournamentId
  const tournament = getTournamentById(tournamentId)

  if (!tournament) {
    throw new Error(`Unknown tournament: ${tournamentId}`)
  }

  const dataUrl = `https://docs.google.com/spreadsheets/d/${tournament.sheetId}/export?format=csv&gid=${tournament.gid}`
  const stampUrl = tournament.tipStampGid
    ? `https://docs.google.com/spreadsheets/d/${tournament.sheetId}/export?format=csv&gid=${tournament.tipStampGid}`
    : ''

  const [dataResponse, stampResponse] = await Promise.all([
    fetch(dataUrl),
    stampUrl ? fetch(stampUrl).catch(() => null) : Promise.resolve(null),
  ])

  if (!dataResponse.ok) {
    throw new Error(`Google Sheet download failed with ${dataResponse.status}`)
  }

  const dataCsv = await dataResponse.text()
  const parsed = parseCsv(dataCsv)

  const stampAuditByTipKey = new Map()
  if (stampResponse?.ok) {
    const stampCsv = await stampResponse.text()
    const parsedStamp = parseTipStampCsv(stampCsv, parsed)
    for (const [key, value] of parsedStamp.entries()) {
      stampAuditByTipKey.set(key, value)
    }
  }

  const localAuditByKey = options.tipAuditByKey && typeof options.tipAuditByKey === 'object'
    ? new Map(
      Object.entries(options.tipAuditByKey)
        .map(([key, value]) => [key, normalizeTipAuditEntry(value)])
        .filter(([, value]) => Boolean(value)),
    )
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

  for (const [key, value] of stampAuditByTipKey.entries()) {
    auditByTipKey.set(key, value)
  }

  for (const [key, timestamp] of manualObjectAudit.manualByKey.entries()) {
    const normalized = normalizeTipAuditEntry(timestamp)
    if (normalized) auditByTipKey.set(key, normalized)
  }
  for (const [key, timestamp] of manualEntryAudit.manualByKey.entries()) {
    const normalized = normalizeTipAuditEntry(timestamp)
    if (normalized) auditByTipKey.set(key, normalized)
  }

  return {
    players: parsed.players,
    matches: parsed.matches.map((match) => ({
      ...match,
      tips: (match.tips ?? []).map((tip) => ({
        ...tip,
        updatedAt: auditByTipKey.get(`${match.id}:${tip.playerId}`)?.updatedAt ?? null,
        updatedState: auditByTipKey.get(`${match.id}:${tip.playerId}`)?.updatedState ?? null,
      })),
    })),
  }
}