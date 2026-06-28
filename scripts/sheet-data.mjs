const SHEET_ID = '1cdrtECld-UgY8qjcc2UajQwcO3F85u1EgV2EU2sc9Lw'
const GID = '134828351'

function toInt(value) {
  const clean = String(value ?? '').replace(/[^0-9-]/g, '')
  const parsed = Number.parseInt(clean, 10)
  return Number.isNaN(parsed) ? 0 : parsed
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
      id: `m${matches.length + 1}`,
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

export async function fetchSheetData() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Google Sheet download failed with ${response.status}`)
  }

  const csv = await response.text()
  return parseCsv(csv)
}