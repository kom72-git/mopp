import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fetchSheetData } from './sheet-data.mjs'
import { defaultTournamentId } from '../src/data/tournaments.js'

function formatCount(count, one, few, many) {
  if (count === 1) return `${count} ${one}`
  if (count >= 2 && count <= 4) return `${count} ${few}`
  return `${count} ${many}`
}

function formatPragueTimestamp(date) {
  const formatter = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  return `${formatter.format(date)} (Europe/Prague)`
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

async function readExistingTipAudit(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8')
    const payload = JSON.parse(text)
    return payload && typeof payload === 'object' ? payload : {}
  } catch {
    return {}
  }
}

function isTipChanged(previousTip, nextTip) {
  if (!previousTip) return String(nextTip?.pick ?? '').trim() !== '-'
  return previousTip.pick !== nextTip.pick || previousTip.points !== nextTip.points
}

function buildTipAuditByKey(previousData, nextData, previousAuditByKey, nowIso) {
  const nextKeys = new Set()
  const merged = new Map()

  for (const [key, value] of Object.entries(previousAuditByKey ?? {})) {
    if (value) merged.set(key, value)
  }

  const prevMatchesById = new Map((previousData?.matches ?? []).map((match) => [match.id, match]))
  let updatedCount = 0

  for (const nextMatch of nextData.matches ?? []) {
    const prevMatch = prevMatchesById.get(nextMatch.id)
    const prevTipsByPlayer = new Map((prevMatch?.tips ?? []).map((tip) => [tip.playerId, tip]))

    for (const nextTip of nextMatch.tips ?? []) {
      const key = `${nextMatch.id}:${nextTip.playerId}`
      nextKeys.add(key)

      const prevTip = prevTipsByPlayer.get(nextTip.playerId)
      if (isTipChanged(prevTip, nextTip)) {
        merged.set(key, nowIso)
        updatedCount += 1
      }
    }
  }

  const filtered = {}
  for (const [key, value] of merged.entries()) {
    if (nextKeys.has(key)) filtered[key] = value
  }

  return { tipAuditByKey: filtered, updatedCount }
}

function injectTipAudit(nextData, tipAuditByKey) {
  return {
    players: nextData.players,
    matches: (nextData.matches ?? []).map((match) => ({
      ...match,
      tips: (match.tips ?? []).map((tip) => ({
        ...tip,
        updatedAt: tipAuditByKey?.[`${match.id}:${tip.playerId}`] ?? null,
      })),
    })),
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
  const tipAuditFile = 'public/tip-audit.json'
  const tournamentId = defaultTournamentId
  const data = await fetchSheetData({ tournamentId })
  const previousData = await readExistingData(outputFile)
  const previousTipAudit = await readExistingTipAudit(tipAuditFile)
  const previousTipAuditByKey = previousTipAudit?.byTournament?.[tournamentId]?.tips ?? {}
  const now = new Date()
  const nowIso = now.toISOString()
  const { tipAuditByKey, updatedCount } = buildTipAuditByKey(
    previousData,
    data,
    previousTipAuditByKey,
    nowIso,
  )
  const dataWithAudit = injectTipAudit(data, tipAuditByKey)
  const diff = calculateDiff(previousData, data)
  const message = buildSyncMessage(diff, data, Boolean(previousData))

  const output = `export const players = ${JSON.stringify(dataWithAudit.players, null, 2)}\n\nexport const matches = ${JSON.stringify(dataWithAudit.matches, null, 2)}\n`
  const signature = createHash('sha1').update(output).digest('hex')
  const status = {
    updatedAt: formatPragueTimestamp(now),
    updatedAtUtc: nowIso,
    signature,
    players: dataWithAudit.players.length,
    matches: dataWithAudit.matches.length,
    message,
  }

  const tipAuditPayload = {
    updatedAtUtc: nowIso,
    byTournament: {
      ...(previousTipAudit?.byTournament ?? {}),
      [tournamentId]: {
        tips: tipAuditByKey,
      },
    },
  }

  await fs.mkdir('src/data', { recursive: true })
  await fs.mkdir('public', { recursive: true })
  await fs.writeFile(outputFile, output, 'utf8')
  await fs.writeFile(statusFile, `${JSON.stringify(status, null, 2)}\n`, 'utf8')
  await fs.writeFile(tipAuditFile, `${JSON.stringify(tipAuditPayload, null, 2)}\n`, 'utf8')

  return {
    ok: true,
    tournamentId,
    players: dataWithAudit.players.length,
    matches: dataWithAudit.matches.length,
    file: outputFile,
    statusFile,
    tipAuditFile,
    tipAuditUpdated: updatedCount,
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
