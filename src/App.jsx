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

function formBlockClass(entry) {
  if (entry?.isNoBet) return 'is-no-bet'
  const points = entry?.points
  if (points === 10) return 'is-exact'
  if (points === 5) return 'is-near'
  if (points === 3) return 'is-win'
  if (points === 0) return 'is-miss'
  return 'is-pending'
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

function pickToOutcome(pick) {
  const { home, away } = parseTipValue(pick)
  if (home === '-' || away === '-') return ''
  if (String(home).toUpperCase() === 'N' || String(away).toUpperCase() === 'N') return ''

  const homeGoals = Number(home)
  const awayGoals = Number(away)
  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return ''

  if (homeGoals > awayGoals) return '1'
  if (homeGoals < awayGoals) return '2'
  return 'X'
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

function buildSparkline(points, width = 120, height = 42, padding = 4) {
  const values = Array.isArray(points) ? points.filter((value) => Number.isFinite(value)) : []
  if (values.length === 0) {
    return { path: '', dots: [] }
  }

  if (values.length === 1) {
    const x = width / 2
    const y = height / 2
    return { path: `M ${x} ${y}`, dots: [{ x, y, value: values[0] }] }
  }

  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const range = maxValue - minValue || 1
  const stepX = (width - padding * 2) / (values.length - 1)

  const dots = values.map((value, index) => {
    const x = padding + stepX * index
    const normalized = (value - minValue) / range
    const y = height - padding - normalized * (height - padding * 2)
    return { x, y, value }
  })

  const path = dots
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ')

  return { path, dots }
}

function formatMoneyWithSign(value) {
  const amount = Number(value) || 0
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : ''
  const absolute = Math.abs(amount)
  return `${sign}${new Intl.NumberFormat('cs-CZ').format(absolute)} Kč`
}

function moneyAmountClass(value) {
  const amount = Number(value) || 0
  if (amount > 0) return 'is-positive'
  if (amount < 0) return 'is-negative'
  return 'is-neutral'
}

function App() {
  const tooltipTimerRef = useRef(null)
  const touchLegendHandledRef = useRef(false)
  const playerDetailHeadingRef = useRef(null)
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
  const selectedPlayerId = currentViewState.selectedPlayerId ?? ''
  const playerFormWindow = currentViewState.playerFormWindow ?? 'all'
  const standingsFormWindow = currentViewState.standingsFormWindow ?? 'all'
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

  const setSelectedPlayerId = (value) => {
    updateCurrentTournamentState((current) => ({
      selectedPlayerId:
        typeof value === 'function' ? value(current.selectedPlayerId ?? '') : value,
    }))
  }

  const setPlayerFormWindow = (value) => {
    updateCurrentTournamentState((current) => ({
      playerFormWindow:
        typeof value === 'function' ? value(current.playerFormWindow ?? 'all') : value,
    }))
  }

  const setStandingsFormWindow = (value) => {
    updateCurrentTournamentState((current) => ({
      standingsFormWindow:
        typeof value === 'function' ? value(current.standingsFormWindow ?? 'all') : value,
    }))
  }

  const toggleSelectedPlayerId = (playerId) => {
    setSelectedPlayerId((prev) => (prev === playerId ? '' : playerId))
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

  const effectiveSelectedPlayerId = useMemo(() => {
    if (standings.length === 0) return ''
    if (!selectedPlayerId) return ''
    const exists = standings.some((player) => player.id === selectedPlayerId)
    return exists ? selectedPlayerId : ''
  }, [standings, selectedPlayerId])

  const playedMatches = useMemo(
    () => matches.filter((match) => match.score && match.score !== '--:--'),
    [matches],
  )

  /*
  const allPlayersTipProgress = useMemo(() => {
    const totalTipSlots = playedMatches.length * players.length
    const submittedTips = playedMatches.reduce((sum, match) => {
      const tipsInMatch = (match.tips ?? []).filter(
        (tip) => tip.pick && tip.pick !== '-' && !isNoBetPick(tip.pick),
      ).length
      return sum + tipsInMatch
    }, 0)
    const coverage = totalTipSlots > 0 ? Math.round((submittedTips / totalTipSlots) * 100) : 0

    return {
      submittedTips,
      totalTipSlots,
      coverage,
    }
  }, [playedMatches, players.length])
  */

  const selectedPlayerProfile = useMemo(() => {
    if (!effectiveSelectedPlayerId) return null

    const selectedStanding = standings.find((player) => player.id === effectiveSelectedPlayerId)
    if (!selectedStanding) return null

    const timeline = matches
      .map((match) => {
        const tip = (match.tips ?? []).find((item) => item.playerId === effectiveSelectedPlayerId)
        if (!tip || !Number.isFinite(tip.points)) return null
        return {
          matchId: match.id,
          round: extractRound(match),
          points: tip.points,
          isNoBet: isNoBetPick(tip.pick),
        }
      })
      .filter(Boolean)

    const evaluatedCount = timeline.length
    const requestedWindow = playerFormWindow === 'all' ? evaluatedCount : Number(playerFormWindow)
    const recentWindowSize = Math.max(1, Math.min(evaluatedCount || 1, Number.isFinite(requestedWindow) ? requestedWindow : 10))
    const requestedFormWindow = playerFormWindow === 'all'
      ? 'all'
      : (Number.isFinite(requestedWindow) ? requestedWindow : 10)
    const recent = timeline.slice(-recentWindowSize)
    const trendWindowSize = playerFormWindow === 'all'
      ? Math.max(2, Math.floor(evaluatedCount / 2))
      : recentWindowSize
    const trendRecent = timeline.slice(-trendWindowSize)
    const trendPrevious = timeline.slice(-trendWindowSize * 2, -trendWindowSize)
    const recentRounds = [...new Set(recent.map((item) => item.round).filter((round) => Number.isFinite(round)))]

    const recentPoints = recent.reduce((sum, item) => sum + item.points, 0)
    const recentAverage = recent.length > 0 ? recentPoints / recent.length : 0
    const trendRecentAverage = trendRecent.length > 0
      ? trendRecent.reduce((sum, item) => sum + item.points, 0) / trendRecent.length
      : 0
    const previousAverage = trendPrevious.length > 0
      ? trendPrevious.reduce((sum, item) => sum + item.points, 0) / trendPrevious.length
      : null

    let trendLabel = 'bez srovnání'
    let trendDirection = 'neutral'
    let trendDeltaText = ''
    if (previousAverage !== null) {
      const diff = trendRecentAverage - previousAverage
      if (diff > 0.2) {
        trendLabel = 'roste'
        trendDirection = 'up'
        trendDeltaText = `+${diff.toFixed(2)} b/z`
      } else if (diff < -0.2) {
        trendLabel = 'klesá'
        trendDirection = 'down'
        trendDeltaText = `${diff.toFixed(2)} b/z`
      } else {
        trendLabel = 'stabilní'
        trendDirection = 'flat'
      }
    }

    const currentPositiveStreak = (() => {
      let streak = 0
      for (let i = timeline.length - 1; i >= 0; i -= 1) {
        if (timeline[i].points > 0) streak += 1
        else break
      }
      return streak
    })()

    const longestPositiveStreak = (() => {
      let best = 0
      let streak = 0
      for (const entry of timeline) {
        if (entry.points > 0) {
          streak += 1
          if (streak > best) best = streak
        } else {
          streak = 0
        }
      }
      return best
    })()

    const tippedMatchesCount = playedMatches.reduce((sum, match) => {
      const tip = (match.tips ?? []).find((item) => item.playerId === effectiveSelectedPlayerId)
      if (!tip || !tip.pick || tip.pick === '-' || isNoBetPick(tip.pick)) return sum
      return sum + 1
    }, 0)
    const totalMatchesCount = playedMatches.length
    const playerTipCoverage = totalMatchesCount > 0 ? Math.round((tippedMatchesCount / totalMatchesCount) * 100) : 0

    const recentExactCount = recent.filter((item) => item.points === 10).length
    const recentNearCount = recent.filter((item) => item.points === 5).length
    const recentWinCount = recent.filter((item) => item.points === 3).length
    const recentNoBetCount = recent.filter((item) => item.isNoBet).length
    const recentMissCount = Math.max(0, recent.length - recentExactCount - recentNearCount - recentWinCount - recentNoBetCount)
    const recentScoredCount = recentExactCount + recentNearCount + recentWinCount
    const toPercent = (value, total) => (total > 0 ? Math.round((value / total) * 100) : 0)

    const selectedRank = standings.findIndex((item) => item.id === selectedStanding.id) + 1
    const entryFeePerMatch = Number(selectedTournament?.entryFeePerMatch ?? 10)
    const seasonMatchesCount = Number(selectedTournament?.seasonMatchesCount ?? 67)
    const longTermContribution = Number(selectedTournament?.longTermBankContribution ?? 150)
    const payoutByPlace = new Map(
      (selectedTournament?.longTermBank?.payouts ?? [])
        .filter((item) => Number.isFinite(item?.place))
        .map((item) => [item.place, Number(item.amount) || 0]),
    )
    const projectedLongTermPayout = Number(
      (selectedTournament?.longTermBank?.payouts ?? []).find((item) => item.place === selectedRank)?.amount ?? 0,
    )
    const realizedWinnings = Number(selectedStanding.winnings ?? 0)
    const matchStakeTotal = Math.max(0, entryFeePerMatch * Math.max(0, seasonMatchesCount))
    const totalInserted = matchStakeTotal + longTermContribution
    const currentBalance = realizedWinnings - totalInserted
    const place1Payout = payoutByPlace.get(1) ?? 0
    const place2Payout = payoutByPlace.get(2) ?? 0
    const place3Payout = payoutByPlace.get(3) ?? 0
    const place1Balance = currentBalance + place1Payout
    const place2Balance = currentBalance + place2Payout
    const place3Balance = currentBalance + place3Payout

    const recentRoundsSet = new Set(recentRounds)
    const matchesInRecentRounds = recentRoundsSet.size > 0
      ? matches.filter((match) => recentRoundsSet.has(extractRound(match)))
      : []

    const averageRates = (() => {
      if (matchesInRecentRounds.length === 0 || players.length === 0) {
        return { scored: 0, exact: 0, near: 0, win: 0 }
      }

      const perPlayerRates = players
        .map((player) => {
          let total = 0
          let exact = 0
          let near = 0
          let win = 0

          for (const match of matchesInRecentRounds) {
            const tip = (match.tips ?? []).find((item) => item.playerId === player.id)
            if (!tip || !Number.isFinite(tip.points)) continue
            total += 1
            if (tip.points === 10) exact += 1
            if (tip.points === 5) near += 1
            if (tip.points === 3) win += 1
          }

          if (total === 0) return null
          return {
            scored: toPercent(exact + near + win, total),
            exact: toPercent(exact, total),
            near: toPercent(near, total),
            win: toPercent(win, total),
          }
        })
        .filter(Boolean)

      if (perPlayerRates.length === 0) {
        return { scored: 0, exact: 0, near: 0, win: 0 }
      }

      const sum = perPlayerRates.reduce(
        (acc, item) => ({
          scored: acc.scored + item.scored,
          exact: acc.exact + item.exact,
          near: acc.near + item.near,
          win: acc.win + item.win,
        }),
        { scored: 0, exact: 0, near: 0, win: 0 },
      )

      return {
        scored: Math.round(sum.scored / perPlayerRates.length),
        exact: Math.round(sum.exact / perPlayerRates.length),
        near: Math.round(sum.near / perPlayerRates.length),
        win: Math.round(sum.win / perPlayerRates.length),
      }
    })()

    const fieldComparison = (() => {
      const playerFormStats = players
        .map((player) => {
          let totalPoints = 0
          let totalTips = 0

          for (const match of matchesInRecentRounds) {
            const tip = (match.tips ?? []).find((item) => item.playerId === player.id)
            if (!tip || !Number.isFinite(tip.points)) continue
            totalPoints += tip.points
            totalTips += 1
          }

          return {
            id: player.id,
            avg: totalTips > 0 ? totalPoints / totalTips : 0,
            totalPoints,
          }
        })
        .sort((a, b) => {
          if (b.avg !== a.avg) return b.avg - a.avg
          if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints
          return a.id.localeCompare(b.id)
        })

      const formRank = Math.max(1, playerFormStats.findIndex((item) => item.id === selectedStanding.id) + 1)
      const totalPlayers = Math.max(1, playerFormStats.length)
      const percentile = totalPlayers <= 1
        ? 100
        : Math.round(((totalPlayers - formRank) / (totalPlayers - 1)) * 100)

      const sortedAverages = playerFormStats
        .map((item) => item.avg)
        .sort((a, b) => a - b)
      const middleIndex = Math.floor(sortedAverages.length / 2)
      const middleAverage = sortedAverages.length === 0
        ? 0
        : sortedAverages.length % 2 === 1
          ? sortedAverages[middleIndex]
          : (sortedAverages[middleIndex - 1] + sortedAverages[middleIndex]) / 2

      const vsMiddle = Math.round((recentAverage - middleAverage) * 100) / 100

      const currentPoints = Number(selectedStanding.points ?? 0)
      const thirdPoints = Number(standings[2]?.points ?? currentPoints)
      const fourthPoints = Number(standings[3]?.points ?? currentPoints)
      const top3GapLabel = selectedRank <= 3 ? 'Náskok na 4. místo' : 'Ztráta na 3. místo'
      const top3GapValue = selectedRank <= 3
        ? Math.max(0, currentPoints - fourthPoints)
        : Math.max(0, thirdPoints - currentPoints)

      return {
        percentile,
        vsMiddle,
        formRank,
        totalPlayers,
        top3GapLabel,
        top3GapValue,
      }
    })()

    const valueInsights = (() => {
      let againstMajority = 0
      let exactAgainstMajority = 0
      let pointsAgainstMajority = 0

      for (const match of playedMatches) {
        const selectedTip = (match.tips ?? []).find((tip) => tip.playerId === effectiveSelectedPlayerId)
        if (!selectedTip || !selectedTip.pick || selectedTip.pick === '-' || isNoBetPick(selectedTip.pick)) continue

        const selectedOutcome = pickToOutcome(selectedTip.pick)
        if (!selectedOutcome) continue

        const outcomeCounts = new Map()
        for (const tip of match.tips ?? []) {
          if (!tip.pick || tip.pick === '-' || isNoBetPick(tip.pick)) continue

          const outcome = pickToOutcome(tip.pick)
          if (!outcome) continue
          outcomeCounts.set(outcome, (outcomeCounts.get(outcome) ?? 0) + 1)
        }
        if (outcomeCounts.size === 0) continue

        let maxCount = 0
        for (const count of outcomeCounts.values()) {
          if (count > maxCount) maxCount = count
        }
        const majorityOutcomes = [...outcomeCounts.entries()]
          .filter(([, count]) => count === maxCount)
          .map(([outcome]) => outcome)

        // Pri remize nejde urcit jasnou vetsinu, zapas preskocime.
        if (majorityOutcomes.length !== 1) continue
        if (selectedOutcome === majorityOutcomes[0]) continue

        againstMajority += 1
        pointsAgainstMajority += Number(selectedTip.points) || 0
        if (selectedTip.points === 10) exactAgainstMajority += 1
      }

      return {
        againstMajority,
        exactAgainstMajority,
        pointsAgainstMajority,
        exactRate: toPercent(exactAgainstMajority, againstMajority),
        avgPoints: againstMajority > 0 ? (pointsAgainstMajority / againstMajority).toFixed(2) : '0.00',
      }
    })()

    return {
      id: selectedStanding.id,
      name: selectedStanding.name,
      evaluatedCount,
      formWindow: requestedFormWindow,
      recentCount: recent.length,
      recentPoints,
      recentAverage: recentAverage.toFixed(2),
      recentFormIndex: Math.round((recentAverage / 10) * 100),
      trendLabel,
      trendDirection,
      trendDeltaText,
      currentPositiveStreak,
      longestPositiveStreak,
      recentSequence: recent.map((item) => (item.isNoBet ? 'N' : item.points)).join(', '),
      recentSeries: recent.map((item) => ({ points: item.points, isNoBet: item.isNoBet })),
      recentRounds,
      successRates: {
        scored: toPercent(recentScoredCount, recent.length),
        exact: toPercent(recentExactCount, recent.length),
        near: toPercent(recentNearCount, recent.length),
        win: toPercent(recentWinCount, recent.length),
        miss: toPercent(recentMissCount, recent.length),
        noBet: toPercent(recentNoBetCount, recent.length),
      },
      successCounts: {
        exact: recentExactCount,
        near: recentNearCount,
        win: recentWinCount,
      },
      successRatesDelta: {
        scored: toPercent(recentScoredCount, recent.length) - averageRates.scored,
      },
      fieldComparison,
      valueInsights,
      moneySummary: {
        realizedWinnings,
        matchStakeTotal,
        longTermContribution,
        totalInserted,
        currentBalance,
        place1Balance,
        place2Balance,
        place3Balance,
        projectedLongTermPayout,
        selectedRank,
      },
      tippedMatchesCount,
      totalMatchesCount,
      playerTipCoverage,
    }
  }, [effectiveSelectedPlayerId, standings, playedMatches, playerFormWindow, matches, players, selectedTournament])

  const selectedPlayerRankSeries = useMemo(() => {
    if (!effectiveSelectedPlayerId) return null
    if (rankTimeline.rounds.length === 0 || rankTimeline.series.length === 0) return null

    const series = rankTimeline.series.find((player) => player.id === effectiveSelectedPlayerId)
    if (!series || series.ranks.length === 0) return null

    const preferredRounds = selectedPlayerProfile?.recentRounds ?? []
    const windowRounds = preferredRounds.length > 0
      ? rankTimeline.rounds.filter((round) => preferredRounds.includes(round))
      : rankTimeline.rounds
    const roundIndexByValue = new Map(rankTimeline.rounds.map((round, index) => [round, index]))
    const ranks = windowRounds
      .map((round) => series.ranks[roundIndexByValue.get(round)])
      .filter((rank) => Number.isFinite(rank))

    if (windowRounds.length === 0 || ranks.length === 0) {
      return {
        ...series,
        rounds: rankTimeline.rounds,
        ranks: series.ranks,
        maxRank: rankTimeline.series.length,
      }
    }

    return {
      ...series,
      rounds: windowRounds,
      ranks,
      maxRank: rankTimeline.series.length,
    }
  }, [effectiveSelectedPlayerId, rankTimeline, selectedPlayerProfile])

  const selectedPlayerPlacement = useMemo(() => {
    if (!effectiveSelectedPlayerId) return null

    const currentRank = Math.max(1, standings.findIndex((item) => item.id === effectiveSelectedPlayerId) + 1)
    const series = rankTimeline.series.find((player) => player.id === effectiveSelectedPlayerId)
    const ranks = (series?.ranks ?? []).filter((rank) => Number.isFinite(rank))

    const bestRank = ranks.length > 0 ? Math.min(...ranks) : currentRank
    const worstRank = ranks.length > 0 ? Math.max(...ranks) : currentRank

    return {
      currentRank,
      bestRank,
      worstRank,
    }
  }, [effectiveSelectedPlayerId, standings, rankTimeline])

  useEffect(() => {
    if (!selectedPlayerProfile || typeof window === 'undefined') return

    const target = playerDetailHeadingRef.current
    if (!target) return

    const topOffset = 12
    const rafId = window.requestAnimationFrame(() => {
      const targetTop = target.getBoundingClientRect().top + window.scrollY - topOffset
      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'smooth',
      })
    })

    return () => window.cancelAnimationFrame(rafId)
  }, [selectedPlayerProfile])

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
    const isMatchEvaluated = Boolean(selectedMatch.score && selectedMatch.score !== '--:--')

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
        const canShowRankDelta = isMatchEvaluated && Number.isFinite(tip.points)
        const rankDelta = canShowRankDelta && Number.isFinite(previousRank) ? previousRank - rank : 0
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

  const displayedStandings = useMemo(() => {
    if (standingsFormWindow === 'all') return standings

    const windowSize = Number(standingsFormWindow)
    if (!Number.isFinite(windowSize) || windowSize <= 0) return standings

    const recentPlayedMatches = playedMatches.slice(-windowSize)
    const playerOrder = new Map(scoreboard.map((player, index) => [player.id, index]))
    const pointsByPlayer = new Map(scoreboard.map((player) => [player.id, 0]))
    const payoutsByPlayer = new Map(scoreboard.map((player) => [player.id, 0]))
    const statsByPlayer = new Map(
      scoreboard.map((player) => [
        player.id,
        {
          exact: 0,
          near: 0,
          win: 0,
          noBet: 0,
        },
      ]),
    )

    for (const match of recentPlayedMatches) {
      const payouts = calculateMatchPayouts(
        match,
        playerOrder,
        manualPayoutOverridesByMatchId,
        remainderRecipientByMatchId,
      )
      for (const [playerId, payout] of payouts.entries()) {
        payoutsByPlayer.set(playerId, (payoutsByPlayer.get(playerId) ?? 0) + (Number(payout) || 0))
      }

      for (const tip of match.tips ?? []) {
        if (!pointsByPlayer.has(tip.playerId)) continue

        const points = Number.isFinite(tip.points) ? tip.points : 0
        pointsByPlayer.set(tip.playerId, (pointsByPlayer.get(tip.playerId) ?? 0) + points)

        const stats = statsByPlayer.get(tip.playerId)
        if (!stats) continue
        if (tip.points === 10) stats.exact += 1
        if (tip.points === 5) stats.near += 1
        if (tip.points === 3) stats.win += 1
        if (isNoBetPick(tip.pick)) stats.noBet += 1
      }
    }

    return scoreboard
      .map((player) => ({
        ...player,
        points: pointsByPlayer.get(player.id) ?? 0,
        stats: statsByPlayer.get(player.id) ?? { exact: 0, near: 0, win: 0, noBet: 0 },
        winnings: (payoutsByPlayer.get(player.id) ?? 0) + (bonusWinningsByPlayerId[player.id] ?? 0),
      }))
      .sort((a, b) => {
        const diff = (b.points ?? 0) - (a.points ?? 0)
        if (diff !== 0) return diff
        return (playerOrder.get(a.id) ?? 999) - (playerOrder.get(b.id) ?? 999)
      })
  }, [standingsFormWindow, standings, playedMatches, scoreboard, remainderRecipientByMatchId])

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
            {displayedStandings.map((player, index) => (
              <article className="stand-card" key={player.id}>
                <div className="stand-top">
                  <p className="stand-rank">{index + 1}.</p>
                  <h3>
                    <button
                      type="button"
                      className={`stand-player-button ${player.id === effectiveSelectedPlayerId ? 'is-active' : ''}`}
                      onClick={() => toggleSelectedPlayerId(player.id)}
                      title="Zobrazit detail hráče"
                    >
                      <span>{player.name}</span>
                    </button>
                  </h3>
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

          <div className="standings-window-controls" role="group" aria-label="Rozsah pořadí podle formy">
            <span className="player-window-label">Aktuální forma:</span>
            {[5, 10, 15, 'all'].map((option) => {
              const isActive = standingsFormWindow === option || (option === 'all' && standingsFormWindow === 'all')
              const label = option === 'all' ? 'vše' : `${option} z`
              return (
                <button
                  key={`standings-window-${option}`}
                  type="button"
                  className={`player-window-tab ${isActive ? 'is-active' : ''}`}
                  onClick={() => setStandingsFormWindow(option)}
                >
                  {label}
                </button>
              )
            })}
          </div>

        </aside>

        <section className="panel detail-panel">
          {selectedPlayerProfile ? (
            <>
              <div className="panel-head player-focus-headline" ref={playerDetailHeadingRef}>
                <h2 className="player-focus-title">
                  <span>Statistika hráče</span>
                  <span className="player-focus-separator" aria-hidden="true">|</span>
                  <span className="player-focus-player-name">{selectedPlayerProfile.name}</span>
                </h2>
                <button
                  type="button"
                  className="info-toggle"
                  onClick={() => setSelectedPlayerId('')}
                >
                  Zavřít
                </button>
              </div>

              <div className="player-window-controls" role="group" aria-label="Rozsah formy hráče">
                <span className="player-window-label">Vyber:</span>
                {[5, 10, 15, 20, 25, 'all'].map((option) => {
                  const isActive = selectedPlayerProfile.formWindow === option || (option === 'all' && selectedPlayerProfile.formWindow === 'all')
                  const label = option === 'all' ? 'vše' : String(option)
                  return (
                    <button
                      key={String(option)}
                      type="button"
                      className={`player-window-tab ${isActive ? 'is-active' : ''}`}
                      onClick={() => setPlayerFormWindow(option)}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>

              <p className="player-window-note">
                {selectedPlayerProfile.formWindow === 'all' ? (
                  <>
                    Filtr statistik <strong>všech</strong> posledních vyhodnocených zápasů.
                  </>
                ) : (
                  <>
                    Filtr statistik za posledních <strong>{selectedPlayerProfile.formWindow}</strong> vyhodnocených zápasů.
                  </>
                )}
              </p>

              {/*
              <section className="player-tip-progress-row" aria-label="Aktivita tipování">
                <article className="player-tip-progress">
                  <h3>Natipováno hráčem (odehrané zápasy)</h3>
                  <p>
                    <strong>{selectedPlayerProfile.tippedMatchesCount}/{selectedPlayerProfile.totalMatchesCount}</strong>
                    {' '}
                    ({selectedPlayerProfile.playerTipCoverage} %)
                  </p>
                </article>
                <article className="player-tip-progress">
                  <h3>Natipováno všichni hráči (odehrané zápasy)</h3>
                  <p>
                    <strong>{allPlayersTipProgress.submittedTips}/{allPlayersTipProgress.totalTipSlots}</strong>
                    {' '}
                    ({allPlayersTipProgress.coverage} %)
                  </p>
                </article>
              </section>
              */}

              <section className="player-rank-mini" aria-label="Vývoj pořadí hráče">
                <h3>Vývoj pořadí hráče</h3>
                {selectedPlayerRankSeries ? (
                  <div className="player-rank-mini-wrap" role="img" aria-label={`Vývoj pořadí hráče ${selectedPlayerProfile.name}`}>
                    {(() => {
                      const width = 940
                      const height = 104
                      const margin = { top: 12, right: 20, bottom: 24, left: 36 }
                      const innerWidth = width - margin.left - margin.right
                      const innerHeight = height - margin.top - margin.bottom
                      const rounds = selectedPlayerRankSeries.rounds
                      const ranks = selectedPlayerRankSeries.ranks
                      const maxRank = selectedPlayerRankSeries.maxRank
                      const stepX = rounds.length > 1 ? innerWidth / (rounds.length - 1) : 0
                      const rankToY = (rank) => margin.top + ((rank - 1) / Math.max(1, maxRank - 1)) * innerHeight
                      const indexToX = (index) => margin.left + index * stepX
                      const middleRanks = maxRank >= 8
                        ? [Math.round((maxRank + 1) / 3), Math.round((2 * (maxRank + 1)) / 3)]
                        : [Math.round((maxRank + 1) / 2)]
                      const axisRanks = [1, ...middleRanks, maxRank]
                        .filter((rank, index, arr) => Number.isFinite(rank) && arr.indexOf(rank) === index)
                        .sort((a, b) => a - b)
                      const path = ranks
                        .map((rank, index) => `${index === 0 ? 'M' : 'L'} ${indexToX(index)} ${rankToY(rank)}`)
                        .join(' ')

                      return (
                        <svg viewBox={`0 0 ${width} ${height}`} className="player-rank-mini-chart" preserveAspectRatio="none">
                          <rect x="0" y="0" width={width} height={height} fill="#f9fcff" />

                          {axisRanks.map((rank) => (
                            <g key={`mini-grid-${rank}`}>
                              <line
                                x1={margin.left}
                                y1={rankToY(rank)}
                                x2={width - margin.right}
                                y2={rankToY(rank)}
                                className="rank-grid-line"
                              />
                              <text x={8} y={rankToY(rank) + 4} className="rank-axis-label">
                                {rank}.
                              </text>
                            </g>
                          ))}

                          {rounds.map((round, index) => (
                            <text
                              key={`mini-x-${round}`}
                              x={indexToX(index)}
                              y={height - 8}
                              textAnchor="middle"
                              className="rank-axis-label"
                            >
                              {round}
                            </text>
                          ))}

                          <path d={path} stroke={selectedPlayerRankSeries.color} className="rank-line" />
                          {ranks.map((rank, index) => (
                            <circle
                              key={`${selectedPlayerProfile.id}-mini-rank-${index}`}
                              cx={indexToX(index)}
                              cy={rankToY(rank)}
                              r="2.8"
                              fill={selectedPlayerRankSeries.color}
                              className="rank-line-end"
                            />
                          ))}
                        </svg>
                      )
                    })()}
                  </div>
                ) : (
                  <p className="player-rank-mini-empty">Pro tohoto hráče zatím není graf pořadí k dispozici.</p>
                )}
              </section>

              <section className="player-focus-wide" aria-label="Detail hráče">
                <div className="player-focus-grid">
                <article className="player-focus-card">
                  <h3>Za {selectedPlayerProfile.recentCount} zápasů získáno</h3>
                  <p>
                    <strong>{selectedPlayerProfile.recentPoints}</strong>
                    <span className="player-card-unit"> b</span>
                  </p>
                </article>

                <article className="player-focus-card">
                  <h3>Průměr</h3>
                  <p>
                    <strong>{selectedPlayerProfile.recentAverage}</strong>
                    <span className="player-card-unit"> b/z</span>
                  </p>
                </article>

                <article className="player-focus-card is-trend">
                  <h3><span className="trend-chip">Trend</span></h3>
                  <p>
                    <span className={`player-trend-label is-${selectedPlayerProfile.trendDirection} trend-chip trend-chip-inline`}>
                      <span>{selectedPlayerProfile.trendLabel}</span>
                      {selectedPlayerProfile.trendDeltaText ? (
                        <span className="player-trend-delta">
                          <strong className="player-trend-delta-value">{selectedPlayerProfile.trendDeltaText.split(' ')[0]}</strong>
                          <span className="player-card-unit"> {selectedPlayerProfile.trendDeltaText.split(' ').slice(1).join(' ')}</span>
                        </span>
                      ) : null}
                    </span>
                  </p>

                  {(() => {
                    const sparkline = buildSparkline(
                      selectedPlayerProfile.recentSeries.map((entry) => entry.points),
                      172,
                      56,
                      8,
                    )
                    if (!sparkline.path) return null

                    const baselineY = 58
                    const areaPath = sparkline.dots.length > 0
                      ? `M ${sparkline.dots[0].x.toFixed(2)} ${baselineY} ${sparkline.dots
                        .map((dot) => `L ${dot.x.toFixed(2)} ${dot.y.toFixed(2)}`)
                        .join(' ')} L ${sparkline.dots[sparkline.dots.length - 1].x.toFixed(2)} ${baselineY} Z`
                      : ''

                    return (
                      <svg className="player-sparkline" viewBox="0 0 180 64" preserveAspectRatio="none" role="img" aria-label="Trend bodů hráče">
                        <path className="player-sparkline-area" d={areaPath} />
                        <path className="player-sparkline-line" d={sparkline.path} />
                        {sparkline.dots.map((dot, index) => (
                          <circle
                            key={`${selectedPlayerProfile.id}-${index}`}
                            className={`player-sparkline-dot ${index === sparkline.dots.length - 1 ? 'is-last' : ''}`}
                            cx={dot.x}
                            cy={dot.y}
                            r={index === sparkline.dots.length - 1 ? 2.4 : 1.5}
                          />
                        ))}
                      </svg>
                    )
                  })()}
                </article>

                <article className="player-focus-card is-streak">
                  <h3>Série tipů s body</h3>
                  <p className="player-streak-line">
                    <span>Aktuální</span>
                    <strong>
                      {selectedPlayerProfile.currentPositiveStreak}
                      {selectedPlayerProfile.currentPositiveStreak > 0 &&
                      selectedPlayerProfile.currentPositiveStreak === selectedPlayerProfile.longestPositiveStreak ? (
                        <span className="player-streak-badge">REKORD</span>
                      ) : null}
                    </strong>
                  </p>
                  <p className="player-streak-line">
                    <span>Historické max</span>
                    <strong>{selectedPlayerProfile.longestPositiveStreak}</strong>
                  </p>
                </article>
              </div>

              <div className="player-focus-seq">
                <span className="player-focus-seq-label">Grafický zisk bodů (od nejstaršího)</span>
                <div className="player-form-blocks" aria-label="Body v posledních zápasech">
                  {selectedPlayerProfile.recentSeries.length > 0 ? (
                    selectedPlayerProfile.recentSeries.map((entry, index) => (
                      <span
                        key={`${selectedPlayerProfile.id}-form-${index}`}
                        className={`player-form-block ${formBlockClass(entry)}`}
                        title={entry.isNoBet ? 'N/N (bez tipu)' : `${entry.points} b`}
                        aria-label={entry.isNoBet ? 'N/N bez tipu' : `${entry.points} bodů`}
                      />
                    ))
                  ) : (
                    <span className="player-form-empty">–</span>
                  )}
                </div>
              </div>

              <section className="player-success" aria-label="Úspěšnost tipů">
                <div className="player-success-head">
                  <h3>Úspěšnost tipů</h3>
                  <span
                    className={`player-success-benchmark ${
                      selectedPlayerProfile.successRatesDelta.scored > 0
                        ? 'is-up'
                        : selectedPlayerProfile.successRatesDelta.scored < 0
                          ? 'is-down'
                          : 'is-flat'
                    }`}
                  >
                    {selectedPlayerProfile.successRatesDelta.scored > 0
                      ? `o ${selectedPlayerProfile.successRatesDelta.scored} % lepší než průměr`
                      : selectedPlayerProfile.successRatesDelta.scored < 0
                        ? `o ${Math.abs(selectedPlayerProfile.successRatesDelta.scored)} % horší než průměr`
                        : 'stejné jako průměr'}
                  </span>
                </div>
                <div className="player-success-grid">
                  <div className="player-success-item is-exact">
                    <span className="player-success-label">10 bodů</span>
                    <div className="player-success-main">
                      <strong className="player-success-value">{selectedPlayerProfile.successRates.exact} %</strong>
                      <span className="player-success-count">{selectedPlayerProfile.successCounts.exact}×</span>
                    </div>
                  </div>
                  <div className="player-success-item is-near">
                    <span className="player-success-label">5 bodů</span>
                    <div className="player-success-main">
                      <strong className="player-success-value">{selectedPlayerProfile.successRates.near} %</strong>
                      <span className="player-success-count">{selectedPlayerProfile.successCounts.near}×</span>
                    </div>
                  </div>
                  <div className="player-success-item is-win">
                    <span className="player-success-label">3 body</span>
                    <div className="player-success-main">
                      <strong className="player-success-value">{selectedPlayerProfile.successRates.win} %</strong>
                      <span className="player-success-count">{selectedPlayerProfile.successCounts.win}×</span>
                    </div>
                  </div>
                  <div className="player-success-item is-miss">
                    <span className="player-success-label">0 bodů</span>
                    <div className="player-success-main">
                      <strong className="player-success-value">{selectedPlayerProfile.successRates.miss} %</strong>
                    </div>
                  </div>
                  <div className="player-success-item is-nobet">
                    <span className="player-success-label">N/N</span>
                    <div className="player-success-main">
                      <strong className="player-success-value">{selectedPlayerProfile.successRates.noBet} %</strong>
                    </div>
                  </div>
                  <div className="player-success-item is-total">
                    <span className="player-success-label">Bodované tipy</span>
                    <div className="player-success-main">
                      <strong className="player-success-value">{selectedPlayerProfile.successRates.scored} %</strong>
                    </div>
                  </div>
                </div>
              </section>

              <section className="player-field-compare" aria-label="Tipy proti většině">
                <h3>Tipy proti většině</h3>
                <div className="player-field-compare-grid">
                  <div className="player-field-item">
                    <span>Tipy mimo většinu</span>
                    <strong>{selectedPlayerProfile.valueInsights.againstMajority}×</strong>
                  </div>
                  <div className="player-field-item">
                    <span>10b u odlišných tipů</span>
                    <strong>{selectedPlayerProfile.valueInsights.exactRate} % ({selectedPlayerProfile.valueInsights.exactAgainstMajority}×)</strong>
                  </div>
                  <div className="player-field-item">
                    <span>Body z těchto tipů</span>
                    <strong>{selectedPlayerProfile.valueInsights.pointsAgainstMajority} b</strong>
                  </div>
                  <div className="player-field-item">
                    <span>Průměr z těchto tipů</span>
                    <strong>{selectedPlayerProfile.valueInsights.avgPoints} b/z</strong>
                  </div>
                </div>
              </section>

              <section className="player-field-compare" aria-label="Srovnání hráče s polem">
                <h3>Srovnání s polem</h3>
                <div className="player-field-compare-grid">
                  <div className="player-field-item">
                    <span>V poli je před</span>
                    <strong>{selectedPlayerProfile.fieldComparison.percentile} % hráčů</strong>
                  </div>
                  <div className="player-field-item">
                    <span>Proti středu pole</span>
                    <strong
                      className={`player-field-value ${
                        selectedPlayerProfile.fieldComparison.vsMiddle > 0
                          ? 'is-up'
                          : selectedPlayerProfile.fieldComparison.vsMiddle < 0
                            ? 'is-down'
                            : 'is-flat'
                      }`}
                    >
                      {selectedPlayerProfile.fieldComparison.vsMiddle > 0 ? '+' : ''}
                      {selectedPlayerProfile.fieldComparison.vsMiddle.toFixed(2)} b/z
                    </strong>
                  </div>
                  <div className="player-field-item">
                    <span>{selectedPlayerProfile.fieldComparison.top3GapLabel}</span>
                    <strong>{selectedPlayerProfile.fieldComparison.top3GapValue} b</strong>
                  </div>
                  <div className="player-field-item player-field-item-placement">
                    <span>Umístění (nejlépe | nejhůře)</span>
                    <strong>
                      <span className="placement-current">{selectedPlayerPlacement?.currentRank ?? '-'}.</span>
                      <span className="placement-range">({selectedPlayerPlacement?.bestRank ?? '-'}. | {selectedPlayerPlacement?.worstRank ?? '-'}.)</span>
                    </strong>
                  </div>
                </div>
              </section>

              <section className="player-money-wide" aria-label="Peněžní bilance hráče">
                <div className="player-money-head">
                  <h3>Peněžní bilance</h3>
                  <span>Tato statistika se nefiltruje</span>
                </div>
                <div className="player-money-grid">
                  <article className="money-stat-box is-outflow">
                    <span>Vloženo celkem</span>
                    <strong className={`money-amount ${moneyAmountClass(-selectedPlayerProfile.moneySummary.totalInserted)}`}>
                      {formatMoneyWithSign(-selectedPlayerProfile.moneySummary.totalInserted)}
                    </strong>
                  </article>
                  <article className="money-stat-box is-win">
                    <span>Výhry ze zápasů</span>
                    <strong className={`money-amount ${moneyAmountClass(selectedPlayerProfile.moneySummary.realizedWinnings)}`}>
                      {formatMoneyWithSign(selectedPlayerProfile.moneySummary.realizedWinnings)}
                    </strong>
                  </article>
                  <article className={`money-stat-box is-now ${selectedPlayerProfile.moneySummary.currentBalance >= 0 ? 'is-up' : 'is-down'}`}>
                    <span>Aktuální bilance</span>
                    <strong className={`money-amount ${moneyAmountClass(selectedPlayerProfile.moneySummary.currentBalance)}`}>
                      {formatMoneyWithSign(selectedPlayerProfile.moneySummary.currentBalance)}
                    </strong>
                  </article>
                </div>
                <article className="money-potential-strip" aria-label="Potenciální výhra při 1. 2. a 3. místě">
                  <span className="money-potential-label">Potenciální výhra při umístění na 1.  2.  3. místě</span>
                  <div className="money-potential-values">
                    <p className="money-potential-value">
                      <span>1.</span>
                      <strong className={`money-amount ${moneyAmountClass(selectedPlayerProfile.moneySummary.place1Balance)}`}>
                        {formatMoneyWithSign(selectedPlayerProfile.moneySummary.place1Balance)}
                      </strong>
                    </p>
                    <p className="money-potential-value">
                      <span>2.</span>
                      <strong className={`money-amount ${moneyAmountClass(selectedPlayerProfile.moneySummary.place2Balance)}`}>
                        {formatMoneyWithSign(selectedPlayerProfile.moneySummary.place2Balance)}
                      </strong>
                    </p>
                    <p className="money-potential-value">
                      <span>3.</span>
                      <strong className={`money-amount ${moneyAmountClass(selectedPlayerProfile.moneySummary.place3Balance)}`}>
                        {formatMoneyWithSign(selectedPlayerProfile.moneySummary.place3Balance)}
                      </strong>
                    </p>
                  </div>
                </article>
              </section>
              </section>
            </>
          ) : null}

          {selectedMatch ? (
            <>
              <div className="panel-head tips-panel-head">
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
                      <button
                        type="button"
                        className={`tip-player-button ${tip.playerId === effectiveSelectedPlayerId ? 'is-active' : ''}`}
                        onClick={() => toggleSelectedPlayerId(tip.playerId)}
                        title="Zobrazit detail hráče"
                      >
                        <span className="player-name">{tip.playerName}</span>
                      </button>
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
