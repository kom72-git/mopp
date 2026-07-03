import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { matches as fallbackMatches, players as fallbackPlayers } from './data/moppData'
import { defaultTournamentId, getTournamentById, tournaments } from './data/tournaments'
import { getFlagUrl } from './data/countryFlags'
import { getTeamLogoUrl } from './data/teamLogos'

// Volitelny rucni bonus navic mimo vyhry ze zapasu.
// Tady pridej extra castky, ktere chces pricist k automatickemu souctu vyher.
const bonusWinningsByPlayerId = {
  p1: 0, // Kom
  p2: 0, // Kraty
  p3: 0, // Radek
  p4: 0, // Roman
  p5: 0, // Spaca
  p6: 0, // Slanec
  p7: 0, // Lada
  p8: 0, // Prd
  p9: 0, // Jony
  p10: 0, // Mirax
  p11: 0, // Honza
}

// Volitelne rucni korekce vyplat pro konkretni zapasy.
// Format: { matchId: { playerId: castka } }
const manualPayoutOverridesByMatchId = {
}

const chartColors = ['#2563eb', '#0ea5e9', '#06b6d4', '#14b8a6', '#22c55e', '#84cc16', '#eab308', '#f59e0b', '#f97316', '#a855f7', '#ec4899']

const emptyData = { players: [], matches: [] }

function getStoredTournamentId() {
  if (typeof window === 'undefined') return defaultTournamentId

  try {
    const storedTournamentId = window.localStorage.getItem('mopp-selected-tournament')
    return getTournamentById(storedTournamentId)?.id ?? defaultTournamentId
  } catch {
    return defaultTournamentId
  }
}

function formatCount(count, one, few, many) {
  if (count === 1) return `${count} ${one}`
  if (count >= 2 && count <= 4) return `${count} ${few}`
  return `${count} ${many}`
}

function buildLiveSyncMessage(previousData, nextData) {
  const prevMatches = previousData?.matches ?? []
  const nextMatches = nextData?.matches ?? []
  const prevMatchesById = new Map(prevMatches.map((match) => [match.id, match]))

  let tipsChanged = 0

  for (const match of nextMatches) {
    const prevMatch = prevMatchesById.get(match.id)
    if (!prevMatch) {
      tipsChanged += (match.tips ?? []).length
      continue
    }

    const prevTipsByPlayer = new Map((prevMatch.tips ?? []).map((tip) => [tip.playerId, tip]))
    for (const tip of match.tips ?? []) {
      const prevTip = prevTipsByPlayer.get(tip.playerId)
      if (!prevTip || prevTip.pick !== tip.pick || prevTip.points !== tip.points) {
        tipsChanged += 1
      }
    }
  }

  if (tipsChanged === 0) {
    return 'Žádné tipy k synchronizaci. Data jsou aktuální.'
  }

  return `Synchronizace dokončena: upraveno ${formatCount(tipsChanged, 'tip', 'tipy', 'tipů')}.`
}

function pointsClass(points) {
  if (points === 10) return 'tip-pill is-exact'
  if (points === 5) return 'tip-pill is-near'
  if (points === 3) return 'tip-pill is-win'
  if (points === 0) return 'tip-pill is-miss'
  return 'tip-pill is-pending'
}

function extractRound(match) {
  if (Number.isFinite(match?.round)) return match.round
  const matched = match?.startsAt?.match(/^(\d+)\./)
  return matched ? Number(matched[1]) : null
}

function formatRound(round, roundLabel = 'den') {
  return `${round}. ${roundLabel}`
}

function isTournamentActiveByDate(tournament) {
  const startDate = tournament?.startDate
  if (!startDate) return false

  const now = new Date()
  const start = new Date(`${startDate}T00:00:00`)
  if (Number.isNaN(start.getTime())) return false
  return now >= start
}

function extractCalendarDate(startsAt) {
  const matched = startsAt?.match(/^\d+\.\s*\([^)]+\)\s*(\d{1,2}\.\d{1,2}\.)/)
  if (matched) return matched[1]

  const fallback = startsAt?.match(/(\d{1,2}\.\d{1,2}\.)/g)
  return fallback?.[fallback.length - 1] ?? null
}

function parseMatchDate(startsAt) {
  const matched = startsAt?.match(/(\d{1,2})\.(\d{1,2})\.\s*(\d{1,2}):(\d{2})/)
  if (!matched) return null

  const day = Number(matched[1])
  const month = Number(matched[2]) - 1
  const hour = Number(matched[3])
  const minute = Number(matched[4])
  return new Date(2026, month, day, hour, minute)
}

function parseStartsAtDisplay(startsAt, matchId) {
  const matched = startsAt?.match(/^(\d+\.)\s*\(([^)]+)\)\s*(.+)$/)
  if (!matched) {
    return {
      roundLabel: startsAt ?? '',
      matchNo: '',
      dayName: '',
      rest: '',
    }
  }

  const [, roundLabel, dayRaw, restRaw] = matched
  const dayToken = dayRaw.trim().toLowerCase()
  const dayNames = {
    po: 'pondělí',
    pondeli: 'pondělí',
    'pondělí': 'pondělí',
    ut: 'úterý',
    'út': 'úterý',
    utery: 'úterý',
    'úterý': 'úterý',
    st: 'středa',
    streda: 'středa',
    'středa': 'středa',
    ct: 'čtvrtek',
    'čt': 'čtvrtek',
    ctvrtek: 'čtvrtek',
    'čtvrtek': 'čtvrtek',
    pa: 'pátek',
    'pá': 'pátek',
    patek: 'pátek',
    'pátek': 'pátek',
    so: 'sobota',
    sobota: 'sobota',
    ne: 'neděle',
    nedele: 'neděle',
    'neděle': 'neděle',
  }

  const dayName = dayNames[dayToken] ?? dayRaw
  const rest = restRaw.trimStart()
  const matchNo = String(matchId ?? '').replace(/^m/i, '')
  return {
    roundLabel,
    matchNo,
    dayName,
    rest,
  }
}

