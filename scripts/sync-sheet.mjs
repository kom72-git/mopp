import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'

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

function formatCount(count, one, few, many) {
  if (count === 1) return `${count} ${one}`
  if (count >= 2 && count <= 4) return `${count} ${few}`
  return `${count} ${many}`
}

async function readExistingData(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8')
    const matched = text.match(/export const players = ([\s\S]*?)\n\nexport const matches = ([\s\S]*?)\n?$/)
    if (!matched) return null

    return {
      players: JSON.parse(matched[1]),
      matches: JSON.parse(matched[2]),
    }
  } catch {
    return null
  }
}

function calculateDiff(previousData, nextData) {
  if (!previousData) {
    return {
      tipsChanged: 0,
      matchFieldsChanged: 0,
      playersChanged: 0,
      newMatches: nextData.matches.length,
      removedMatches: 0,
      newPlayers: nextData.players.length,
      removedPlayers: 0,
    }
  }

  const prevPlayersById = new Map(previousData.players.map((player) => [player.id, player]))
  const nextPlayersById = new Map(nextData.players.map((player) => [player.id, player]))

  const prevMatchesById = new Map(previousData.matches.map((match) => [match.id, match]))
  const nextMatchesById = new Map(nextData.matches.map((match) => [match.id, match]))

  const newPlayers = nextData.players.filter((player) => !prevPlayersById.has(player.id)).length
  const removedPlayers = previousData.players.filter((player) => !nextPlayersById.has(player.id)).length

  let playersChanged = 0
  for (const player of nextData.players) {
    const prev = prevPlayersById.get(player.id)
    if (!prev) continue
    if (prev.name !== player.name || prev.points !== player.points) playersChanged += 1
  }

  const newMatches = nextData.matches.filter((match) => !prevMatchesById.has(match.id)).length
  const removedMatches = previousData.matches.filter((match) => !nextMatchesById.has(match.id)).length

  let tipsChanged = 0
  let matchFieldsChanged = 0

  for (const match of nextData.matches) {
    const prev = prevMatchesById.get(match.id)
    if (!prev) continue

    if (
      prev.round !== match.round ||
      prev.startsAt !== match.startsAt ||
      prev.home !== match.home ||
      prev.away !== match.away ||
      prev.score !== match.score ||
      prev.bank !== match.bank
    ) {
      matchFieldsChanged += 1
    }

    const prevTipsByPlayer = new Map((prev.tips ?? []).map((tip) => [tip.playerId, tip]))
    for (const tip of match.tips ?? []) {
      const prevTip = prevTipsByPlayer.get(tip.playerId)
      if (!prevTip || prevTip.pick !== tip.pick || prevTip.points !== tip.points) {
        tipsChanged += 1
      }
    }
  }

  return {
    tipsChanged,
    matchFieldsChanged,
    playersChanged,
    newMatches,
    removedMatches,
    newPlayers,
    removedPlayers,
  }
}

function buildSyncMessage(diff, nextData, hadPreviousData) {
  if (!hadPreviousData) {
    return `První synchronizace: ${nextData.players.length} hráčů a ${nextData.matches.length} zápasů.`
  }

  const parts = []

  if (diff.tipsChanged > 0) {
    parts.push(`upraveno ${formatCount(diff.tipsChanged, 'tip', 'tipy', 'tipů')}`)
  }

  if (diff.matchFieldsChanged > 0) {
    parts.push(`upraveno ${formatCount(diff.matchFieldsChanged, 'zápas', 'zápasy', 'zápasů')}`)
  }

  if (diff.playersChanged > 0) {
    parts.push(`upraveno ${formatCount(diff.playersChanged, 'hráč', 'hráči', 'hráčů')}`)
  }

  if (diff.newMatches > 0) {
    parts.push(`přidáno ${formatCount(diff.newMatches, 'zápas', 'zápasy', 'zápasů')}`)
  }

  if (diff.removedMatches > 0) {
    parts.push(`odebráno ${formatCount(diff.removedMatches, 'zápas', 'zápasy', 'zápasů')}`)
  }

  if (diff.newPlayers > 0) {
    parts.push(`přidán ${formatCount(diff.newPlayers, 'hráč', 'hráči', 'hráčů')}`)
  }

  if (diff.removedPlayers > 0) {
    parts.push(`odebrán ${formatCount(diff.removedPlayers, 'hráč', 'hráči', 'hráčů')}`)
  }

  if (parts.length === 0) {
    return 'Žádné tipy k synchronizaci. Data jsou aktuální.'
  }

  return `Synchronizace dokončena: ${parts.join(', ')}.`
}

async function main() {
  const outputFile = 'src/data/moppData.js'
  const statusFile = 'public/sync-status.json'
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Google Sheet download failed with ${response.status}`)
  }

  const csv = await response.text()
  const data = parseCsv(csv)
  const previousData = await readExistingData(outputFile)
  const diff = calculateDiff(previousData, data)
  const message = buildSyncMessage(diff, data, Boolean(previousData))

  const output = `export const players = ${JSON.stringify(data.players, null, 2)}\n\nexport const matches = ${JSON.stringify(data.matches, null, 2)}\n`
  const signature = createHash('sha1').update(output).digest('hex')
  const status = {
    updatedAt: new Date().toISOString(),
    signature,
    players: data.players.length,
    matches: data.matches.length,
    message,
  }

  await fs.mkdir('src/data', { recursive: true })
  await fs.mkdir('public', { recursive: true })
  await fs.writeFile(outputFile, output, 'utf8')
  await fs.writeFile(statusFile, `${JSON.stringify(status, null, 2)}\n`, 'utf8')

  return {
    ok: true,
    players: data.players.length,
    matches: data.matches.length,
    file: outputFile,
    statusFile,
    signature,
    changes: diff,
    message,
  }
}

main()
  .then((result) => {
    const asJson = process.argv.includes('--json')
    if (asJson) {
      console.log(JSON.stringify(result))
      return
    }
    console.log(`${result.message} Zapsáno do ${result.file}`)
  })
  .catch((error) => {
    const asJson = process.argv.includes('--json')
    if (asJson) {
      console.log(JSON.stringify({ ok: false, message: error.message }))
      process.exit(1)
      return
    }
    console.error(error.message)
    process.exit(1)
  })
