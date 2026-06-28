import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { matches, players } from './data/moppData'
import { getFlagUrl } from './data/countryFlags'

const winningsByPlayerId = {
  p1: 330,
  p2: 478,
  p3: 0,
  p4: 55,
  p5: 558,
  p6: 366,
  p7: 118,
  p8: 672,
  p9: 357,
  p10: 220,
  p11: 366,
}

const chartColors = ['#2563eb', '#0ea5e9', '#06b6d4', '#14b8a6', '#22c55e', '#84cc16', '#eab308', '#f59e0b', '#f97316', '#a855f7', '#ec4899']

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

function formatRound(round) {
  return `${round}. den`
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

function getStageLabel(startsAt) {
  const date = parseMatchDate(startsAt)
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

async function fetchSyncStatus() {
  const response = await fetch(`/sync-status.json?t=${Date.now()}`, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error('Sync status není dostupný')
  }

  return response.json()
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

function App() {
  const deployHookUrl = import.meta.env.VITE_VERCEL_DEPLOY_HOOK
  const tooltipTimerRef = useRef(null)
  const scoreboard = useMemo(() => [...players].sort((a, b) => b.points - a.points), [])
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
          winnings: winningsByPlayerId[player.id] ?? 0,
          stats,
        }
      }),
    [scoreboard],
  )

  const rounds = useMemo(() => {
    const all = matches.map((match) => extractRound(match)).filter((value) => value !== null)
    return [...new Set(all)].sort((a, b) => a - b)
  }, [])

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
  }, [rounds, scoreboard])

  const currentRound = useMemo(() => {
    const inProgress = matches
      .filter((match) => !match.score || match.tips.some((tip) => tip.points === null))
      .map((match) => extractRound(match))
      .filter((value) => value !== null)

    if (inProgress.length > 0) return Math.min(...inProgress)
    return rounds[rounds.length - 1] ?? 1
  }, [rounds])

  const [selectedRound, setSelectedRound] = useState(currentRound)
  const [visiblePlayerIds, setVisiblePlayerIds] = useState(() => scoreboard.map((player) => player.id))

  useEffect(() => {
    const ids = scoreboard.map((player) => player.id)
    setVisiblePlayerIds((prev) => {
      const kept = prev.filter((id) => ids.includes(id))
      const missing = ids.filter((id) => !kept.includes(id))
      return [...kept, ...missing]
    })
  }, [scoreboard])

  const togglePlayerVisibility = (playerId) => {
    setVisiblePlayerIds((prev) =>
      prev.includes(playerId) ? prev.filter((id) => id !== playerId) : [...prev, playerId],
    )
  }

  const roundMatches = useMemo(
    () => matches.filter((match) => extractRound(match) === selectedRound),
    [selectedRound],
  )

  const stageLabel = useMemo(() => {
    const firstMatch = roundMatches[0]
    return getStageLabel(firstMatch?.startsAt)
  }, [roundMatches])

  const roundDateLabel = useMemo(() => {
    const dates = [...new Set(roundMatches.map((match) => extractCalendarDate(match.startsAt)).filter(Boolean))]
    if (dates.length === 0) return ''
    if (dates.length === 1) return dates[0]
    return `${dates[0]}–${dates[dates.length - 1]}`
  }, [roundMatches])

  const [selectedMatchId, setSelectedMatchId] = useState(roundMatches[0]?.id ?? '')

  const effectiveSelectedMatchId = useMemo(() => {
    if (roundMatches.length === 0) return ''
    const exists = roundMatches.some((match) => match.id === selectedMatchId)
    return exists ? selectedMatchId : roundMatches[0].id
  }, [roundMatches, selectedMatchId])

  const selectedMatch = useMemo(
    () => roundMatches.find((match) => match.id === effectiveSelectedMatchId) ?? roundMatches[0],
    [roundMatches, effectiveSelectedMatchId],
  )

  const selectedMatchTips = useMemo(() => {
    if (!selectedMatch) return []

    return selectedMatch.tips
      .map((tip) => {
        const player = players.find((item) => item.id === tip.playerId)
        const rank = scoreboard.findIndex((item) => item.id === tip.playerId) + 1
        return {
          ...tip,
          playerName: player?.name ?? tip.playerId,
          rank,
        }
      })
      .sort((a, b) => a.rank - b.rank)
  }, [selectedMatch, scoreboard])

  const [syncMessage, setSyncMessage] = useState('')
  const [showSyncTooltip, setShowSyncTooltip] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const isProductionBuild = import.meta.env.PROD
  const canTriggerDeploy = isProductionBuild && Boolean(deployHookUrl)
  const syncPollTimerRef = useRef(null)

  useEffect(() => {
    return () => {
      if (tooltipTimerRef.current) {
        clearTimeout(tooltipTimerRef.current)
      }

      if (syncPollTimerRef.current) {
        clearTimeout(syncPollTimerRef.current)
      }
    }
  }, [])

  const showTooltip = (message) => {
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current)
    }
    setSyncMessage(message)
    setShowSyncTooltip(true)
    tooltipTimerRef.current = setTimeout(() => {
      setShowSyncTooltip(false)
      tooltipTimerRef.current = null
    }, 3200)
  }

  const waitForFreshProductionData = async (previousSignature, attemptsLeft = 18) => {
    if (attemptsLeft <= 0) {
      showTooltip('Redeploy běží, ale nové nasazení ještě není online. Obnov stránku za chvíli ručně.')
      return
    }

    syncPollTimerRef.current = setTimeout(async () => {
      try {
        const status = await fetchSyncStatus()
        if (status?.signature && status.signature !== previousSignature) {
          showTooltip('Nový deploy je online. Načítám aktuální data...')
          setTimeout(() => {
            window.location.reload()
          }, 800)
          return
        }
      } catch {
        // Pokracujeme dal, produkcni deploy muze byt zrovna v prepinani verze.
      }

      waitForFreshProductionData(previousSignature, attemptsLeft - 1)
    }, 10000)
  }

  const handleLogoClick = async (event) => {
    if (event.detail < 3 || isSyncing) return

    setIsSyncing(true)
    showTooltip('Synchronizace s Google tabulkou...')

    try {
      if (canTriggerDeploy) {
        const currentStatus = await fetchSyncStatus().catch(() => null)
        const hookResponse = await fetch(deployHookUrl, { method: 'POST' })
        if (!hookResponse.ok) {
          throw new Error('Deploy hook selhal')
        }

        showTooltip('Spuštěn redeploy na Vercelu. Čekám na nové nasazení s čerstvými daty...')
        waitForFreshProductionData(currentStatus?.signature ?? null)
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
        showTooltip(payload.message || 'Synchronizace dokončena')
        setTimeout(() => {
          window.location.reload()
        }, 700)
      }
    } catch {
      showTooltip(
        isProductionBuild
          ? 'Na Vercelu nastav Deploy Hook. Runtime sync tam data do už hotového buildu nezapíše.'
          : 'API není dostupné. Lokálně spusť: npm run dev:api.'
      )
    } finally {
      setIsSyncing(false)
    }
  }

  return (
    <main className="layout">
      <header className="hero">
        <div className="hero-content">
          <h1>MS ve fotbale 2026</h1>
          <p className="intro">
            <span>tipovací soutěž</span>
            <span className="intro-sep" aria-hidden="true">
              –
            </span>
            <span>Master of PP</span>
          </p>
        </div>

        <figure className="hero-logo-wrap">
          <button type="button" className="hero-logo-button" onClick={handleLogoClick}>
            <img
              className="hero-logo"
              src="/fifa-world-cup-2026-logo.svg"
              alt="Autor: FIFA – Tento soubor byl odvozen z: World-g89b177785 1280.png:Tento soubor byl odvozen z: 2026 FIFA World Cup emblem (without trophy).svg:Tento soubor byl odvozen z: FIFA World Cup 2026 (Wordmark).svg:, Volné dílo, https://commons.wikimedia.org/w/index.php?curid=188361756"
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
          <h2>{stageLabel} · {formatRound(selectedRound)}</h2>
        </div>

        <div className="round-tabs" role="tablist" aria-label="Výběr dne">
          {rounds.map((round) => {
            const timeClass =
              round < currentRound ? 'is-past' : round > currentRound ? 'is-future' : 'is-current'
            const activeClass = round === selectedRound ? 'is-active' : ''

            return (
              <button
                key={round}
                type="button"
                className={`round-tab ${timeClass} ${activeClass}`.trim()}
                onClick={() => setSelectedRound(round)}
              >
                {formatRound(round)}
              </button>
            )
          })}
        </div>
      </section>

      <section className="panel day-matches-panel">
        <div className="panel-head">
          <h2>Zápasy dne</h2>
          {roundDateLabel ? <span className="tag">{roundDateLabel}</span> : null}
        </div>

        <div className="day-matches-row">
          {roundMatches.map((match) => {
            const homeFlag = getFlagUrl(match.home)
            const awayFlag = getFlagUrl(match.away)
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
                <p className="match-item-top">{match.startsAt}</p>

                <div className="match-item-main">
                  <div className="teams-stack">
                    <span className="team-inline">
                      <span className="team-left">
                        {homeFlag ? (
                          <img className="flag" src={homeFlag} alt={`Vlajka ${match.home}`} loading="lazy" />
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
                          <img className="flag" src={awayFlag} alt={`Vlajka ${match.away}`} loading="lazy" />
                        ) : null}
                        {match.away}
                      </span>
                      <strong className={`team-goals ${score.winner === 'away' ? 'is-winner' : ''}`}>
                        {score.away ?? '-'}
                      </strong>
                    </span>
                  </div>
                </div>

                <p className="match-item-sub">
                  Bank {match.bank} Kč • Tipy {submittedTips}/{players.length}
                </p>
              </button>
            )
          })}
        </div>
      </section>

      <section className="workspace">
        <aside className="panel match-list-panel">
          <div className="panel-head">
            <h2>Pořadí hráčů</h2>
          </div>

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
                <p className="selected-match-time">{selectedMatch.startsAt}</p>
                <div className="selected-match-main">
                  <div className="selected-teams-stack">
                    {(() => {
                      const homeFlag = getFlagUrl(selectedMatch.home)
                      const awayFlag = getFlagUrl(selectedMatch.away)
                      const score = parseScore(selectedMatch.score)

                      return (
                        <>
                          <span className="team-inline">
                            <span className="team-left">
                              {homeFlag ? (
                                <img
                                  className="flag"
                                  src={homeFlag}
                                  alt={`Vlajka ${selectedMatch.home}`}
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
                                  className="flag"
                                  src={awayFlag}
                                  alt={`Vlajka ${selectedMatch.away}`}
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
                  <span>Hráč</span>
                  <span>Tip</span>
                  <span>Body</span>
                </div>

                {selectedMatchTips.map((tip) => (
                  <div className="tips-row" role="row" key={`${selectedMatch.id}-${tip.playerId}`}>
                    <span className="name-cell">{tip.playerName}</span>
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
                const visibleSeries = rankTimeline.series.filter((player) => visiblePlayerIds.includes(player.id))

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
                      const path = player.ranks
                        .map((rank, index) => `${index === 0 ? 'M' : 'L'} ${indexToX(index)} ${rankToY(rank)}`)
                        .join(' ')

                      return (
                        <g key={player.id}>
                          <path d={path} stroke={player.color} className="rank-line" />
                          {player.ranks.map((rank, index) => (
                            <circle
                              key={`${player.id}-pt-${index}`}
                              cx={indexToX(index)}
                              cy={rankToY(rank)}
                              r="2.6"
                              fill={player.color}
                              className="rank-line-end"
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
                  className={`rank-legend-item ${visiblePlayerIds.includes(player.id) ? '' : 'is-muted'}`.trim()}
                  key={`legend-${player.id}`}
                  onClick={() => togglePlayerVisibility(player.id)}
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