function StartsAtLabel({ startsAt, matchId }) {
  const parts = parseStartsAtDisplay(startsAt, matchId)
  if (!parts.dayName) return <>{parts.roundLabel}</>

  return (
    <span className="starts-at-label">
      <span>{parts.roundLabel}</span>
      {parts.matchNo ? <span className="starts-at-match-no">({parts.matchNo})</span> : null}
      <span>{parts.dayName}</span>
      <span className="starts-at-date">{parts.rest}</span>
    </span>
  )
}

function getStageLabel(match, stageRules = [], stageTransitions = []) {
  const round = extractRound(match)
  const startsAt = match?.startsAt
  const date = parseMatchDate(startsAt)

  if (date && Array.isArray(stageTransitions) && stageTransitions.length > 0) {
    const transitions = stageTransitions
      .map((item) => ({
        label: item?.label,
        fromDate: item?.from ? new Date(item.from) : null,
      }))
      .filter((item) => item.label && item.fromDate && !Number.isNaN(item.fromDate.getTime()))
      .sort((a, b) => a.fromDate.getTime() - b.fromDate.getTime())

    if (transitions.length > 0) {
      let activeLabel = transitions[0].label
      for (const transition of transitions) {
        if (date >= transition.fromDate) {
          activeLabel = transition.label
        } else {
          break
        }
      }
      return activeLabel
    }
  }

  if (Number.isFinite(round) && Array.isArray(stageRules) && stageRules.length > 0) {
    const matchedRule = stageRules.find((rule) => Number.isFinite(rule?.maxRound) && round <= rule.maxRound)
    if (matchedRule?.label) return matchedRule.label
  }

  if (!date) return 'Skupinová fáze'

  const groupEnd = new Date(2026, 5, 28, 4, 0)
  const round16End = new Date(2026, 6, 4, 3, 30)
  const round8End = new Date(2026, 6, 7, 22, 0)
  const quarterEnd = new Date(2026, 6, 12, 3, 0)

  if (date <= groupEnd) return 'Skupinová fáze'
  if (date <= round16End) return 'Šestnáctifinále'
  if (date <= round8End) return 'Osmifinále'
  if (date <= quarterEnd) return 'Čtvrtfinále'
  if (date.getMonth() === 6 && (date.getDate() === 14 || date.getDate() === 15)) return 'Semifinále'
  if (date.getMonth() === 6 && date.getDate() === 18) return 'O 3. místo'
  if (date.getMonth() === 6 && date.getDate() === 19) return 'Finále'

  return 'Skupinová fáze'
}

function parseScore(score) {
  if (!score || score === '--:--') return { home: null, away: null, isDraw: false, winner: null }

  const [homeRaw, awayRaw] = String(score).split(':')
  const home = Number(homeRaw)
  const away = Number(awayRaw)
  if (!Number.isFinite(home) || !Number.isFinite(away)) {
    return { home: null, away: null, isDraw: false, winner: null }
  }

  const isDraw = home === away
  const winner = isDraw ? null : home > away ? 'home' : 'away'

  return { home, away, isDraw, winner }
}

function parseTipValue(value) {
  if (!value || value === '-') return { home: '-', away: '-' }

  const [homeRaw = '', awayRaw = ''] = String(value).split(':')
  const normalize = (token) => {
    const trimmed = token.trim()
    if (!trimmed) return '-'
    if (/^n$/i.test(trimmed)) return 'N'
    if (/^-?\d+$/.test(trimmed)) return trimmed
    return '-'
  }

  return {
    home: normalize(homeRaw),
    away: normalize(awayRaw),
  }
}

function isNoBetPick(pick) {
  return /^\s*n\s*:\s*n\s*$/i.test(String(pick ?? ''))
}

