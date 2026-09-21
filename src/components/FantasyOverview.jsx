import { useEffect, useMemo, useRef, useState } from 'react'
import { chartColors, fantasyLongTermBankByPeriod, fantasyPlayers, fantasyPrizeMoneyByPeriod, fantasyRounds, fantasySeasonStats, periods } from '../data/fantasyArchive'

function rankPlayers(players, rounds, lastRound = rounds.at(-1)) {
  return players
    .map((player, playerIndex) => {
      const scores = rounds.map((round) => round[1][playerIndex])
      const countedScores = scores.filter((score) => Number.isFinite(score) || score === 'N').map((score) => score === 'N' ? 0 : score)
      const points = countedScores.reduce((total, score) => total + score, 0)
      return {
        ...player,
        playerIndex,
        points,
        average: countedScores.length ? Math.round(points / countedScores.length) : 0,
        last: lastRound?.[1][playerIndex],
      }
    })
    .sort((first, second) => second.points - first.points || second.average - first.average || first.playerIndex - second.playerIndex)
}

function buildXAxisTickIndexes(length, maxLabels = 12) {
  if (length <= maxLabels) return new Set(Array.from({ length }, (_, index) => index))
  const indexes = new Set([0, length - 1])
  const step = Math.ceil((length - 1) / Math.max(1, maxLabels - 1))
  for (let index = step; index < length - 1; index += step) indexes.add(index)
  return indexes
}

function getPlayerStats(rounds, player, periodId = 'all', seasonStats = fantasySeasonStats, prizeMoneyByPeriod = fantasyPrizeMoneyByPeriod, longTermBankByPeriod = fantasyLongTermBankByPeriod, tipsportStatsByPeriod = {}) {
  const scores = rounds.map((round) => round[1][player.playerIndex])
  const countedScores = scores.filter((score) => Number.isFinite(score) || score === 'N').map((score) => score === 'N' ? 0 : score)
  const noBets = scores.filter((score) => score === 'N').length
  const roundNets = rounds.reduce((total, round) => total + (Number(round[3]?.[player.nick]) || 0), 0)
  const selectedRoundDailyRank = rounds.length === 1 ? Number(rounds[0][4]?.[player.nick]) || null : null
  const awards = rounds.reduce((total, round) => {
    const manualAwards = round[2] || {}
    const score = round[1][player.playerIndex]
    const roundScores = round[1].filter((item) => Number.isFinite(item) || item === 'N')
    if ((!Number.isFinite(score) && score !== 'N') || roundScores.length === 0) return total
    const numericScores = roundScores.filter(Number.isFinite)
    if (numericScores.length === 0) return { best: total.best, worst: total.worst + (score === 'N' ? 1 : 0) }
    const best = Math.max(...numericScores)
    const worst = roundScores.includes('N') ? 'N' : Math.min(...roundScores.filter(Number.isFinite))
    const tiedBest = numericScores.filter((item) => item === best).length > 1
    return {
      best: total.best + (Number.isFinite(score) && score === best && (!tiedBest || manualAwards.best?.includes(player.nick)) ? 1 : 0),
      worst: total.worst + (score === worst ? 1 : 0),
    }
  }, { best: 0, worst: 0 })
  const periodEntriesForPlayer = periodId === 'all'
    ? Object.entries(tipsportStatsByPeriod)
      .filter(([key]) => key !== 'all')
      .map(([, stats]) => stats?.[player.nick])
      .filter(Boolean)
    : []
  // Bez seznamu obdobi (napr. archivovany turnaj bez rozpadu po mesicich) se drzi celkove udaje ze seasonStats.
  const periodStats = periodId === 'all'
    ? (periodEntriesForPlayer.length > 0
      ? periodEntriesForPlayer.reduce((total, stats) => ({
        bestDailyRank: stats.bestDailyRank !== null && stats.bestDailyRank !== undefined && stats.bestDailyRank !== '' && Number.isFinite(Number(stats.bestDailyRank) ) ? Math.min(total.bestDailyRank ?? Infinity, Number(stats.bestDailyRank)) : total.bestDailyRank,
        bestPeriodRank: stats.bestPeriodRank !== null && stats.bestPeriodRank !== undefined && stats.bestPeriodRank !== '' && Number.isFinite(Number(stats.bestPeriodRank)) ? Math.min(total.bestPeriodRank ?? Infinity, Number(stats.bestPeriodRank)) : total.bestPeriodRank,
        fantasyNets: total.fantasyNets + (Number(stats.fantasyNets) || 0),
      }), { fantasyNets: roundNets + (Number(seasonStats[player.nick]?.finalFantasyNets) || 0) })
      : { fantasyNets: roundNets + (Number(seasonStats[player.nick]?.finalFantasyNets ?? seasonStats[player.nick]?.fantasyNets) || 0) })
    : { ...(tipsportStatsByPeriod[periodId]?.[player.nick] ?? {}), fantasyNets: roundNets + (Number(tipsportStatsByPeriod[periodId]?.[player.nick]?.fantasyNets) || 0) }
  const dailyRankValues = periodId === 'all' || rounds.length > 1
    ? rounds.map((round) => Number(round[4]?.[player.nick])).filter((rank) => Number.isFinite(rank) && rank > 0)
    : []
  return {
    ...seasonStats[player.nick],
    ...periodStats,
    worstDailyRank: dailyRankValues.length ? Math.max(...dailyRankValues) : null,
    bestDailyRank: selectedRoundDailyRank ?? periodStats.bestDailyRank ?? seasonStats[player.nick]?.bestDailyRank,
    prizeMoney: prizeMoneyByPeriod[periodId]?.[player.nick] ?? 0,
    longTermBank: longTermBankByPeriod[periodId]?.[player.nick] ?? 0,
    averageLastFive: countedScores.length ? Math.round(countedScores.slice(-5).reduce((total, score) => total + score, 0) / Math.min(5, countedScores.length)) : 0,
    bestScore: countedScores.length ? Math.max(...countedScores) : null,
    worstScore: countedScores.length ? Math.min(...countedScores) : null,
    missed: noBets,
    awards,
  }
}

