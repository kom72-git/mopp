import { useEffect, useMemo, useState } from 'react'
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

function pointsClass(points) {
  if (points === 10) return 'tip-pill is-exact'
  if (points === 5) return 'tip-pill is-near'
  if (points === 3) return 'tip-pill is-win'
  if (points === 0) return 'tip-pill is-miss'
  return 'tip-pill is-pending'
}

function extractRound(startsAt) {
  const matched = startsAt?.match(/^(\d+)\./)
  return matched ? Number(matched[1]) : null
}

function formatRound(round) {
  return `Den ${round}`
}

function App() {
  const scoreboard = useMemo(() => [...players].sort((a, b) => b.points - a.points), [])
  const standings = useMemo(
    () => scoreboard.map((player) => ({ ...player, winnings: winningsByPlayerId[player.id] ?? 0 })),
    [scoreboard],
  )

  const rounds = useMemo(() => {
    const all = matches.map((match) => extractRound(match.startsAt)).filter((value) => value !== null)
    return [...new Set(all)].sort((a, b) => a - b)
  }, [])

  const currentRound = useMemo(() => {
    const inProgress = matches
      .filter((match) => !match.score || match.tips.some((tip) => tip.points === null))
      .map((match) => extractRound(match.startsAt))
      .filter((value) => value !== null)

    if (inProgress.length > 0) return Math.min(...inProgress)
    return rounds[rounds.length - 1] ?? 1
  }, [rounds])

  const [selectedRound, setSelectedRound] = useState(currentRound)

  const roundMatches = useMemo(
    () => matches.filter((match) => extractRound(match.startsAt) === selectedRound),
    [selectedRound],
  )

  const roundTipTotals = useMemo(() => {
    const submitted = roundMatches.reduce((acc, match) => {
      const submittedInMatch = match.tips.filter((tip) => tip.pick && tip.pick !== '-').length
      return acc + submittedInMatch
    }, 0)

    return {
      submitted,
      max: roundMatches.length * players.length,
    }
  }, [roundMatches])

  const [selectedMatchId, setSelectedMatchId] = useState(roundMatches[0]?.id ?? '')

  useEffect(() => {
    if (roundMatches.length === 0) {
      setSelectedMatchId('')
      return
    }

    const exists = roundMatches.some((match) => match.id === selectedMatchId)
    if (!exists) setSelectedMatchId(roundMatches[0].id)
  }, [roundMatches, selectedMatchId])

  const selectedMatch = useMemo(
    () => roundMatches.find((match) => match.id === selectedMatchId) ?? roundMatches[0],
    [roundMatches, selectedMatchId],
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

  return (
    <main className="layout">
      <header className="hero">
        <p className="badge">Master of PP • MOPP</p>
        <h1>Kolo na jeden pohled</h1>
        <p className="intro">
          Nejdriv vyberes kolo, pak zapas. Detail je jen jeden, takze orientace je rychla i na
          mobilu.
        </p>
      </header>

      <section className="panel controls-panel">
        <div className="panel-head">
          <h2>Vyber dne</h2>
          <span className="tag">{roundMatches.length} zapasu</span>
        </div>

        <div className="round-tabs" role="tablist" aria-label="Vyber dne">
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
          <h2>Zapasy dne</h2>
          <span className="tag">
            Tipy {roundTipTotals.submitted}/{roundTipTotals.max}
          </span>
        </div>

        <div className="day-matches-row">
          {roundMatches.map((match) => {
            const homeFlag = getFlagUrl(match.home)
            const awayFlag = getFlagUrl(match.away)
            const isActive = match.id === selectedMatch?.id
            const submittedTips = match.tips.filter((tip) => tip.pick && tip.pick !== '-').length

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
                      {homeFlag ? (
                        <img className="flag" src={homeFlag} alt={`Vlajka ${match.home}`} loading="lazy" />
                      ) : null}
                      {match.home}
                    </span>
                    <span className="team-inline">
                      {awayFlag ? (
                        <img className="flag" src={awayFlag} alt={`Vlajka ${match.away}`} loading="lazy" />
                      ) : null}
                      {match.away}
                    </span>
                  </div>

                  <div className="score-box">{match.score ?? '--:--'}</div>
                </div>

                <p className="match-item-sub">
                  Bank {match.bank} Kc • Tipy {submittedTips}/{players.length}
                </p>
              </button>
            )
          })}
        </div>
      </section>

      <section className="workspace">
        <aside className="panel match-list-panel">
          <div className="panel-head">
            <h2>Poradi hracu</h2>
            <span className="tag">{standings.length}</span>
          </div>

          <div className="standings-list">
            {standings.map((player, index) => (
              <article className="stand-card" key={player.id}>
                <p>#{index + 1}</p>
                <h3>{player.name}</h3>
                <div className="stand-metrics">
                  <strong>{player.points} b</strong>
                  <span>{player.winnings} Kc</span>
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
                    <span>{selectedMatch.home}</span>
                    <span>{selectedMatch.away}</span>
                  </div>
                  <div className="selected-score-box">{selectedMatch.score ?? '--:--'}</div>
                </div>
                <p className="selected-match-bank">Bank {selectedMatch.bank} Kč</p>
              </header>

              <div className="tips-table" role="table" aria-label="Tipy hráčů">
                <div className="tips-head" role="row">
                  <span>#</span>
                  <span>Hráč</span>
                  <span>Tip</span>
                  <span>Body</span>
                </div>

                {selectedMatchTips.map((tip) => (
                  <div className="tips-row" role="row" key={`${selectedMatch.id}-${tip.playerId}`}>
                    <span className="rank-cell">#{tip.rank}</span>
                    <span className="name-cell">{tip.playerName}</span>
                    <strong className="tip-value">{tip.pick}</strong>
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

    </main>
  )
}

export default App
