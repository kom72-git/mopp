import { useMemo, useRef, useState } from 'react'

const chartColors = ['#2563eb', '#0ea5e9', '#14b8a6', '#eab308', '#f97316']

const fantasyPlayers = [
  { name: 'Láďa Šafařík', nick: 'joudik' },
  { name: 'Špáca', nick: 'aleprochazkova' },
  { name: 'Radek', nick: 'Libero15' },
  { name: 'Kom', nick: 'komurka72' },
  { name: 'Slanec', nick: 'Slana22' },
]

const periods = [
  { id: 'all', label: 'Celkem' },
  { id: '9', label: 'Září' },
  { id: '10', label: 'Říjen' },
  { id: '11', label: 'Listopad' },
  { id: '12', label: 'Prosinec' },
  { id: '1', label: 'Leden' },
  { id: '2', label: 'Únor' },
  { id: '3', label: 'Březen' },
]

const fantasyRounds = [
  ['9.9', [103, 79, 79, 63, 77]],
  ['10.9', [228, 142, 171, 153, 137]],
  ['12.9', [101, 105, 52, 18, 36]],
  ['14.9', [49, 58, 91, 96, 62]],
  ['16.9', [70, 37, 30, 64, 94]],
  ['17.9', [106, 112, 58, 158, 77]],
  ['19.9', [108, 88, 108, 102, 135]],
  ['21.9', [129, 48, 61, 81, 133]],
  ['23.9', [64, 158, 108, 153, 117]],
  ['25.9', [47, 55, 47, 21, 21]],
  ['26.9', [125, 119, 6, 142, 38]],
  ['28.9', [98, 71, 56, 22, 114]],
  ['30.9', [71, 91, 125, 116, 58]],
  ['3.10', [65, 68, 54, 48, 81]],
  ['5.10', [45, 64, 35, 60, 37]],
  ['8.10', [115, 89, 82, 10, 91]],
  ['10.10', [110, 140, 122, 88, 136]],
  ['12.10', [46, 50, 1, 108, 103]],
  ['15.10', [35, 80, 154, 151, 137]],
  ['16.10', [86, 84, 88, 100, 112]],
  ['17.10', [16, 0, 52, 58, 23]],
  ['19.10', [-9, 40, 126, -11, 119]],
  ['21.10', [99, 82, 81, 69, 76]],
  ['22.10', [159, 133, 49, 57, 86]],
  ['23.10', [187, 183, 181, 187, 101]],
  ['24.10', [181, 136, 180, 92, 81]],
  ['26.10', [113, 73, 86, 87, 69]],
  ['28.10', [103, 146, 69, 124, 121]],
  ['29.10', [109, 46, 52, 25, 98]],
  ['31.10', [117, 99, 175, 87, 93]],
  ['2.11', [165, 177, 71, 69, 119]],
  ['9.11', [117, 95, 76, 12, 26]],
  ['12.11', [120, 128, 87, 107, 97]],
  ['14.11', [95, 79, 58, 76, 34]],
  ['16.11', [51, 174, 110, 51, 115]],
  ['17.11', [142, 92, 94, 152, 140]],
  ['20.11', [115, 139, 98, 85, 104]],
  ['21.11', [215, 159, 131, 94, 154]],
  ['23.11', [188, 129, 129, 18, 118]],
  ['25.11', [102, 109, 136, 79, 28]],
  ['26.11', [299, 184, 124, -16, 135]],
  ['28.11', [60, 71, 46, 64, 75]],
  ['30.11', [30, 63, 32, 133, 16]],
  ['3.12', [166, 122, 74, 154, 106]],
  ['5.12', [112, 38, 93, 122, 111]],
  ['7.12', [152, 120, 54, 128, 115]],
  ['17.12', [38, 68, 55, 71, 62]],
  ['19.12', [76, 140, 118, 113, 124]],
  ['21.12', [58, 65, 128, 104, 120]],
  ['23.12', [82, 159, 78, 194, 54]],
  ['26.12', [114, 79, 130, 125, 73]],
  ['28.12', [87, 129, 102, 64, 104]],
  ['30.12', [167, 118, 68, 68, 58]],
  ['2.1', [76, 27, 37, 71, 24]],
  ['4.1', [48, 73, 140, 77, 123]],
  ['6.1', [95, 144, 132, 113, 178]],
  ['7.1', [7, 129, 62, 98, 114]],
  ['9.1', [73, 48, 54, 78, 37]],
  ['11.1', [86, 119, 64, 145, 71]],
  ['12.1', [96, 105, 100, 80, null]],
  ['13.1', [181, 162, 123, 83, 118]],
  ['15.1', [59, 46, 54, 26, 97]],
  ['16.1', [94, 97, 90, 9, 40]],
  ['18.1', [115, 143, 143, 97, 90]],
  ['20.1', [32, 78, 70, 69, 47]],
  ['21.1', [55, 93, 178, 63, 115]],
  ['23.1', [95, 72, 99, 114, 106]],
  ['25.1', [119, 116, 69, 52, 47]],
  ['26.1', [184, 157, 179, 65, 159]],
  ['27.1', [93, 146, 112, 115, 167]],
  ['29.1', [145, 97, 102, 143, 42]],
  ['30.1', [189, 156, 116, 194, 63]],
  ['1.2', [98, 116, 92, 135, 115]],
  ['2.2', [53, 72, 49, 102, 72]],
  ['22.2', [72, 72, 101, 126, null]],
  ['24.2', [97, 91, 144, 118, 76]],
  ['25.2', [127, 166, 93, 140, 94]],
  ['27.2', [100, 121, 127, 105, 77]],
  ['1.3', [75, 91, 128, 77, 120]],
  ['4.3', [138, 106, 137, 88, 84]],
  ['6.3', [78, 75, 97, 52, 53]],
]