function getMetricValue(player, key) {
  if (key === 'awards.best') return player.awards.best
  if (key === 'awards.worst') return player.awards.worst
  return player[key]
}

function formatMetricValue(value, key) {
  if (value === 'N') return 'N'
  if (value === '') return '-'
  if ((key.includes('Rank') || key === 'fantasyNets' || key === 'prizeMoney') && (value === null || value === undefined)) return '-'
  if (!Number.isFinite(value)) return 'N'
  if (key.includes('Rank')) return `${value.toLocaleString('cs-CZ')}.`
  if (key === 'prizeMoney') return `${value.toLocaleString('cs-CZ')} Kč`
  return value.toLocaleString('cs-CZ')
}

function getDisplayMetricValue(player, key, selectedRound) {
  if (selectedRound && key === 'points') return player.last ?? ''
  return getMetricValue(player, key)
}

function getTotalPrizeMoney(player) {
  return (Number(player.prizeMoney) || 0) + (Number(player.longTermBank) || 0)
}

function getDisplayedPrizeMoney(player, periodId, prizeMoneyByPeriod = {}) {
  if (periodId !== 'all') return Number(player.prizeMoney) || 0
  return Object.entries(prizeMoneyByPeriod)
    .filter(([key]) => key !== 'all')
    .reduce((total, [, payouts]) => total + (Number(payouts?.[player.nick]) || 0), 0)
}

function getLongTermBankForRank(rank, payouts) {
  return payouts.find((item) => item.place === rank)?.amount ?? 0
}

function formatFantasyDate(date) {
  if (!date) return ''
  const [day, month] = String(date).split('.')
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.2026`
}

function formatFantasyShortDate(date) {
  if (!date) return ''
  const [day, month] = String(date).split('.')
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.`
}

function parseFantasyPayouts(value) {
  return String(value || '').split(';').map((amount, index) => ({ place: index + 1, amount: Number(amount.trim()) || 0 })).filter((item) => item.amount > 0)
}

