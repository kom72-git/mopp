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
  const periodStats = tipsportStatsByPeriod[periodId]?.[player.nick] ?? {}
  return {
    ...seasonStats[player.nick],
    ...periodStats,
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

function getDisplayedPrizeMoney(player, periodId) {
  return Number(player.prizeMoney) || 0
}

function formatFantasyDate(date) {
  if (!date) return ''
  const [day, month] = String(date).split('.')
  return `${Number(day)}.${Number(month)}.2026`
}

function FantasyOverview({ selectedTournamentId = '', refreshKey = 0 }) {
  const [fantasyData, setFantasyData] = useState(null)
  const [periodId, setPeriodId] = useState('all')
  const [selectedRoundIndex, setSelectedRoundIndex] = useState(null)
  const [sort, setSort] = useState({ key: 'points', direction: 'desc' })
  const [statView, setStatView] = useState('standings')
  const [selectedPlayerNick, setSelectedPlayerNick] = useState('')
  const [visiblePlayerNicks, setVisiblePlayerNicks] = useState(() => fantasyPlayers.map((player) => player.nick))
  const [hoveredPlayerNick, setHoveredPlayerNick] = useState('')
  const touchLegendHandledRef = useRef(false)
  const activeFantasyPlayers = fantasyData?.players ?? fantasyPlayers
  const activePeriodsRaw = fantasyData?.periods?.length ? fantasyData.periods : periods
  const activeFantasyRounds = fantasyData?.rounds ?? fantasyRounds
  const activeSeasonStats = fantasyData?.seasonStats ?? fantasySeasonStats
  const activePrizeMoneyByPeriod = fantasyData?.prizeMoneyByPeriod ?? fantasyPrizeMoneyByPeriod
  const activeLongTermBankByPeriod = fantasyData?.longTermBankByPeriod ?? fantasyLongTermBankByPeriod
  const activeTipsportStatsByPeriod = fantasyData?.tipsportStatsByPeriod ?? {}
  const fantasyPeriodRankLabel = fantasyData?.fantasyPeriodRankLabel ?? 'Měsíční'
  const activePeriods = activePeriodsRaw.filter((item) => item.id === 'all' || activeFantasyRounds.some(([date]) => item.months?.includes(date.split('.')[1])))
  const period = activePeriods.find((item) => item.id === periodId) ?? activePeriods[0]
  const periodRounds = useMemo(() => periodId === 'all' ? activeFantasyRounds : activeFantasyRounds.filter(([date]) => period.months.includes(date.split('.')[1])), [activeFantasyRounds, period, periodId])
  const visibleRounds = selectedRoundIndex === null ? periodRounds : periodRounds.slice(0, selectedRoundIndex + 1)
  const selectedRound = selectedRoundIndex === null ? null : periodRounds[selectedRoundIndex]
  const selectedTournamentRoundIndex = selectedRound ? activeFantasyRounds.indexOf(selectedRound) : activeFantasyRounds.indexOf(visibleRounds.at(-1))
  const lastRound = selectedRound ?? (periodId === 'all' ? visibleRounds.at(-1) : visibleRounds.at(-2))
  const standings = rankPlayers(activeFantasyPlayers, visibleRounds, lastRound)
  const previousStandings = rankPlayers(activeFantasyPlayers, visibleRounds.slice(0, -1))
  const rankByPlayer = new Map(standings.map((player, index) => [player.name, index + 1]))
  const previousRankByPlayer = new Map(previousStandings.map((player, index) => [player.name, index + 1]))
  useEffect(() => {
    setFantasyData(null)
    if (!selectedTournamentId?.startsWith('db:')) return
    let cancelled = false
    fetch(`/api/fantasy/data?tournamentId=${encodeURIComponent(selectedTournamentId)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!cancelled && payload?.ok) setFantasyData(payload)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [refreshKey, selectedTournamentId])
  const standingsWithStats = useMemo(() => standings.map((player) => ({ ...player, ...getPlayerStats(visibleRounds, player, periodId, activeSeasonStats, activePrizeMoneyByPeriod, activeLongTermBankByPeriod, activeTipsportStatsByPeriod) })), [activeLongTermBankByPeriod, activePrizeMoneyByPeriod, activeSeasonStats, activeTipsportStatsByPeriod, periodId, standings, visibleRounds])
  const displayedStandings = useMemo(() => [...standingsWithStats].sort((first, second) => {
    const firstValue = sort.key === 'prizeMoney' ? getDisplayedPrizeMoney(first, periodId) : getMetricValue(first, sort.key)
    const secondValue = sort.key === 'prizeMoney' ? getDisplayedPrizeMoney(second, periodId) : getMetricValue(second, sort.key)
    const firstHasValue = Number.isFinite(firstValue)
    const secondHasValue = Number.isFinite(secondValue)
    if (firstHasValue !== secondHasValue) return firstHasValue ? -1 : 1
    const comparison = firstValue - secondValue
    if (comparison !== 0) return sort.direction === 'asc' ? comparison : -comparison
    return second.points - first.points || first.playerIndex - second.playerIndex
  }), [sort, standingsWithStats])
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
    const ranksByRound = periodRounds.map((_, roundIndex) => {
      const rankedPlayers = rankPlayers(activeFantasyPlayers, periodRounds.slice(0, roundIndex + 1))
      return new Map(rankedPlayers.map((player, rankIndex) => [player.nick, rankIndex + 1]))
    })
    return {
      rounds: periodRounds.map(([date]) => date),
      series: activeFantasyPlayers.map((player, playerIndex) => ({
        ...player,
        color: chartColors[playerIndex % chartColors.length],
        ranks: ranksByRound.map((rankByPlayer) => rankByPlayer.get(player.nick)),
      })),
    }
  }, [activeFantasyPlayers, periodRounds])

  const togglePlayerVisibility = (nick) => {
    setVisiblePlayerNicks((current) => current.includes(nick) ? current.filter((item) => item !== nick) : [...current, nick])
  }

  const changeSort = (key) => {
    const defaultDirection = key.includes('Rank') ? 'asc' : 'desc'
    setSort((current) => current.key === key
      ? { key, direction: current.direction === 'desc' ? 'asc' : 'desc' }
      : { key, direction: defaultDirection })
  }

  const sortLabel = (key, label) => `${label}, ${sort.key === key ? (sort.direction === 'desc' ? 'sestupně' : 'vzestupně') : 'seřadit'}`
  const statViews = {
    standings: [['average', 'Průměr'], ['averageLastFive', 'Forma 5'], ['points', 'Body']],
    performance: [['bestScore', 'Nejlepší'], ['worstScore', 'Nejhorší'], ['last', selectedRound ? 'V kole' : 'Poslední']],
    awards: [['awards.best', 'Borec kola'], ['awards.worst', 'Kopyto kola'], ['missed', 'Netipováno']],
    prizes: [['bestDailyRank', 'NEJ denní'], ['bestPeriodRank', `NEJ ${fantasyPeriodRankLabel.toLowerCase()}`], ['fantasyNets', 'Nety'], ['prizeMoney', 'Peníze']],
  }
  const columns = statViews[statView]

  return (
    <div className="fantasy-preview">
      <section className="panel fantasy-filter-panel">
        <div>
          <span className="fantasy-eyebrow">Základní část 2024/25</span>
          <h2>Fantasy liga</h2>
        </div>
        <div className="fantasy-period-tabs" role="tablist" aria-label="Vyhodnocovací období">
          {activePeriods.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={item.id === periodId} className={`player-window-tab ${item.id === periodId ? 'is-active' : ''}`} onClick={() => {
              setPeriodId(item.id)
              setSelectedRoundIndex(null)
              setSort({ key: 'points', direction: 'desc' })
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
                setSort({ key: 'points', direction: 'desc' })
              }}>
                <span className="round-tab-label">Souhrn</span>
                <small>celý měsíc</small>
              </button>
              {periodRounds.map(([date], index) => (
                <button key={date} type="button" role="tab" aria-selected={selectedRoundIndex === index} className={`round-tab ${selectedRoundIndex === index ? 'is-active' : 'is-past'}`} onClick={() => {
                  setSelectedRoundIndex(index)
                  setSort({ key: 'points', direction: 'desc' })
                }}>
                  <span className="round-tab-label">{activeFantasyRounds.indexOf(periodRounds[index]) + 1}. kolo</span>
                  <small>{date}.</small>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="panel fantasy-one-table">
        <div className="panel-head">
          <div>
            <span className="fantasy-eyebrow">{periodId === 'all' ? 'Celkové pořadí turnaje' : selectedRound ? `Průběžné pořadí po ${selectedTournamentRoundIndex + 1}. kole turnaje` : 'Konečné pořadí období'}</span>
            <h2>{selectedRound ? formatFantasyDate(selectedRound[0]) : `Pořadí · ${period.label}`}</h2>
          </div>
          <span className="fantasy-round-count">{visibleRounds.length} kol</span>
        </div>

        {activeFantasyPlayers.length === 0 || activeFantasyRounds.length === 0 ? <p className="fantasy-detail-hint">Fantasy turnaj zatím nemá uložené hráče nebo kola.</p> : null}

        <div className="fantasy-mobile-sort" role="group" aria-label="Řazení pořadí">
          <span>Řadit:</span>
          {[
            ['average', 'Průměr'],
            ['last', selectedRound ? 'V kole' : 'Poslední'],
            ['points', 'Body'],
          ].map(([key, label]) => (
            <button key={key} type="button" className={`player-window-tab ${sort.key === key ? 'is-active' : ''}`} onClick={() => changeSort(key)}>
              {label}{sort.key === key ? (sort.direction === 'desc' ? ' ↓' : ' ↑') : ''}
            </button>
          ))}
        </div>

        <div className="fantasy-stat-view" role="tablist" aria-label="Porovnání hráčů">
          {[['standings', 'Pořadí'], ['performance', 'Výkon'], ['awards', 'Ocenění'], ['prizes', 'Umístění/výhry']].map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={statView === key} className={`player-window-tab ${statView === key ? 'is-active' : ''}`} onClick={() => {
              setStatView(key)
              setSort({ key: statViews[key][0][0], direction: statViews[key][0][0].includes('Rank') ? 'asc' : 'desc' })
            }}>{label}</button>
          ))}
        </div>

        <div className={`fantasy-table-head ${columns.length === 4 ? 'is-wide' : ''}`}>
          <span>#</span>
          <span>±</span>
          <span>Hráč</span>
          {columns.map(([key, label]) => <button key={key} type="button" className={sort.key === key ? 'is-active' : ''} aria-label={sortLabel(key, label)} onClick={() => changeSort(key)}>{label}<span aria-hidden="true">{sort.key === key ? (sort.direction === 'desc' ? ' ↓' : ' ↑') : ''}</span></button>)}
        </div>
        <div className="standings-list">
          {displayedStandings.map((player) => {
            const rank = rankByPlayer.get(player.name)
            const shift = visibleRounds.length > 1 ? (previousRankByPlayer.get(player.name) ?? rank) - rank : 0
            return (
              <article className={`stand-card fantasy-table-row ${columns.length === 4 ? 'is-wide' : ''} ${selectedPlayerNick === player.nick ? 'is-selected' : ''}`} key={player.name} role="button" tabIndex={0} onClick={() => setSelectedPlayerNick(player.nick)} onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') setSelectedPlayerNick(player.nick)
              }}>
                <span className={`fantasy-rank is-rank-${rank}`}>{rank}</span>
                <span className={`fantasy-rank-shift ${shift > 0 ? 'is-up' : shift < 0 ? 'is-down' : 'is-flat'}`} aria-label={shift > 0 ? `posun nahoru o ${shift}` : shift < 0 ? `posun dolů o ${Math.abs(shift)}` : 'beze změny'}>
                  {shift > 0 ? `↑${shift}` : shift < 0 ? `↓${Math.abs(shift)}` : '–'}
                </span>
                <span className="fantasy-player-name"><span>{player.name}</span><small>{player.nick}</small></span>
                <span className="fantasy-row-metrics">
                  {columns.slice(0, -1).map(([key, label]) => <span key={key} className={`fantasy-cell ${sort.key === key ? 'is-active-sort' : ''}`}><small>{label}</small>{formatMetricValue(getDisplayMetricValue(player, key, selectedRound), key)}</span>)}
                </span>
                <span className={`fantasy-points ${columns.at(-1)[0] === 'prizeMoney' ? 'fantasy-money-cell' : ''} ${sort.key === columns.at(-1)[0] ? 'is-active-sort' : ''}`.trim()}>{columns.at(-1)[0] === 'prizeMoney' ? <><span>{formatMetricValue(getDisplayedPrizeMoney(player, periodId), 'prizeMoney')}</span>{periodId === 'all' && player.longTermBank > 0 ? <small>+ <span className="bank-icon" aria-hidden="true">💰</span> {formatMetricValue(player.longTermBank, 'prizeMoney')}</small> : null}</> : formatMetricValue(getDisplayMetricValue(player, columns.at(-1)[0], selectedRound), columns.at(-1)[0])}</span>
              </article>
            )
          })}
        </div>
      </section>

      {selectedPlayer && selectedPlayerStats ? (
        <section className="panel fantasy-player-detail">
          <div className="panel-head">
            <div>
              <span className="fantasy-eyebrow">Statistiky hráče · {period.label}</span>
              <h2>{selectedPlayer.name}</h2>
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
            <span className="fantasy-eyebrow">Průběžné pořadí po každém Fantasy kole</span>
            <h2>Vývoj pořadí · {period.label}</h2>
          </div>
          {selectedRound ? <span className="fantasy-round-count">Vybráno {selectedRound[0]}.</span> : null}
        </div>

        <div className="rank-chart-wrap" role="img" aria-label={`Graf vývoje Fantasy pořadí za ${period.label}`}>
          {(() => {
            const width = 940
            const height = 330
            const margin = { top: 16, right: 18, bottom: 38, left: 40 }
            const innerWidth = width - margin.left - margin.right
            const innerHeight = height - margin.top - margin.bottom
            const stepX = rankTimeline.rounds.length > 1 ? innerWidth / (rankTimeline.rounds.length - 1) : 0
            const tickIndexes = buildXAxisTickIndexes(rankTimeline.rounds.length, 16)
            const rankToY = (rank) => margin.top + ((rank - 1) / Math.max(1, activeFantasyPlayers.length - 1)) * innerHeight
            const indexToX = (index) => margin.left + index * stepX
            const visibleSeries = rankTimeline.series.filter((player) => visiblePlayerNicks.includes(player.nick))

            return (
              <svg viewBox={`0 0 ${width} ${height}`} className="rank-chart" preserveAspectRatio="xMidYMid meet">
                <rect x="0" y="0" width={width} height={height} fill="#f9fcff" />
                {Array.from({ length: activeFantasyPlayers.length }, (_, index) => index + 1).map((rank) => (
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
                <text x={width / 2} y={height - 4} textAnchor="middle" className="rank-axis-title">Fantasy kolo</text>
                {visibleSeries.map((player) => {
                  const hasHover = Boolean(hoveredPlayerNick)
                  const isHovered = hoveredPlayerNick === player.nick
                  const path = player.ranks.map((rank, index) => `${index === 0 ? 'M' : 'L'} ${indexToX(index)} ${rankToY(rank)}`).join(' ')
                  return (
                    <g key={player.nick}>
                      <path
                        d={path}
                        stroke={player.color}
                        className={`rank-line ${hasHover && !isHovered ? 'is-dim' : ''} ${isHovered ? 'is-highlight' : ''}`.trim()}
                        onMouseEnter={() => setHoveredPlayerNick(player.nick)}
                        onMouseLeave={() => setHoveredPlayerNick('')}
                        onClick={() => setHoveredPlayerNick(player.nick)}
                      >
                        <title>{player.name}</title>
                      </path>
                      {player.ranks.map((rank, index) => (
                        <circle
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
                        </circle>
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