function formatTipUpdatedAt(updatedAt) {
  if (!updatedAt) return ''

  const shortMatch = String(updatedAt).trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2})$/)
  if (shortMatch) {
    const [, , month, day, time] = shortMatch
    return `${day}. ${month}. ${time}`
  }

  const date = new Date(updatedAt)
  if (Number.isNaN(date.getTime())) {
    return String(updatedAt).trim()
  }

  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${day}.${month}. ${hour}:${minute}`
}

function formatTipNote(updatedAt, updatedState) {
  if (!updatedAt) return ''
  const actionLabel = updatedState === 'updated' ? 'upraveno' : 'vloženo'
  return `${actionLabel}: ${formatTipUpdatedAt(updatedAt)}`
}

function toTipTimestampMs(value) {
  const text = String(value ?? '').trim()
  if (!text) return Number.NaN

  const shortMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/)
  if (shortMatch) {
    const [, year, month, day, hour, minute] = shortMatch
    const parsed = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
    ).getTime()
    return Number.isFinite(parsed) ? parsed : Number.NaN
  }

  const parsed = Number(new Date(text))
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function calculateMatchPayouts(match, playerOrder, overridesByMatchId, remainderRecipientsByMatchId) {
  const override = overridesByMatchId?.[match?.id]
  if (override && typeof override === 'object') {
    return new Map(Object.entries(override).map(([playerId, value]) => [playerId, Number(value) || 0]))
  }

  const tips = match?.tips ?? []
  const bank = Number(match?.bank)
  if (!Number.isFinite(bank) || bank <= 0) return new Map()

  const winners = tips.filter((tip) => tip.points === 10)
  if (winners.length === 0) return new Map()

  winners.sort((a, b) => (playerOrder.get(a.playerId) ?? 999) - (playerOrder.get(b.playerId) ?? 999))

  const base = Math.floor(bank / winners.length)
  const remainder = bank - base * winners.length
  const payouts = new Map(winners.map((winner) => [winner.playerId, base]))

  if (remainder > 0) {
    const preferredWinnerId = remainderRecipientsByMatchId?.[match?.id]
    const manualRecipientId = preferredWinnerId && payouts.has(preferredWinnerId) ? preferredWinnerId : ''

    const winnersWithTimestamp = winners
      .map((winner) => ({
        playerId: winner.playerId,
        timestampMs: toTipTimestampMs(winner.updatedAt),
      }))
      .filter((item) => Number.isFinite(item.timestampMs))
      .sort((a, b) => {
        if (a.timestampMs !== b.timestampMs) return a.timestampMs - b.timestampMs
        return (playerOrder.get(a.playerId) ?? 999) - (playerOrder.get(b.playerId) ?? 999)
      })

    const autoRecipientId = winnersWithTimestamp[0]?.playerId ?? ''
    const fallbackWinnerId = winners[0]?.playerId
    const recipientId = autoRecipientId || manualRecipientId || fallbackWinnerId

    if (recipientId) {
      payouts.set(recipientId, (payouts.get(recipientId) ?? 0) + remainder)
    }
  }

  return payouts
}

async function fetchLiveData(tournamentId) {
  const query = tournamentId ? `?tournament=${encodeURIComponent(tournamentId)}&` : '?'
  const response = await fetch(`/api/data${query}t=${Date.now()}`, { cache: 'no-store' })
  const payload = await response.json()

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message || 'Živá data nejsou dostupná')
  }

  return {
    players: payload.players ?? [],
    matches: payload.matches ?? [],
  }
}

function SplitTip({ value }) {
  const { home, away } = parseTipValue(value)

  return (
    <span className="split-tip" aria-label={`Tip ${value}`}>
      <strong className={home === '-' ? 'is-placeholder' : ''}>{home}</strong>
      <strong className={away === '-' ? 'is-placeholder' : ''}>{away}</strong>
    </span>
  )
}

function getMatchTeamLogoUrl(tournamentId, teamName) {
  return getTeamLogoUrl(tournamentId, teamName) ?? getFlagUrl(teamName)
}

function getTeamLogoClassName(tournamentId) {
  return tournamentId === 'PO-2025' ? 'is-round-logo' : 'is-rect-logo'
}

function App() {
  const tooltipTimerRef = useRef(null)
  const touchLegendHandledRef = useRef(false)
  const initialTournamentId = getStoredTournamentId()
  const [selectedTournamentId, setSelectedTournamentId] = useState(initialTournamentId)
  const [data, setData] = useState(
    initialTournamentId === defaultTournamentId
      ? { players: fallbackPlayers, matches: fallbackMatches }
      : emptyData,
  )
  const [isLiveLoading, setIsLiveLoading] = useState(true)
  useEffect(() => {
    try {
      window.localStorage.setItem('mopp-selected-tournament', selectedTournamentId)
    } catch {
      // localStorage muze byt blokovane.
    }
  }, [selectedTournamentId])
  const selectedTournament = useMemo(
    () => getTournamentById(selectedTournamentId) ?? tournaments[0] ?? null,
    [selectedTournamentId],
  )
  const roundLabel = selectedTournament?.roundLabel ?? 'den'
  const longTermBank = selectedTournament?.longTermBank ?? null
  const remainderRecipientByMatchId = useMemo(
    () => selectedTournament?.remainderRecipientByMatchId ?? {},
    [selectedTournament],
  )

  useEffect(() => {
    const faviconHref = selectedTournament?.favicon
    if (!faviconHref || typeof document === 'undefined') return

    const cacheBustedHref = `${faviconHref}?t=${encodeURIComponent(selectedTournament?.id ?? '')}`
    const rels = ['icon', 'shortcut icon']

    for (const rel of rels) {
      const link = document.querySelector(`link[rel='${rel}']`) || document.createElement('link')
      link.setAttribute('rel', rel)
      link.setAttribute('href', cacheBustedHref)
      if (!link.parentNode) {
        document.head.appendChild(link)
      }
    }
  }, [selectedTournament?.favicon, selectedTournament?.id])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const suffix = selectedTournament?.tabTitle ?? selectedTournament?.title ?? selectedTournament?.label ?? 'MOPP'
    document.title = `Master of PP | ${suffix}`
  }, [selectedTournament])

  const players = data.players
  const matches = data.matches
  const hasUnfinishedMatches = useMemo(
    () =>
      matches.some(
        (match) =>
          !match.score ||
          match.score === '--:--' ||
          (match.tips ?? []).some((tip) => tip.points === null),
      ),
    [matches],
  )
  const highlightCurrentRound = isTournamentActiveByDate(selectedTournament) && hasUnfinishedMatches
  const scoreboard = useMemo(() => [...players].sort((a, b) => b.points - a.points), [players])
  const totalPayoutsByPlayer = useMemo(() => {
    const playerOrder = new Map(players.map((player, index) => [player.id, index]))
    const totals = new Map(players.map((player) => [player.id, 0]))

    for (const match of matches) {
      const payouts = calculateMatchPayouts(
        match,
        playerOrder,
        manualPayoutOverridesByMatchId,
        remainderRecipientByMatchId,
      )

      for (const [playerId, payout] of payouts.entries()) {
        totals.set(playerId, (totals.get(playerId) ?? 0) + (Number(payout) || 0))
      }
    }

    return totals
  }, [matches, players, remainderRecipientByMatchId])

  const standings = useMemo(
    () =>
      scoreboard.map((player) => {
        const stats = {
          exact: 0,
          near: 0,
          win: 0,
          noBet: 0,
        }

        for (const match of matches) {
          const tip = match.tips.find((item) => item.playerId === player.id)
          if (!tip) continue

          if (tip.points === 10) stats.exact += 1
          if (tip.points === 5) stats.near += 1
          if (tip.points === 3) stats.win += 1
          if (isNoBetPick(tip.pick)) stats.noBet += 1
        }

        return {
          ...player,
          winnings: (totalPayoutsByPlayer.get(player.id) ?? 0) + (bonusWinningsByPlayerId[player.id] ?? 0),
          stats,
        }
      }),
    [matches, scoreboard, totalPayoutsByPlayer],
  )

  const rounds = useMemo(() => {
    const all = matches.map((match) => extractRound(match)).filter((value) => value !== null)
    return [...new Set(all)].sort((a, b) => a - b)
  }, [matches])

  const rankTimeline = useMemo(() => {
    if (rounds.length === 0) return { rounds: [], series: [] }

    const inProgress = matches
      .filter((match) => !match.score || match.tips.some((tip) => tip.points === null))
      .map((match) => extractRound(match))
      .filter((value) => value !== null)

    const derivedCurrentRound = inProgress.length > 0 ? Math.min(...inProgress) : rounds[rounds.length - 1] ?? 1

    const playedRounds = matches
      .filter((match) => match.score && match.score !== '--:--')
      .map((match) => extractRound(match))
      .filter((value) => value !== null)

    const lastPlayedRound = playedRounds.length > 0 ? Math.max(...playedRounds) : derivedCurrentRound
    const chartEndRound = Math.max(derivedCurrentRound, lastPlayedRound)
    const chartRounds = rounds.filter((round) => round <= chartEndRound)
    if (chartRounds.length === 0) return { rounds: [], series: [] }

    const playerOrder = scoreboard.map((player) => player.id)
    const playerMeta = new Map(scoreboard.map((player) => [player.id, player]))
    const tieBreak = new Map(playerOrder.map((id, index) => [id, index]))
    const totals = new Map(playerOrder.map((id) => [id, 0]))
    const matchesByRound = new Map(chartRounds.map((round) => [round, []]))

    for (const match of matches) {
      const round = extractRound(match)
      if (!Number.isFinite(round) || !matchesByRound.has(round)) continue
      matchesByRound.get(round).push(match)
    }

    const rankByPlayer = new Map(playerOrder.map((id) => [id, []]))

    for (const round of chartRounds) {
      const roundMatches = matchesByRound.get(round) ?? []

      for (const match of roundMatches) {
        for (const tip of match.tips ?? []) {
          if (!totals.has(tip.playerId)) continue
          const gained = Number.isFinite(tip.points) ? tip.points : 0
          totals.set(tip.playerId, totals.get(tip.playerId) + gained)
        }
      }

      const sorted = [...playerOrder].sort((a, b) => {
        const diff = (totals.get(b) ?? 0) - (totals.get(a) ?? 0)
        if (diff !== 0) return diff
        return (tieBreak.get(a) ?? 0) - (tieBreak.get(b) ?? 0)
      })

      sorted.forEach((playerId, index) => {
        rankByPlayer.get(playerId).push(index + 1)
      })
    }

    const series = playerOrder.map((playerId, index) => ({
      id: playerId,
      name: playerMeta.get(playerId)?.name ?? playerId,
      color: chartColors[index % chartColors.length],
      ranks: rankByPlayer.get(playerId) ?? [],
    }))

    return { rounds: chartRounds, series }
  }, [matches, rounds, scoreboard])

  const currentRound = useMemo(() => {
    const inProgress = matches
      .filter((match) => !match.score || match.tips.some((tip) => tip.points === null))
      .map((match) => extractRound(match))
      .filter((value) => value !== null)

    if (inProgress.length > 0) return Math.min(...inProgress)
    return rounds[rounds.length - 1] ?? 1
  }, [matches, rounds])

  const [viewStateByTournament, setViewStateByTournament] = useState({})
  const currentViewState = viewStateByTournament[selectedTournamentId] ?? {}
  const selectedRound = currentViewState.selectedRound ?? currentRound
  const visiblePlayerIds = currentViewState.visiblePlayerIds ?? scoreboard.map((player) => player.id)
  const hoveredPlayerId = currentViewState.hoveredPlayerId ?? ''
  const selectedMatchId = currentViewState.selectedMatchId ?? ''
  const showLongTermBankInfo = currentViewState.showLongTermBankInfo ?? false

  const updateCurrentTournamentState = (patch) => {
    setViewStateByTournament((prev) => {
      const existing = prev[selectedTournamentId] ?? {}
      const nextPatch = typeof patch === 'function' ? patch(existing) : patch
      return {
        ...prev,
        [selectedTournamentId]: {
          ...existing,
          ...nextPatch,
        },
      }
    })
  }

  const setSelectedRound = (value) => {
    updateCurrentTournamentState((current) => ({
      selectedRound: typeof value === 'function' ? value(current.selectedRound ?? currentRound) : value,
    }))
  }

  const setVisiblePlayerIds = (value) => {
    updateCurrentTournamentState((current) => ({
      visiblePlayerIds:
        typeof value === 'function'
          ? value(current.visiblePlayerIds ?? scoreboard.map((player) => player.id))
          : value,
    }))
  }

  const setHoveredPlayerId = (value) => {
    updateCurrentTournamentState((current) => ({
      hoveredPlayerId: typeof value === 'function' ? value(current.hoveredPlayerId ?? '') : value,
    }))
  }

  const setSelectedMatchId = (value) => {
    updateCurrentTournamentState((current) => ({
      selectedMatchId:
        typeof value === 'function' ? value(current.selectedMatchId ?? '') : value,
    }))
  }

  const setShowLongTermBankInfo = (value) => {
    updateCurrentTournamentState((current) => ({
      showLongTermBankInfo:
        typeof value === 'function' ? value(current.showLongTermBankInfo ?? false) : value,
    }))
  }

  const normalizedVisiblePlayerIds = useMemo(() => {
    const ids = scoreboard.map((player) => player.id)
    return visiblePlayerIds.filter((id) => ids.includes(id))
  }, [scoreboard, visiblePlayerIds])

  const togglePlayerVisibility = (playerId) => {
    setVisiblePlayerIds((prev) =>
      prev.includes(playerId) ? prev.filter((id) => id !== playerId) : [...prev, playerId],
    )
  }

  const roundMatches = useMemo(
    () => matches.filter((match) => extractRound(match) === selectedRound),
    [matches, selectedRound],
  )

  const roundDateLabel = useMemo(() => {
    const dates = [...new Set(roundMatches.map((match) => extractCalendarDate(match.startsAt)).filter(Boolean))]
    if (dates.length === 0) return ''
    if (dates.length === 1) return dates[0]
    return `${dates[0]}–${dates[dates.length - 1]}`
  }, [roundMatches])

  const effectiveSelectedMatchId = useMemo(() => {
    if (roundMatches.length === 0) return ''
    const exists = roundMatches.some((match) => match.id === selectedMatchId)
    return exists ? selectedMatchId : roundMatches[0].id
  }, [roundMatches, selectedMatchId])

  const selectedMatch = useMemo(
    () => roundMatches.find((match) => match.id === effectiveSelectedMatchId) ?? roundMatches[0],
    [roundMatches, effectiveSelectedMatchId],
  )

  const selectedMatchStageLabel = useMemo(
    () =>
      getStageLabel(
        selectedMatch,
        selectedTournament?.stageRules ?? [],
        selectedTournament?.stageTransitions ?? [],
      ),
    [selectedMatch, selectedTournament],
  )

  const rankByPlayerForSelectedRound = useMemo(() => {
    const fallback = new Map(scoreboard.map((player, index) => [player.id, index + 1]))
    const roundIndex = rankTimeline.rounds.indexOf(selectedRound)
    if (roundIndex < 0) return fallback

    const byRound = new Map()
    for (const series of rankTimeline.series) {
      const rank = series.ranks[roundIndex]
      if (Number.isFinite(rank)) {
        byRound.set(series.id, rank)
      }
    }

    return byRound.size > 0 ? byRound : fallback
  }, [rankTimeline, scoreboard, selectedRound])

  const rankByPlayerForPreviousRound = useMemo(() => {
    const roundIndex = rankTimeline.rounds.indexOf(selectedRound)
    if (roundIndex <= 0) return new Map()

    const byRound = new Map()
    for (const series of rankTimeline.series) {
      const rank = series.ranks[roundIndex - 1]
      if (Number.isFinite(rank)) {
        byRound.set(series.id, rank)
      }
    }

    return byRound
  }, [rankTimeline, selectedRound])

  const selectedMatchTips = useMemo(() => {
    if (!selectedMatch) return []

    const playerOrder = new Map(players.map((player, index) => [player.id, index]))
    const payoutsByPlayer = calculateMatchPayouts(
      selectedMatch,
      playerOrder,
      manualPayoutOverridesByMatchId,
      remainderRecipientByMatchId,
    )

    return selectedMatch.tips
      .map((tip) => {
        const player = players.find((item) => item.id === tip.playerId)
        const rank =
          rankByPlayerForSelectedRound.get(tip.playerId) ??
          scoreboard.findIndex((item) => item.id === tip.playerId) + 1
        const previousRank = rankByPlayerForPreviousRound.get(tip.playerId)
        const rankDelta = Number.isFinite(previousRank) ? previousRank - rank : 0
        const payout = payoutsByPlayer.get(tip.playerId) ?? 0
        return {
          ...tip,
          playerName: player?.name ?? tip.playerId,
          tipNote: formatTipNote(tip.updatedAt, tip.updatedState),
          rank,
          rankDelta,
          payout,
        }
      })
      .sort((a, b) => a.rank - b.rank)
  }, [players, rankByPlayerForPreviousRound, rankByPlayerForSelectedRound, scoreboard, selectedMatch, remainderRecipientByMatchId])

  const [syncMessage, setSyncMessage] = useState('')
  const [showSyncTooltip, setShowSyncTooltip] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)

  useEffect(() => {
    let cancelled = false

    const loadLiveData = async () => {
      try {
        const nextData = await fetchLiveData(selectedTournamentId)
        if (!cancelled) {
          setData(nextData)
        }
      } catch {
        if (!cancelled) {
          setData(selectedTournamentId === defaultTournamentId ? { players: fallbackPlayers, matches: fallbackMatches } : emptyData)
        }
      } finally {
        if (!cancelled) {
          setIsLiveLoading(false)
        }
      }
    }

    loadLiveData()

    return () => {
      cancelled = true
    }
  }, [selectedTournamentId])

  useEffect(() => {
    return () => {
      if (tooltipTimerRef.current) {
        clearTimeout(tooltipTimerRef.current)
      }
    }
  }, [])

  const showTooltip = (message, duration = 5200) => {
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current)
    }
    const text = String(message ?? '')
    const adaptiveDuration = Math.min(12000, Math.max(duration, 2600 + text.length * 30))
    setSyncMessage(message)
    setShowSyncTooltip(true)
    tooltipTimerRef.current = setTimeout(() => {
      setShowSyncTooltip(false)
      tooltipTimerRef.current = null
    }, adaptiveDuration)
  }

  const handleLogoClick = async (event) => {
    if (event.detail < 3 || isSyncing) return

    setIsSyncing(true)
    showTooltip('Synchronizace s Google tabulkou...', 15000)

    try {
      if (import.meta.env.PROD) {
        const previousData = data
        const nextData = await fetchLiveData(defaultTournamentId)
        if (selectedTournamentId === defaultTournamentId) {
          setData(nextData)
        }
        showTooltip(buildLiveSyncMessage(previousData, nextData))
        return
      }

      let response
      let payload

      try {
        response = await fetch('/api/sync-sheet', { method: 'POST' })
        payload = await response.json()
      } catch {
        try {
          response = await fetch('http://localhost:4000/api/sync-sheet', { method: 'POST' })
          payload = await response.json()
        } catch {
          throw new Error('API není dostupné')
        }
      }

      if (!response.ok || !payload?.ok) {
        showTooltip(payload?.message || 'Synchronizace selhala')
      } else {
        const nextData = await fetchLiveData(defaultTournamentId).catch(() => null)
        if (nextData && selectedTournamentId === defaultTournamentId) {
          setData(nextData)
        }
        showTooltip(payload.message || 'Synchronizace dokončena')
      }
    } catch {
      showTooltip(
        'API není dostupné. Lokálně musí běžet backend na portu 4000. Ve workspace už to má startovat samo; když ne, zkus obnovit okno VS Code.',
        9000,
      )
    } finally {
      setIsSyncing(false)
    }
  }

  return (
    <main className="layout">
      <header className="hero">
        <div className="hero-content">
          <h1>{selectedTournament?.title ?? selectedTournament?.label ?? 'MOPP turnaj'}</h1>
          <p className="intro">
            <span>tipovací soutěž</span>
            <span className="intro-sep" aria-hidden="true">
              –
            </span>
            <span>Master of PP</span>
          </p>
          <div className="hero-controls">
            <span className="tournament-picker-label">Archiv</span>
            <span className="tournament-select-shell">
              <select
                className="tournament-select"
                aria-label="Výběr turnaje"
                title={selectedTournament?.title ?? selectedTournament?.label ?? 'Turnaj'}
                value={selectedTournamentId}
                onChange={(event) => {
                  const nextTournamentId = event.target.value
                  setIsLiveLoading(true)
                  setData(
                    nextTournamentId === defaultTournamentId
                      ? { players: fallbackPlayers, matches: fallbackMatches }
                      : emptyData,
                  )
                  setSelectedTournamentId(nextTournamentId)
                }}
              >
                {tournaments.map((tournament) => (
                  <option key={tournament.id} value={tournament.id}>
                    {tournament.tabTitle ?? tournament.label}
                  </option>
                ))}
              </select>
            </span>
            {isLiveLoading ? <span className="tournament-loading">Načítám data…</span> : null}
          </div>
        </div>

        <figure className="hero-logo-wrap">
          <button type="button" className="hero-logo-button" onClick={handleLogoClick}>
            <img
              className="hero-logo"
              src={selectedTournament?.heroLogo ?? '/tournaments/2026-logo.svg'}
              alt={`Logo turnaje ${selectedTournament?.title ?? selectedTournament?.label ?? ''}`}
              loading="lazy"
            />
          </button>
          {showSyncTooltip ? (
            <span className={`sync-tooltip ${isSyncing ? 'is-info' : ''}`}>{syncMessage}</span>
          ) : null}
        </figure>
      </header>

      <section className="panel controls-panel">
        <div className="panel-head">
          <h2>{formatRound(selectedRound, roundLabel)}</h2>
        </div>

        <div className="round-tabs" role="tablist" aria-label={`Výběr ${roundLabel}`}>
          {rounds.map((round) => {
            const timeClass =
              highlightCurrentRound
                ? round < currentRound
                  ? 'is-past'
                  : round > currentRound
                    ? 'is-future'
                    : 'is-current'
                : ''
            const activeClass = round === selectedRound ? 'is-active' : ''
            const isCurrentRound = highlightCurrentRound && round === currentRound

            return (
              <button
                key={round}
                type="button"
                className={`round-tab ${timeClass} ${activeClass}`.trim()}
                aria-current={isCurrentRound ? 'date' : undefined}
                onClick={() => setSelectedRound(round)}
              >
                <span className="round-tab-label">{formatRound(round, roundLabel)}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="panel day-matches-panel">
        <div className="panel-head">
          <h2>Zápasy dne · {selectedMatchStageLabel}</h2>
          {roundDateLabel ? <span className="tag">{roundDateLabel}</span> : null}
        </div>

        <div className="day-matches-row">
          {roundMatches.map((match) => {
            const homeFlag = getMatchTeamLogoUrl(selectedTournamentId, match.home)
            const awayFlag = getMatchTeamLogoUrl(selectedTournamentId, match.away)
            const teamLogoClassName = getTeamLogoClassName(selectedTournamentId)
            const isActive = match.id === selectedMatch?.id
            const submittedTips = match.tips.filter((tip) => tip.pick && tip.pick !== '-').length
            const score = parseScore(match.score)

            return (
              <button
                key={match.id}
                type="button"
                className={`match-item ${isActive ? 'is-active' : ''}`}
                onClick={() => setSelectedMatchId(match.id)}
              >
                <p className="match-item-top">
                  <StartsAtLabel startsAt={match.startsAt} matchId={match.id} />
                </p>

                <div className="match-item-main">
                  <div className="teams-stack">
                    <span className="team-inline">
                      <span className="team-left">
                        {homeFlag ? (
                          <img className={`flag ${teamLogoClassName}`} src={homeFlag} alt={`Logo ${match.home}`} loading="lazy" />
                        ) : null}
                        {match.home}
                      </span>
                      <strong className={`team-goals ${score.winner === 'home' ? 'is-winner' : ''}`}>
                        {score.home ?? '-'}
                      </strong>
                    </span>
                    <span className="team-inline">
                      <span className="team-left">
                        {awayFlag ? (
                          <img className={`flag ${teamLogoClassName}`} src={awayFlag} alt={`Logo ${match.away}`} loading="lazy" />
                        ) : null}
                        {match.away}
                      </span>
                      <strong className={`team-goals ${score.winner === 'away' ? 'is-winner' : ''}`}>
                        {score.away ?? '-'}
                      </strong>
                    </span>
                  </div>
                </div>

                <p className="match-item-sub">Bank {match.bank} Kč • Tipy {submittedTips}/{players.length}</p>
              </button>
            )
          })}
        </div>
      </section>

      <section className="workspace">
        <aside className="panel match-list-panel">
          <div className="panel-head">
            <h2>Pořadí hráčů</h2>
            <button
              type="button"
              className="info-toggle"
              aria-expanded={showLongTermBankInfo}
              onClick={() => setShowLongTermBankInfo((prev) => !prev)}
            >
              Dlouhodobý bank
            </button>
          </div>

          {showLongTermBankInfo ? (
            <div className="long-term-bank-info">
              <p className="long-term-bank-summary">
                {longTermBank?.introLabel ?? 'Dlouhodobý bank'}{' '}
                <strong>{longTermBank?.totalAmount ?? 0} Kč</strong>{' '}
                {longTermBank?.introSuffix ?? 'se rozdělí:'}
              </p>

              <ol className="long-term-bank-payouts">
                {(longTermBank?.payouts ?? []).map((item) => (
                  <li
                    key={item.place}
                    className={`long-term-bank-place ${
                      item.place === 1 ? 'is-exact' : item.place === 2 ? 'is-near' : 'is-win'
                    }`}
                  >
                    <strong>{item.place}.</strong>
                    <span className="long-term-bank-amount">{item.amount} Kč</span>
                  </li>
                ))}
              </ol>

              <div className="long-term-bank-rules">
                <h3>{longTermBank?.tieBreakHeading ?? 'V případě shodného počtu bodů rozhoduje:'}</h3>
                <ol>
                  {(longTermBank?.tieBreakRules ?? []).map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ol>
              </div>
            </div>
          ) : null}

          <div className="standings-list">
            {standings.map((player, index) => (
              <article className="stand-card" key={player.id}>
                <div className="stand-top">
                  <p className="stand-rank">{index + 1}.</p>
                  <h3>{player.name}</h3>
                  <strong className="stand-points">{player.points} b</strong>
                </div>

                <div className="stand-bottom">
                  <div className="stand-stats">
                    <span className="stat-pill is-exact">
                      <span className="stat-label">10b</span>
                      <strong className="stat-count">{player.stats.exact}×</strong>
                    </span>
                    <span className="stat-pill is-near">
                      <span className="stat-label">5b</span>
                      <strong className="stat-count">{player.stats.near}×</strong>
                    </span>
                    <span className="stat-pill is-win">
                      <span className="stat-label">3b</span>
                      <strong className="stat-count">{player.stats.win}×</strong>
                    </span>
                    <span className="stat-pill is-miss">
                      <span className="stat-label">N</span>
                      <strong className="stat-count">{player.stats.noBet}×</strong>
                    </span>
                  </div>
                  <span className="stand-winnings">{player.winnings} Kč</span>
                </div>
              </article>
            ))}
          </div>
        </aside>

        <section className="panel detail-panel">
          {selectedMatch ? (
            <>
              <div className="panel-head">
                <h2>Tipy hráčů pro zápas</h2>
                <span className="tag">
                  Tipy {selectedMatchTips.filter((tip) => tip.pick && tip.pick !== '-').length}/
                  {players.length}
                </span>
              </div>

              <header className="selected-match-head">
                <p className="selected-match-time">
                  <StartsAtLabel startsAt={selectedMatch.startsAt} matchId={selectedMatch.id} />
                </p>
                <div className="selected-match-main">
                  <div className="selected-teams-stack">
                    {(() => {
                      const homeFlag = getMatchTeamLogoUrl(selectedTournamentId, selectedMatch.home)
                      const awayFlag = getMatchTeamLogoUrl(selectedTournamentId, selectedMatch.away)
                      const teamLogoClassName = getTeamLogoClassName(selectedTournamentId)
                      const score = parseScore(selectedMatch.score)

                      return (
                        <>
                          <span className="team-inline">
                            <span className="team-left">
                              {homeFlag ? (
                                <img
                                  className={`flag ${teamLogoClassName}`}
                                  src={homeFlag}
                                  alt={`Logo ${selectedMatch.home}`}
                                  loading="lazy"
                                />
                              ) : null}
                              {selectedMatch.home}
                            </span>
                            <strong className={`team-goals ${score.winner === 'home' ? 'is-winner' : ''}`}>
                              {score.home ?? '-'}
                            </strong>
                          </span>

                          <span className="team-inline">
                            <span className="team-left">
                              {awayFlag ? (
                                <img
                                  className={`flag ${teamLogoClassName}`}
                                  src={awayFlag}
                                  alt={`Logo ${selectedMatch.away}`}
                                  loading="lazy"
                                />
                              ) : null}
                              {selectedMatch.away}
                            </span>
                            <strong className={`team-goals ${score.winner === 'away' ? 'is-winner' : ''}`}>
                              {score.away ?? '-'}
                            </strong>
                          </span>
                        </>
                      )
                    })()}
                  </div>
                </div>
                <p className="selected-match-bank">Bank {selectedMatch.bank} Kč</p>
              </header>

              <div className="tips-table" role="table" aria-label="Tipy hráčů">
                <div className="tips-head" role="row">
                  <span>Poř.</span>
                  <span className="tips-head-shift" aria-hidden="true" />
                  <span>Hráč</span>
                  <span>Výhra</span>
                  <span>Tip</span>
                  <span>Body</span>
                </div>

                {selectedMatchTips.map((tip) => (
                  <div className="tips-row" role="row" key={`${selectedMatch.id}-${tip.playerId}`}>
                    <span className="rank-cell">{tip.rank}.</span>
                    <span className="shift-cell">
                      {tip.rankDelta > 0 ? (
                        <span className="rank-shift is-up" aria-label={`Posun nahoru o ${tip.rankDelta} míst`} title={`+${tip.rankDelta}`}>
                          ↑{tip.rankDelta}
                        </span>
                      ) : tip.rankDelta < 0 ? (
                        <span className="rank-shift is-down" aria-label={`Propad o ${Math.abs(tip.rankDelta)} míst`} title={`-${Math.abs(tip.rankDelta)}`}>
                          ↓{Math.abs(tip.rankDelta)}
                        </span>
                      ) : (
                        <span className="rank-shift is-flat" aria-hidden="true" />
                      )}
                    </span>
                    <span className="name-cell">
                      <span className="player-name">{tip.playerName}</span>
                      {tip.tipNote ? <span className="tip-note">{tip.tipNote}</span> : null}
                    </span>

                    <span className="payout-cell">
                      {tip.payout > 0 ? <span className="payout-badge">+{tip.payout} Kč</span> : null}
                    </span>

                    <span className="tip-value">
                      <SplitTip value={tip.pick} />
                    </span>
                    <span className={pointsClass(tip.points)}>
                      {tip.points === null ? '-' : `${tip.points} b`}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p>V tomto kole zatím nejsou zápasy.</p>
          )}
        </section>
      </section>

      <section className="panel rank-chart-panel">
        <div className="panel-head">
          <h2>Vývoj pořadí hráčů</h2>
          <span className="tag">od 1. dne</span>
        </div>

        {rankTimeline.rounds.length > 0 ? (
          <>
            <div className="rank-chart-wrap" role="img" aria-label="Graf vývoje pořadí hráčů">
              {(() => {
                const width = 940
                const height = 330
                const margin = { top: 16, right: 18, bottom: 38, left: 40 }
                const innerWidth = width - margin.left - margin.right
                const innerHeight = height - margin.top - margin.bottom
                const maxRank = rankTimeline.series.length
                const stepX = rankTimeline.rounds.length > 1 ? innerWidth / (rankTimeline.rounds.length - 1) : 0
                const rankToY = (rank) => margin.top + ((rank - 1) / Math.max(1, maxRank - 1)) * innerHeight
                const indexToX = (index) => margin.left + index * stepX
                const visibleSeries = rankTimeline.series.filter((player) => normalizedVisiblePlayerIds.includes(player.id))

                return (
                  <svg viewBox={`0 0 ${width} ${height}`} className="rank-chart" preserveAspectRatio="xMidYMid meet">
                    <rect x="0" y="0" width={width} height={height} fill="#f9fcff" />

                    {Array.from({ length: maxRank }, (_, i) => i + 1).map((rank) => (
                      <g key={`grid-${rank}`}>
                        <line
                          x1={margin.left}
                          y1={rankToY(rank)}
                          x2={width - margin.right}
                          y2={rankToY(rank)}
                          className="rank-grid-line"
                        />
                        {rank <= 5 || rank === maxRank ? (
                          <text x={8} y={rankToY(rank) + 4} className="rank-axis-label">
                            {rank}.
                          </text>
                        ) : null}
                      </g>
                    ))}

                    {rankTimeline.rounds.map((round, index) => (
                      <text
                        key={`x-${round}`}
                        x={indexToX(index)}
                        y={height - 20}
                        textAnchor="middle"
                        className="rank-axis-label"
                      >
                        {round}
                      </text>
                    ))}

                    <text x={width / 2} y={height - 4} textAnchor="middle" className="rank-axis-title">
                      Den turnaje
                    </text>

                    {visibleSeries.map((player) => {
                      const hasHover = Boolean(hoveredPlayerId)
                      const isHovered = hoveredPlayerId === player.id
                      const path = player.ranks
                        .map((rank, index) => `${index === 0 ? 'M' : 'L'} ${indexToX(index)} ${rankToY(rank)}`)
                        .join(' ')

                      return (
                        <g key={player.id}>
                          <path
                            d={path}
                            stroke={player.color}
                            className={`rank-line ${hasHover && !isHovered ? 'is-dim' : ''} ${isHovered ? 'is-highlight' : ''}`.trim()}
                          />
                          {player.ranks.map((rank, index) => (
                            <circle
                              key={`${player.id}-pt-${index}`}
                              cx={indexToX(index)}
                              cy={rankToY(rank)}
                              r="2.6"
                              fill={player.color}
                              className={`rank-line-end ${hasHover && !isHovered ? 'is-dim' : ''} ${isHovered ? 'is-highlight' : ''}`.trim()}
                            />
                          ))}
                        </g>
                      )
                    })}
                  </svg>
                )
              })()}
            </div>

            <div className="rank-legend">
              {rankTimeline.series.map((player) => (
                <button
                  type="button"
                  className={`rank-legend-item ${normalizedVisiblePlayerIds.includes(player.id) ? '' : 'is-muted'} ${hoveredPlayerId === player.id ? 'is-hover' : ''}`.trim()}
                  key={`legend-${player.id}`}
                  onClick={() => {
                    if (touchLegendHandledRef.current) {
                      touchLegendHandledRef.current = false
                      return
                    }
                    togglePlayerVisibility(player.id)
                  }}
                  onTouchStart={(event) => {
                    event.preventDefault()
                    touchLegendHandledRef.current = true

                    if (hoveredPlayerId !== player.id) {
                      setHoveredPlayerId(player.id)
                      return
                    }

                    togglePlayerVisibility(player.id)
                    setHoveredPlayerId('')
                  }}
                  onMouseEnter={() => setHoveredPlayerId(player.id)}
                  onMouseLeave={() => setHoveredPlayerId('')}
                  onFocus={() => setHoveredPlayerId(player.id)}
                  onBlur={() => setHoveredPlayerId('')}
                >
                  <span className="rank-legend-dot" style={{ backgroundColor: player.color }} />
                  {player.name}
                </button>
              ))}
            </div>
            <p className="rank-legend-hint">Kliknutím na jméno hráče v legendě čáru skryješ/zobrazíš.</p>
          </>
        ) : (
          <p>Zatím nejsou data pro graf.</p>
        )}
      </section>

    </main>
  )
}

export default App