function FantasyOverview({ selectedTournamentId = '', selectedTournament = null, refreshKey = 0 }) {
  const [fantasyData, setFantasyData] = useState(null)
  const isDbFantasy = selectedTournamentId?.startsWith('db:')
  const [periodId, setPeriodId] = useState('all')
  const [selectedRoundIndex, setSelectedRoundIndex] = useState(null)
  const [sort, setSort] = useState({ key: 'points', direction: 'desc' })
  const [statView, setStatView] = useState('standings')
  const [selectedPlayerNick, setSelectedPlayerNick] = useState('')
  const [expandedFantasyBank, setExpandedFantasyBank] = useState(null)
  const [visiblePlayerNicks, setVisiblePlayerNicks] = useState(() => fantasyPlayers.map((player) => player.nick))
  const [hoveredPlayerNick, setHoveredPlayerNick] = useState('')
  const touchLegendHandledRef = useRef(false)
  const fantasyOneTableRef = useRef(null)
  const activeFantasyPlayers = fantasyData?.players ?? (isDbFantasy ? [] : fantasyPlayers)
  const activePeriodsRaw = fantasyData?.periods?.length ? fantasyData.periods : (isDbFantasy ? [{ id: 'all', label: 'Celkem' }] : periods)
  const activeFantasyRounds = fantasyData?.rounds ?? (isDbFantasy ? [] : fantasyRounds)
  const activeSeasonStats = fantasyData?.seasonStats ?? (isDbFantasy ? {} : fantasySeasonStats)
  const activePrizeMoneyByPeriod = fantasyData?.prizeMoneyByPeriod ?? (isDbFantasy ? {} : fantasyPrizeMoneyByPeriod)
  const activeLongTermBankByPeriod = fantasyData?.longTermBankByPeriod ?? (isDbFantasy ? {} : fantasyLongTermBankByPeriod)
  const activeTipsportStatsByPeriod = fantasyData?.tipsportStatsByPeriod ?? {}
  const tipsportPlayerCount = Number(fantasyData?.tipsportPlayerCount ?? selectedTournament?.tipsportPlayerCount) || 0
  const fantasyMonths = Number(fantasyData?.fantasyMonths) || 0
  const fantasyPeriodRankLabel = fantasyData?.fantasyPeriodRankLabel ?? 'Měsíční'
  const fantasyMoneyRules = fantasyData?.fantasyMoneyRules ?? {}
  const fantasyRules = fantasyData?.tieBreakRules ?? []
  const entryFeeFrequency = fantasyMoneyRules.entryFeeFrequency || 'monthly'
  const payoutMode = fantasyMoneyRules.payoutMode || 'period'
  const longTermPoolFrequency = fantasyMoneyRules.longTermPoolFrequency || 'monthly'
  const fantasyShortBankAmount = (Number(fantasyMoneyRules.entryFee) || 0) * activeFantasyPlayers.length
  const fantasyShortBankPayouts = parseFantasyPayouts(fantasyMoneyRules.periodPayouts)
  const hasShortBank = fantasyShortBankPayouts.length > 0 && payoutMode === 'period'
  const fantasyBankContribution = Number(fantasyMoneyRules.longTermPool) || 0
  const fantasyBankAmount = longTermPoolFrequency === 'tournament'
    ? fantasyBankContribution * activeFantasyPlayers.length
    : fantasyBankContribution * Math.max(1, fantasyMonths)
  const fantasyBankPayouts = parseFantasyPayouts(fantasyMoneyRules.longTermPayouts)
  const hasFinalFantasyRanks = periodId === 'all' && activeFantasyPlayers.some((player) => {
    const rank = activeSeasonStats[player.nick]?.finalFantasyRank
    return rank !== null && rank !== undefined && rank !== '' && Number.isFinite(Number(rank))
  })
  const seasonLabel = selectedTournament?.season ? `Sezóna ${selectedTournament.season}` : 'Základní část 2024/25'
  const periodContainsDate = (item, date) => item.roundDates?.length ? item.roundDates.includes(date) : item.months?.includes(date.split('.')[1])
  const activePeriods = activePeriodsRaw.filter((item) => item.id === 'all' || activeFantasyRounds.some(([date]) => periodContainsDate(item, date)))
  const period = activePeriods.find((item) => item.id === periodId) ?? activePeriods[0]
  const periodRounds = useMemo(() => periodId === 'all' ? activeFantasyRounds : activeFantasyRounds.filter(([date]) => periodContainsDate(period, date)), [activeFantasyRounds, period, periodId])
  const visibleRounds = selectedRoundIndex === null ? periodRounds : periodRounds.slice(0, selectedRoundIndex + 1)
  const selectedRound = selectedRoundIndex === null ? null : periodRounds[selectedRoundIndex]
  const rankingRounds = selectedRound ? [selectedRound] : visibleRounds
  const selectedTournamentRoundIndex = selectedRound ? activeFantasyRounds.indexOf(selectedRound) : activeFantasyRounds.indexOf(visibleRounds.at(-1))
  const lastRound = selectedRound ?? (periodId === 'all' ? visibleRounds.at(-1) : visibleRounds.at(-2))
  const standings = rankPlayers(activeFantasyPlayers, rankingRounds, selectedRound ?? lastRound)
  const totalStandings = rankPlayers(activeFantasyPlayers, activeFantasyRounds)
  const totalRankByNick = new Map(totalStandings.map((player, index) => [player.nick, index + 1]))
  const previousStandings = rankPlayers(activeFantasyPlayers, visibleRounds.slice(0, -1))
  const rankByPlayer = new Map(standings.map((player, index) => [player.name, index + 1]))
  const previousRankByPlayer = new Map(previousStandings.map((player, index) => [player.name, index + 1]))
  useEffect(() => {
    setFantasyData(null)
    if (!isDbFantasy) return
    let cancelled = false
    fetch(`/api/fantasy/data?tournamentId=${encodeURIComponent(selectedTournamentId)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!cancelled && payload?.ok) setFantasyData(payload)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [isDbFantasy, refreshKey, selectedTournamentId])
  useEffect(() => {
    const currentNicks = new Set(activeFantasyPlayers.map((player) => player.nick))
    setVisiblePlayerNicks((visible) => {
      const retained = visible.filter((nick) => currentNicks.has(nick))
      const newPlayers = activeFantasyPlayers.map((player) => player.nick).filter((nick) => !visible.includes(nick))
      return [...retained, ...newPlayers]
    })
  }, [activeFantasyPlayers])
  const standingsWithStats = useMemo(() => standings.map((player) => ({ ...player, ...getPlayerStats(rankingRounds, player, periodId, activeSeasonStats, activePrizeMoneyByPeriod, activeLongTermBankByPeriod, activeTipsportStatsByPeriod) })), [activeLongTermBankByPeriod, activePrizeMoneyByPeriod, activeSeasonStats, activeTipsportStatsByPeriod, periodId, rankingRounds, standings])
  const displayedStandings = useMemo(() => [...standingsWithStats].sort((first, second) => {
    const firstValue = sort.key === 'prizeMoney' ? getDisplayedPrizeMoney(first, periodId, activePrizeMoneyByPeriod) : getMetricValue(first, sort.key)
    const secondValue = sort.key === 'prizeMoney' ? getDisplayedPrizeMoney(second, periodId, activePrizeMoneyByPeriod) : getMetricValue(second, sort.key)
    const firstHasValue = Number.isFinite(firstValue)
    const secondHasValue = Number.isFinite(secondValue)
    if (firstHasValue !== secondHasValue) return firstHasValue ? -1 : 1
    const comparison = firstValue - secondValue
    if (comparison !== 0) return sort.direction === 'asc' ? comparison : -comparison
    if (sort.key === 'awards.best') {
      const tieBreak = (Number(first.awards?.worst) || 0) - (Number(second.awards?.worst) || 0)
      if (tieBreak !== 0) return tieBreak
    }
    if (sort.key === 'awards.worst') {
      const tieBreak = (Number(second.awards?.best) || 0) - (Number(first.awards?.best) || 0)
      if (tieBreak !== 0) return tieBreak
    }
    return second.points - first.points || first.playerIndex - second.playerIndex
  }), [activePrizeMoneyByPeriod, periodId, sort, standingsWithStats])
  const [forceStandingsMetricsBreak, setForceStandingsMetricsBreak] = useState(false)
  useEffect(() => {
    const table = fantasyOneTableRef.current
    if (!table) return undefined
    const measure = () => {
      if (statView !== 'standings') {
        setForceStandingsMetricsBreak(false)
        return
      }
      table.classList.remove('has-standings-bank')
      const wrapped = [...table.querySelectorAll('.fantasy-row-metrics')].some((metrics) => {
        const tops = new Set([...metrics.children].map((child) => Math.round(child.getBoundingClientRect().top)))
        return tops.size > 1
      })
      table.classList.toggle('has-standings-bank', wrapped)
      setForceStandingsMetricsBreak(wrapped)
    }
    const frame = window.requestAnimationFrame(measure)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(table)
    return () => {
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
    }
  }, [displayedStandings, statView])
  const selectedPlayer = standings.find((player) => player.nick === selectedPlayerNick) ?? null
  const selectedPlayerStats = useMemo(() => {
    if (!selectedPlayer) return null
    const stats = getPlayerStats(visibleRounds, selectedPlayer, periodId, activeSeasonStats, activePrizeMoneyByPeriod, activeLongTermBankByPeriod, activeTipsportStatsByPeriod)
    const scores = visibleRounds.map((round) => round[1][selectedPlayer.playerIndex])
    const countedScores = scores.filter((score) => Number.isFinite(score) || score === 'N')
    const ranks = visibleRounds.map((_, index) => rankPlayers(activeFantasyPlayers, visibleRounds.slice(0, index + 1)).findIndex((player) => player.nick === selectedPlayer.nick) + 1)
    return {
      rounds: countedScores.length,
      averageLastFive: stats.averageLastFive,
      best: stats.bestScore,
      worst: stats.worstScore,
      missed: stats.missed,
      bestRank: ranks.length ? Math.min(...ranks) : null,
      awards: stats.awards,
    }
  }, [activeFantasyPlayers, activeLongTermBankByPeriod, activePrizeMoneyByPeriod, activeSeasonStats, activeTipsportStatsByPeriod, periodId, selectedPlayer, visibleRounds])
  const rankTimeline = useMemo(() => {
    const ranksByRound = statView === 'prizes'
      ? null
      : periodRounds.map((_, roundIndex) => {
        const rankedPlayers = rankPlayers(activeFantasyPlayers, periodRounds.slice(0, roundIndex + 1))
        return new Map(rankedPlayers.map((player, rankIndex) => [player.nick, rankIndex + 1]))
      })
    return {
      rounds: periodRounds.map(([date]) => date),
      series: activeFantasyPlayers.map((player, playerIndex) => ({
        ...player,
        color: chartColors[playerIndex % chartColors.length],
        ranks: statView === 'prizes'
          ? periodRounds.map((round) => {
            const rank = Number(round[4]?.[player.nick])
            return Number.isFinite(rank) && rank > 0 ? rank : null
          })
          : ranksByRound.map((rankByPlayer) => rankByPlayer.get(player.nick)),
      })),
    }
  }, [activeFantasyPlayers, periodRounds, statView])

  const togglePlayerVisibility = (nick) => {
    setVisiblePlayerNicks((current) => current.includes(nick) ? current.filter((item) => item !== nick) : [...current, nick])
  }

  const changeSort = (key) => {
    const defaultDirection = key === 'worstDailyRank' ? 'desc' : key === 'worstScore' || key.includes('Rank') ? 'asc' : 'desc'
    setSort((current) => current.key === key
      ? { key, direction: current.direction === 'desc' ? 'asc' : 'desc' }
      : { key, direction: defaultDirection })
  }

  const sortLabel = (key, label) => `${label}, ${sort.key === key ? (sort.direction === 'desc' ? 'sestupně' : 'vzestupně') : 'seřadit'}`
  const statViews = {
    standings: [['prizeMoney', 'Peníze'], ['average', 'Průměr'], ['averageLastFive', 'Forma 5'], ['points', 'Body']],
    performance: [['worstScore', 'Nejhorší body'], ['last', selectedRound ? 'Body v kole' : 'Poslední body'], ['bestScore', 'Nejlepší body']],
    awards: [['awards.worst', 'Kopyto kola'], ['missed', 'Netipováno'], ['awards.best', 'Borec kola']],
    prizes: selectedRound
      ? [['fantasyNets', 'Nety'], ['bestDailyRank', 'Tipsport pořadí']]
      : [['bestPeriodRank', `Nejlepší ${fantasyPeriodRankLabel.toLowerCase()}`], ['fantasyNets', 'Nety'], ...(hasFinalFantasyRanks ? [['finalFantasyRank', 'Konečné umístění']] : []), ...(periodId === 'all' ? [['worstDailyRank', 'Nejhorší denní']] : []), ['bestDailyRank', 'Nejlepší denní']],
  }
  const columns = statViews[statView]
  const metricClass = (key) => `fantasy-metric-${key.replace('.', '-')}`
  const metricLabel = (key, label) => {
    const compactLabel = key === 'bestDailyRank'
      ? (selectedRound ? 'Tipsport' : 'Nejlepší')
      : key === 'bestPeriodRank'
        ? `Nej ${fantasyPeriodRankLabel === 'Měsíční' ? 'měsíční' : 'týdenní'}`
        : key === 'worstDailyRank'
          ? 'Nejhorší'
        : key === 'finalFantasyRank' ? 'Konečné' : label
    return <><span className="fantasy-label-wide">{label}</span><span className="fantasy-label-compact">{compactLabel}</span></>
  }
  const statViewEyebrow = {
    standings: 'Pořadí hráčů',
    performance: 'Bodový výkon hráčů',
    awards: 'Ocenění hráčů',
    prizes: 'Tipsport pořadí',
  }[statView]
  const statViewContext = selectedRound
    ? `${statViewEyebrow} · průběžně po ${selectedTournamentRoundIndex + 1}. kole turnaje`
    : statViewEyebrow
  const resetSelectionSort = () => setSort({ key: statView === 'prizes' ? 'bestDailyRank' : 'points', direction: statView === 'prizes' ? 'asc' : 'desc' })

  return (
    <div className="fantasy-preview">
      <section className="panel fantasy-filter-panel">
        <div>
          <span className="fantasy-eyebrow">{seasonLabel}</span>
          <h2>Fantasy liga</h2>
        </div>
        <div className="fantasy-period-tabs" role="tablist" aria-label="Vyhodnocovací období">
          {activePeriods.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={item.id === periodId} className={`player-window-tab ${item.id === periodId ? 'is-active' : ''}`} onClick={() => {
              setPeriodId(item.id)
              setSelectedRoundIndex(null)
              resetSelectionSort()
            }}>
              {item.label}
            </button>
          ))}
        </div>
        {periodId !== 'all' ? (
          <div className="fantasy-period-rounds">
            <div className="fantasy-period-rounds-head">
              <strong>Kola · {period.label}</strong>
              <span>{periodRounds.length} kol</span>
            </div>
            <div className="fantasy-period-round-tabs" role="tablist" aria-label={`Fantasy kola za ${period.label}`}>
              <button type="button" role="tab" aria-selected={selectedRoundIndex === null} className={`round-tab ${selectedRoundIndex === null ? 'is-active' : 'is-past'}`} onClick={() => {
                setSelectedRoundIndex(null)
                resetSelectionSort()
              }}>
                <span className="round-tab-label">Souhrn</span>
                <small>celý měsíc</small>
              </button>
              {periodRounds.map(([date], index) => (
                <button key={date} type="button" role="tab" aria-selected={selectedRoundIndex === index} className={`round-tab ${selectedRoundIndex === index ? 'is-active' : 'is-past'}`} onClick={() => {
                  setSelectedRoundIndex(index)
                  resetSelectionSort()
                }}>
                  <span className="round-tab-label">{activeFantasyRounds.indexOf(periodRounds[index]) + 1}. kolo</span>
                  <small>{formatFantasyShortDate(date)}</small>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section ref={fantasyOneTableRef} className={`panel fantasy-one-table${forceStandingsMetricsBreak ? ' has-standings-bank' : ''}`}>
        <div className="panel-head">
          <div>
            <span className="fantasy-eyebrow">{statViewContext}</span>
            <h2>{selectedRound ? formatFantasyDate(selectedRound[0]) : `Pořadí · ${period.label}`}</h2>
          </div>
          <span className="fantasy-round-count">{visibleRounds.length} kol</span>
        </div>

        {activeFantasyPlayers.length === 0 || activeFantasyRounds.length === 0 ? <p className="fantasy-detail-hint">Fantasy turnaj zatím nemá uložené hráče nebo kola.</p> : null}

        <div className="fantasy-mobile-sort" role="group" aria-label="Řazení pořadí">
          <span>Řadit:</span>
          {columns.map(([key, label]) => (
            <button key={key} type="button" className={`player-window-tab ${sort.key === key ? 'is-active' : ''}`} onClick={() => changeSort(key)}>
              {label}{sort.key === key ? (sort.direction === 'desc' ? ' ↓' : ' ↑') : ''}
            </button>
          ))}
        </div>

        <div className="fantasy-stat-view" role="tablist" aria-label="Porovnání hráčů">
          {[['standings', 'Pořadí'], ['performance', 'Výkon'], ['awards', 'Ocenění'], ['prizes', 'Tipsport']].map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={statView === key} className={`player-window-tab ${statView === key ? 'is-active' : ''}`} onClick={() => {
              setStatView(key)
              const defaultKey = key === 'standings' ? 'points' : key === 'performance' ? 'bestScore' : key === 'awards' ? 'awards.best' : key === 'prizes' ? 'bestDailyRank' : statViews[key][0][0]
              setSort({ key: defaultKey, direction: defaultKey.includes('Rank') ? 'asc' : 'desc' })
            }}>{label}</button>
          ))}
        </div>

        <div className={`fantasy-table-head is-${statView} ${columns.length === 4 ? 'is-wide' : columns.length === 2 ? 'is-compact' : ''}`}>
          <span>#</span>
          <span>±</span>
          <span>Hráč</span>
          {columns.map(([key, label]) => <button key={key} type="button" className={`${metricClass(key)} ${sort.key === key ? 'is-active' : ''}`} aria-label={sortLabel(key, label)} onClick={() => changeSort(key)}>{metricLabel(key, label)}<span aria-hidden="true">{sort.key === key ? (sort.direction === 'desc' ? ' ↓' : ' ↑') : ''}</span></button>)}
        </div>
        <div className="standings-list">
          {displayedStandings.map((player, displayedIndex) => {
            const rank = displayedIndex + 1
            const standingsRank = rankByPlayer.get(player.name)
            const shift = visibleRounds.length > 1 ? (previousRankByPlayer.get(player.name) ?? standingsRank) - standingsRank : 0
            return (
              <article className={`stand-card fantasy-table-row is-${statView} ${columns.length === 4 ? 'is-wide' : columns.length === 2 ? 'is-compact' : ''} ${selectedPlayerNick === player.nick ? 'is-selected' : ''}`} key={player.name} role="button" tabIndex={0} onClick={() => setSelectedPlayerNick(player.nick)} onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') setSelectedPlayerNick(player.nick)
              }}>
                <span className={`fantasy-rank is-rank-${rank}`}>{rank}</span>
                <span className={`fantasy-rank-shift ${shift > 0 ? 'is-up' : shift < 0 ? 'is-down' : 'is-flat'}`} aria-label={shift > 0 ? `posun nahoru o ${shift}` : shift < 0 ? `posun dolů o ${Math.abs(shift)}` : 'beze změny'}>
                  {shift > 0 ? `↑${shift}` : shift < 0 ? `↓${Math.abs(shift)}` : '–'}
                </span>
                <span className="fantasy-player-name">
                  {player.avatar ? <img className="user-avatar fantasy-player-avatar" src={player.avatar} alt="" /> : <span className="user-avatar fantasy-player-avatar is-placeholder" aria-hidden="true">{player.name.slice(0, 1).toUpperCase()}</span>}
                  <span className="fantasy-player-identity"><span>{player.name}</span><small>{player.nick}</small></span>
                </span>
                <span className="fantasy-row-metrics">
                  {columns.slice(0, -1).map(([key, label]) => <span key={key} className={`${metricClass(key)} fantasy-cell fantasy-cell-${key === 'fantasyNets' ? 'nets' : 'secondary'} ${key === 'prizeMoney' ? 'fantasy-money-cell' : ''} ${sort.key === key ? 'is-active-sort' : ''}`}><small className="fantasy-cell-label">{metricLabel(key, label)}</small>{key === 'prizeMoney' ? (payoutMode === 'longTerm' ? <span>{getLongTermBankForRank(totalRankByNick.get(player.nick), fantasyBankPayouts) > 0 ? <span className="bank-icon" aria-hidden="true">💰</span> : null} {formatMetricValue(getLongTermBankForRank(totalRankByNick.get(player.nick), fantasyBankPayouts), key)}</span> : <><span>{formatMetricValue(getDisplayedPrizeMoney(player, periodId, activePrizeMoneyByPeriod), key)}</span>{getLongTermBankForRank(totalRankByNick.get(player.nick), fantasyBankPayouts) > 0 ? <small>+ <span className="bank-icon" aria-hidden="true">💰</span> {formatMetricValue(getLongTermBankForRank(totalRankByNick.get(player.nick), fantasyBankPayouts), key)}</small> : null}</>) : formatMetricValue(getDisplayMetricValue(player, key, selectedRound), key)}</span>)}
                </span>
                <span className={`${metricClass(columns.at(-1)[0])} fantasy-points fantasy-cell-tipsport-rank ${columns.at(-1)[0] === 'prizeMoney' ? 'fantasy-money-cell' : ''} ${sort.key === columns.at(-1)[0] ? 'is-active-sort' : ''}`.trim()}><small className="fantasy-points-label">{metricLabel(columns.at(-1)[0], columns.at(-1)[1])}</small>{columns.at(-1)[0] === 'prizeMoney' ? (payoutMode === 'longTerm' ? <span>{getLongTermBankForRank(totalRankByNick.get(player.nick), fantasyBankPayouts) > 0 ? <span className="bank-icon" aria-hidden="true">💰</span> : null} {formatMetricValue(getLongTermBankForRank(totalRankByNick.get(player.nick), fantasyBankPayouts), 'prizeMoney')}</span> : <><span>{formatMetricValue(getDisplayedPrizeMoney(player, periodId, activePrizeMoneyByPeriod), 'prizeMoney')}</span>{getLongTermBankForRank(totalRankByNick.get(player.nick), fantasyBankPayouts) > 0 ? <small>+ <span className="bank-icon" aria-hidden="true">💰</span> {formatMetricValue(getLongTermBankForRank(totalRankByNick.get(player.nick), fantasyBankPayouts), 'prizeMoney')}</small> : null}</>) : formatMetricValue(getDisplayMetricValue(player, columns.at(-1)[0], selectedRound), columns.at(-1)[0])}</span>
              </article>
            )
          })}
        </div>
      </section>

      {isDbFantasy && fantasyData ? (
        <section className="panel long-term-bank-panel" aria-label="Banky Fantasy">
          {hasShortBank ? <article className={`long-term-bank-card ${expandedFantasyBank === 'short' ? 'is-open' : ''}`.trim()}>
            <button type="button" className="long-term-bank-toggle" aria-expanded={expandedFantasyBank === 'short'} onClick={() => setExpandedFantasyBank((current) => current === 'short' ? null : 'short')}>
              <span className="long-term-bank-toggle-label">
                <span className="bank-icon" aria-hidden="true">💰</span>
                <span>Měsíční bank</span>
              </span>
              <span className="long-term-bank-toggle-summary">
                <strong className="long-term-bank-toggle-value">{fantasyShortBankAmount.toLocaleString('cs-CZ')} Kč</strong>
                {fantasyShortBankAmount > 0 ? <small>{activeFantasyPlayers.length} × {Number(fantasyMoneyRules.entryFee).toLocaleString('cs-CZ')} Kč {entryFeeFrequency === 'monthly' ? 'měsíčně' : 'za celé období'}</small> : null}
              </span>
              <span className="long-term-bank-toggle-hint">{expandedFantasyBank === 'short' ? 'Skrýt detail' : 'Zobrazit detail'}</span>
            </button>
            {expandedFantasyBank === 'short' ? (
              <div className="long-term-bank-info">
                {payoutMode === 'period' ? <><p className="long-term-bank-summary">Vyplácené částky za období:</p><ol className="long-term-bank-payouts">
                  {fantasyShortBankPayouts.map((item) => <li key={item.place} className={`long-term-bank-place ${item.place === 1 ? 'is-exact' : item.place === 2 ? 'is-near' : 'is-win'}`}><strong>{item.place}.</strong><span className="long-term-bank-amount">{item.amount.toLocaleString('cs-CZ')} Kč</span></li>)}
                </ol></> : <p className="long-term-bank-summary">Výhry se vyplácejí až na konci turnaje z dlouhodobého banku.</p>}
                {Number(fantasyMoneyRules.longTermPool) > 0 ? <p className="long-term-bank-summary">Zbylých {(Number(fantasyMoneyRules.longTermPool) || 0).toLocaleString('cs-CZ')} Kč se převádí {longTermPoolFrequency === 'monthly' ? 'každý měsíc' : 'jednorázově za turnaj'} do dlouhodobého banku.</p> : null}
                <div className="long-term-bank-rules">
                  <h3>V případě shodného počtu bodů rozhoduje:</h3>
                  {fantasyRules.length > 0 ? <ol>{fantasyRules.map((rule) => <li key={rule}>{rule}</li>)}</ol> : <p>Pravidla zatím nejsou vyplněná.</p>}
                </div>
              </div>
            ) : null}
          </article> : null}
          <article className={`long-term-bank-card ${expandedFantasyBank === 'long' ? 'is-open' : ''}`.trim()}>
            <button type="button" className="long-term-bank-toggle" aria-expanded={expandedFantasyBank === 'long'} onClick={() => setExpandedFantasyBank((current) => current === 'long' ? null : 'long')}>
            <span className="long-term-bank-toggle-label">
              <span className="bank-icon" aria-hidden="true">💰</span>
              <span>Dlouhodobý bank</span>
            </span>
            <span className="long-term-bank-toggle-summary">
              <strong className="long-term-bank-toggle-value">{fantasyBankAmount.toLocaleString('cs-CZ')} Kč</strong>
                {fantasyBankAmount > 0 ? (
                  <small>
                    {longTermPoolFrequency === 'tournament'
                      ? `${activeFantasyPlayers.length} hráčů × ${fantasyBankContribution.toLocaleString('cs-CZ')} Kč`
                      : `${fantasyBankContribution.toLocaleString('cs-CZ')} Kč měsíčně × ${fantasyMonths} měsíců`}
                  </small>
                ) : null}
            </span>
            <span className="long-term-bank-toggle-hint">{expandedFantasyBank === 'long' ? 'Skrýt detail' : 'Zobrazit detail'}</span>
            </button>
            {expandedFantasyBank === 'long' ? (
            <div className="long-term-bank-info">
                <p className="long-term-bank-summary">Dlouhodobý bank se rozdělí takto:</p>
              <ol className="long-term-bank-payouts">
                {fantasyBankPayouts.map((item) => <li key={item.place} className={`long-term-bank-place ${item.place === 1 ? 'is-exact' : item.place === 2 ? 'is-near' : 'is-win'}`}><strong>{item.place}.</strong><span className="long-term-bank-amount">{item.amount.toLocaleString('cs-CZ')} Kč</span></li>)}
              </ol>
              <div className="long-term-bank-rules">
                <h3>V případě shodného počtu bodů rozhoduje:</h3>
                {fantasyRules.length > 0 ? <ol>{fantasyRules.map((rule) => <li key={rule}>{rule}</li>)}</ol> : <p>Pravidla zatím nejsou vyplněná.</p>}
              </div>
            </div>
            ) : null}
          </article>
        </section>
      ) : null}

      {selectedPlayer && selectedPlayerStats ? (
        <section className="panel fantasy-player-detail">
          <div className="panel-head">
            <div>
              <span className="fantasy-eyebrow">Statistiky hráče · {period.label}</span>
              <div className="fantasy-player-detail-title">
                {selectedPlayer.avatar ? <img className="user-avatar fantasy-detail-avatar" src={selectedPlayer.avatar} alt="" /> : <span className="user-avatar fantasy-detail-avatar is-placeholder" aria-hidden="true">{selectedPlayer.name.slice(0, 1).toUpperCase()}</span>}
                <h2>{selectedPlayer.name}</h2>
              </div>
            </div>
            <button type="button" className="panel-close-button" onClick={() => setSelectedPlayerNick('')} aria-label="Zavřít statistiky hráče" title="Zavřít">×</button>
          </div>
          <div className="fantasy-stat-grid">
            <div><span>Body</span><strong>{selectedPlayer.points.toLocaleString('cs-CZ')} b</strong></div>
            <div><span>Odehraná kola</span><strong>{selectedPlayerStats.rounds}</strong></div>
            <div><span>Průměr</span><strong>{selectedPlayer.average} b</strong></div>
            <div><span>Průměr za 5 kol</span><strong>{selectedPlayerStats.averageLastFive} b</strong></div>
            <div><span>Nejlepší výkon</span><strong>{selectedPlayerStats.best ?? 'N'} b</strong></div>
            <div><span>Nejhorší výkon</span><strong>{selectedPlayerStats.worst ?? 'N'} b</strong></div>
            <div><span>Netipováno</span><strong>{selectedPlayerStats.missed}×</strong></div>
            <div><span>Borec kola</span><strong>{selectedPlayerStats.awards.best}×</strong></div>
            <div><span>Kopyto kola</span><strong>{selectedPlayerStats.awards.worst}×</strong></div>
            <div><span>Nejlepší pořadí</span><strong>{selectedPlayerStats.bestRank ? `${selectedPlayerStats.bestRank}.` : 'N'}</strong></div>
          </div>
        </section>
      ) : null}

      <section className="panel rank-chart-panel fantasy-rank-chart-panel">
        <div className="panel-head">
          <div>
            <span className="fantasy-eyebrow">{statView === 'prizes' ? 'Průběžné pořadí hráčů v Tipsport Fantasy' : 'Průběžné pořadí po každém Fantasy kole'}</span>
            <h2>Vývoj pořadí · {period.label}{selectedRound ? <small className="fantasy-selected-round">vybrané kolo {formatFantasyShortDate(selectedRound[0])}</small> : null}</h2>
          </div>
          <div className="fantasy-chart-head-meta">
            {statView === 'prizes' && tipsportPlayerCount > 0 ? <span className="fantasy-chart-context">Tipsport Fantasy · {tipsportPlayerCount.toLocaleString('cs-CZ')} hráčů</span> : null}
          </div>
        </div>

        <div className="rank-chart-wrap" role="img" aria-label={`Graf vývoje ${statView === 'prizes' ? 'Tipsport' : 'Fantasy'} pořadí za ${period.label}`}>
          {(() => {
            const width = 940
            const height = 330
            const margin = { top: 16, right: 18, bottom: 38, left: 40 }
            const innerWidth = width - margin.left - margin.right
            const innerHeight = height - margin.top - margin.bottom
            const stepX = rankTimeline.rounds.length > 1 ? innerWidth / (rankTimeline.rounds.length - 1) : 0
            const tickIndexes = buildXAxisTickIndexes(rankTimeline.rounds.length, 16)
            const chartRankMax = statView === 'prizes'
              ? Math.max(1, ...rankTimeline.series.flatMap((player) => player.ranks.filter((rank) => Number.isFinite(rank))))
              : Math.max(1, activeFantasyPlayers.length)
            const rankTickValues = statView === 'prizes'
              ? [...new Set(Array.from({ length: 5 }, (_, index) => index === 0 ? 1 : Math.round((chartRankMax * index) / 4)))]
              : Array.from({ length: activeFantasyPlayers.length }, (_, index) => index + 1)
            const rankToY = (rank) => margin.top + ((rank - 1) / Math.max(1, chartRankMax - 1)) * innerHeight
            const indexToX = (index) => margin.left + index * stepX
            const visibleSeries = rankTimeline.series.filter((player) => visiblePlayerNicks.includes(player.nick))

            return (
              <svg viewBox={`0 0 ${width} ${height}`} className="rank-chart" preserveAspectRatio="xMidYMid meet">
                <rect x="0" y="0" width={width} height={height} fill="#f9fcff" />
                {rankTickValues.map((rank) => (
                  <g key={`fantasy-grid-${rank}`}>
                    <line x1={margin.left} y1={rankToY(rank)} x2={width - margin.right} y2={rankToY(rank)} className="rank-grid-line" />
                    <text x={8} y={rankToY(rank) + 4} className="rank-axis-label">{rank}.</text>
                  </g>
                ))}
                {selectedRoundIndex !== null ? (
                  <line
                    x1={indexToX(selectedRoundIndex)}
                    y1={margin.top}
                    x2={indexToX(selectedRoundIndex)}
                    y2={height - margin.bottom}
                    className="fantasy-rank-selected-round"
                  />
                ) : null}
                {rankTimeline.rounds.map((round, index) => tickIndexes.has(index) ? (
                  <text key={`fantasy-x-${round}`} x={indexToX(index)} y={height - 20} textAnchor="middle" className="rank-axis-label">{round}.</text>
                ) : null)}
                <text x={width / 2} y={height - 4} textAnchor="middle" className="rank-axis-title">{statView === 'prizes' ? 'Kolo' : 'Fantasy kolo'}</text>
                {visibleSeries.map((player) => {
                  const hasHover = Boolean(hoveredPlayerNick)
                  const isHovered = hoveredPlayerNick === player.nick
                  const rankSegments = []
                  let currentSegment = []
                  player.ranks.forEach((rank, index) => {
                    if (Number.isFinite(rank)) currentSegment.push([index, rank])
                    else if (currentSegment.length) {
                      rankSegments.push(currentSegment)
                      currentSegment = []
                    }
                  })
                  if (currentSegment.length) rankSegments.push(currentSegment)
                  return (
                    <g key={player.nick}>
                      {rankSegments.map((segment, segmentIndex) => (
                        <path
                          key={`${player.nick}-segment-${segmentIndex}`}
                          d={segment.map(([index, rank], pointIndex) => `${pointIndex === 0 ? 'M' : 'L'} ${indexToX(index)} ${rankToY(rank)}`).join(' ')}
                          stroke={player.color}
                          className={`rank-line ${hasHover && !isHovered ? 'is-dim' : ''} ${isHovered ? 'is-highlight' : ''}`.trim()}
                          onMouseEnter={() => setHoveredPlayerNick(player.nick)}
                          onMouseLeave={() => setHoveredPlayerNick('')}
                          onClick={() => setHoveredPlayerNick(player.nick)}
                        >
                          <title>{player.name}</title>
                        </path>
                      ))}
                      {player.ranks.map((rank, index) => (
                        Number.isFinite(rank) ? <circle
                          key={`${player.nick}-${index}`}
                          cx={indexToX(index)}
                          cy={rankToY(rank)}
                          r={selectedRoundIndex === index ? 5 : 2.6}
                          fill={player.color}
                          className={`rank-line-end ${hasHover && !isHovered ? 'is-dim' : ''} ${isHovered ? 'is-highlight' : ''}`.trim()}
                          onMouseEnter={() => setHoveredPlayerNick(player.nick)}
                          onMouseLeave={() => setHoveredPlayerNick('')}
                          onClick={() => setHoveredPlayerNick(player.nick)}
                        >
                          <title>{`${player.name} · ${rank}. místo · ${rankTimeline.rounds[index]}.`}</title>
                        </circle> : null
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
              key={player.nick}
              className={`rank-legend-item ${visiblePlayerNicks.includes(player.nick) ? '' : 'is-muted'} ${hoveredPlayerNick && hoveredPlayerNick !== player.nick ? 'is-dim' : ''} ${hoveredPlayerNick === player.nick ? 'is-hover' : ''}`.trim()}
              onClick={() => {
                if (touchLegendHandledRef.current) {
                  touchLegendHandledRef.current = false
                  return
                }
                togglePlayerVisibility(player.nick)
              }}
              onTouchStart={(event) => {
                event.preventDefault()
                touchLegendHandledRef.current = true
                if (hoveredPlayerNick !== player.nick) {
                  setHoveredPlayerNick(player.nick)
                  return
                }
                togglePlayerVisibility(player.nick)
                setHoveredPlayerNick('')
              }}
              onMouseEnter={() => setHoveredPlayerNick(player.nick)}
              onMouseLeave={() => setHoveredPlayerNick('')}
              onFocus={() => setHoveredPlayerNick(player.nick)}
              onBlur={() => setHoveredPlayerNick('')}
            >
              <span className="rank-legend-dot" style={{ backgroundColor: player.color }} />
              {player.name}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

export default FantasyOverview