function rankPlayers(rounds) {
  return fantasyPlayers
    .map((player, playerIndex) => {
      const scores = rounds.map((round) => round[1][playerIndex])
      const playedScores = scores.filter(Number.isFinite)
      const points = playedScores.reduce((total, score) => total + score, 0)
      return {
        ...player,
        playerIndex,
        points,
        average: rounds.length ? Math.round(points / rounds.length) : 0,
        last: scores.at(-1),
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

function FantasyOverview() {
  const [periodId, setPeriodId] = useState('all')
  const [selectedRoundIndex, setSelectedRoundIndex] = useState(null)
  const [sort, setSort] = useState({ key: 'points', direction: 'desc' })
  const [visiblePlayerNicks, setVisiblePlayerNicks] = useState(() => fantasyPlayers.map((player) => player.nick))
  const [hoveredPlayerNick, setHoveredPlayerNick] = useState('')
  const touchLegendHandledRef = useRef(false)
  const period = periods.find((item) => item.id === periodId) ?? periods[0]
  const periodRounds = useMemo(() => periodId === 'all' ? fantasyRounds : fantasyRounds.filter(([date]) => date.split('.')[1] === periodId), [periodId])
  const visibleRounds = selectedRoundIndex === null ? periodRounds : periodRounds.slice(0, selectedRoundIndex + 1)
  const standings = rankPlayers(visibleRounds)
  const previousStandings = rankPlayers(visibleRounds.slice(0, -1))
  const rankByPlayer = new Map(standings.map((player, index) => [player.name, index + 1]))
  const previousRankByPlayer = new Map(previousStandings.map((player, index) => [player.name, index + 1]))
  const selectedRound = selectedRoundIndex === null ? null : periodRounds[selectedRoundIndex]
  const displayedStandings = useMemo(() => [...standings].sort((first, second) => {
    const firstHasValue = Number.isFinite(first[sort.key])
    const secondHasValue = Number.isFinite(second[sort.key])
    if (firstHasValue !== secondHasValue) return firstHasValue ? -1 : 1
    const comparison = first[sort.key] - second[sort.key]
    if (comparison !== 0) return sort.direction === 'asc' ? comparison : -comparison
    return second.points - first.points || first.playerIndex - second.playerIndex
  }), [sort, standings])
  const rankTimeline = useMemo(() => {
    const ranksByRound = periodRounds.map((_, roundIndex) => {
      const rankedPlayers = rankPlayers(periodRounds.slice(0, roundIndex + 1))
      return new Map(rankedPlayers.map((player, rankIndex) => [player.nick, rankIndex + 1]))
    })
    return {
      rounds: periodRounds.map(([date]) => date),
      series: fantasyPlayers.map((player, playerIndex) => ({
        ...player,
        color: chartColors[playerIndex % chartColors.length],
        ranks: ranksByRound.map((rankByPlayer) => rankByPlayer.get(player.nick)),
      })),
    }
  }, [periodRounds])

  const togglePlayerVisibility = (nick) => {
    setVisiblePlayerNicks((current) => current.includes(nick) ? current.filter((item) => item !== nick) : [...current, nick])
  }

  const changeSort = (key) => {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === 'desc' ? 'asc' : 'desc' }
      : { key, direction: 'desc' })
  }

  const sortLabel = (key, label) => `${label}, ${sort.key === key ? (sort.direction === 'desc' ? 'sestupně' : 'vzestupně') : 'seřadit'}`

  return (
    <div className="fantasy-preview">
      <section className="panel fantasy-filter-panel">
        <div>
          <span className="fantasy-eyebrow">Základní část 2024/25</span>
          <h2>Fantasy liga</h2>
        </div>
        <div className="fantasy-period-tabs" role="tablist" aria-label="Vyhodnocovací období">
          {periods.map((item) => (
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
                  <span className="round-tab-label">{index + 1}. kolo</span>
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
            <span className="fantasy-eyebrow">{selectedRound ? `Průběžné pořadí po ${selectedRoundIndex + 1}. kole` : 'Konečné pořadí období'}</span>
            <h2>Pořadí · {period.label}{selectedRound ? ` · ${selectedRound[0]}.` : ''}</h2>
          </div>
          <span className="fantasy-round-count">{visibleRounds.length} kol</span>
        </div>

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

        <div className="fantasy-table-head">
          <span>#</span>
          <span>±</span>
          <span>Hráč</span>
          <button type="button" className={sort.key === 'average' ? 'is-active' : ''} aria-label={sortLabel('average', 'Průměr')} onClick={() => changeSort('average')}>Průměr<span aria-hidden="true">{sort.key === 'average' ? (sort.direction === 'desc' ? ' ↓' : ' ↑') : ''}</span></button>
          <button type="button" className={sort.key === 'last' ? 'is-active' : ''} aria-label={sortLabel('last', selectedRound ? 'V kole' : 'Poslední')} onClick={() => changeSort('last')}>{selectedRound ? 'V kole' : 'Poslední'}<span aria-hidden="true">{sort.key === 'last' ? (sort.direction === 'desc' ? ' ↓' : ' ↑') : ''}</span></button>
          <button type="button" className={sort.key === 'points' ? 'is-active' : ''} aria-label={sortLabel('points', 'Body')} onClick={() => changeSort('points')}>Body<span aria-hidden="true">{sort.key === 'points' ? (sort.direction === 'desc' ? ' ↓' : ' ↑') : ''}</span></button>
        </div>
        <div className="standings-list">
          {displayedStandings.map((player) => {
            const rank = rankByPlayer.get(player.name)
            const shift = visibleRounds.length > 1 ? (previousRankByPlayer.get(player.name) ?? rank) - rank : 0
            return (
              <article className="stand-card fantasy-table-row" key={player.name}>
                <span className={`fantasy-rank is-rank-${rank}`}>{rank}</span>
                <span className={`fantasy-rank-shift ${shift > 0 ? 'is-up' : shift < 0 ? 'is-down' : 'is-flat'}`} aria-label={shift > 0 ? `posun nahoru o ${shift}` : shift < 0 ? `posun dolů o ${Math.abs(shift)}` : 'beze změny'}>
                  {shift > 0 ? `↑${shift}` : shift < 0 ? `↓${Math.abs(shift)}` : '–'}
                </span>
                <span className="fantasy-player-name"><span>{player.name}</span><small>{player.nick}</small></span>
                <span className="fantasy-row-metrics">
                  <span className={`fantasy-cell fantasy-cell-average ${sort.key === 'average' ? 'is-active-sort' : ''}`}><small>Průměr</small>{player.average}</span>
                  <span className={`fantasy-cell fantasy-cell-last ${sort.key === 'last' ? 'is-active-sort' : ''}`}><small>{selectedRound ? 'V kole' : 'Poslední'}</small>{Number.isFinite(player.last) ? <><span>{player.last}</span><span className="fantasy-points-unit"> b</span></> : 'N'}</span>
                </span>
                <span className={`fantasy-points ${sort.key === 'points' ? 'is-active-sort' : ''}`}><span>{player.points.toLocaleString('cs-CZ')}</span><span className="fantasy-points-unit"> b</span></span>
              </article>
            )
          })}
        </div>
      </section>

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
            const rankToY = (rank) => margin.top + ((rank - 1) / Math.max(1, fantasyPlayers.length - 1)) * innerHeight
            const indexToX = (index) => margin.left + index * stepX
            const visibleSeries = rankTimeline.series.filter((player) => visiblePlayerNicks.includes(player.nick))

            return (
              <svg viewBox={`0 0 ${width} ${height}`} className="rank-chart" preserveAspectRatio="xMidYMid meet">
                <rect x="0" y="0" width={width} height={height} fill="#f9fcff" />
                {Array.from({ length: fantasyPlayers.length }, (_, index) => index + 1).map((rank) => (
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