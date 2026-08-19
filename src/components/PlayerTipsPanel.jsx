import { useEffect, useMemo, useState } from 'react'

function formatMatchDateTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function buildMatchGroups(matches) {
  const groups = new Map()
  for (const match of matches) {
    const key = Number.isFinite(Number(match.round)) ? `round-${match.round}` : String(match.startsAt).slice(0, 10)
    if (!groups.has(key)) groups.set(key, { key, round: match.round, matches: [] })
    groups.get(key).matches.push(match)
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      matches: [...group.matches].sort((a, b) => {
        const startsAtDiff = String(a.startsAt).localeCompare(String(b.startsAt))
        if (startsAtDiff !== 0) return startsAtDiff
        return String(a._id).localeCompare(String(b._id))
      }),
    }))
    .sort((a, b) => {
      const roundA = Number(a.round)
      const roundB = Number(b.round)
      const hasRoundA = Number.isFinite(roundA)
      const hasRoundB = Number.isFinite(roundB)
      if (hasRoundA && hasRoundB && roundA !== roundB) return roundA - roundB
      if (hasRoundA !== hasRoundB) return hasRoundA ? -1 : 1
      return String(a.matches[0]?.startsAt ?? '').localeCompare(String(b.matches[0]?.startsAt ?? ''))
    })
}

export default function PlayerTipsPanel({ onTipUpdated }) {
  const [matches, setMatches] = useState([])
  const [values, setValues] = useState({})
  const [message, setMessage] = useState('')
  const [tipMessages, setTipMessages] = useState({})
  const [busyMatchId, setBusyMatchId] = useState('')
  const [activeGroupIndex, setActiveGroupIndex] = useState(null)
  const [tipViewMode, setTipViewMode] = useState('group')

  useEffect(() => {
    let cancelled = false
    fetch('/api/player/matches', { credentials: 'include' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.message || 'Zápasy se nepodařilo načíst')
        return payload
      })
      .then((payload) => {
        if (cancelled) return
        const loadedMatches = payload.matches ?? []
        setMatches(loadedMatches)
        setValues(Object.fromEntries(loadedMatches.map((match) => [match._id, {
          homeScore: match.tip?.homeScore ?? '',
          awayScore: match.tip?.awayScore ?? '',
        }])))
        // Vychází se z aktuálního kola jen jednou při načtení, aby se pohled během editace sám nepřepnul jinam.
        const loadedGroups = buildMatchGroups(loadedMatches)
        const initialIndex = loadedGroups.findIndex((group) => group.matches.some((match) => new Date(match.startsAt).getTime() > Date.now()))
        setActiveGroupIndex(initialIndex >= 0 ? initialIndex : Math.max(0, loadedGroups.length - 1))
      })
      .catch((error) => {
        if (!cancelled) setMessage(error.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const updateScore = (matchId, field, value) => {
    setValues((current) => ({ ...current, [matchId]: { ...current[matchId], [field]: value } }))
  }

  const setTipMessage = (matchId, text, isError) => {
    setTipMessages((current) => ({ ...current, [matchId]: { text, isError } }))
    window.setTimeout(() => {
      setTipMessages((current) => (current[matchId]?.text === text ? { ...current, [matchId]: null } : current))
    }, 4000)
  }

  const saveTip = async (matchId) => {
    setBusyMatchId(matchId)
    setTipMessages((current) => ({ ...current, [matchId]: null }))
    const startedAt = Date.now()
    const minBusyMs = 400
    try {
      const response = await fetch(`/api/player/tips/${matchId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(values[matchId]),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Tip se nepodařilo uložit')
      onTipUpdated?.(payload.tip)
    } catch (error) {
      setTipMessage(matchId, error.message, true)
    } finally {
      const elapsed = Date.now() - startedAt
      if (elapsed < minBusyMs) await new Promise((resolve) => window.setTimeout(resolve, minBusyMs - elapsed))
      setBusyMatchId('')
    }
  }

  const matchGroups = useMemo(() => buildMatchGroups(matches), [matches])

  const resolvedGroupIndex = Math.min(Math.max(0, activeGroupIndex ?? 0), Math.max(0, matchGroups.length - 1))

  const activeGroup = matchGroups[resolvedGroupIndex]
  const tippedMatchCount = matches.filter((match) => match.tip !== null).length
  const displayedGroups = tipViewMode === 'all'
    ? matchGroups
    : activeGroup
      ? [activeGroup]
      : []

  return (
    <section className="player-tips-panel" aria-label="Moje tipy">
      <div className="player-tips-heading">
        <h2>Moje tipy</h2>
        <span>{tippedMatchCount}/{matches.length} tipů</span>
      </div>
      {message ? <p className="player-tips-message" role="alert">{message}</p> : null}
      {matches.length === 0 ? (
        <p className="player-tips-message">Zatím nejsou otevřené zápasy k tipování.</p>
      ) : (
        <>
          <div className="player-tips-navigation">
            <button type="button" className="auth-button" onClick={() => setActiveGroupIndex(Math.max(0, resolvedGroupIndex - 1))} disabled={tipViewMode === 'all' || resolvedGroupIndex === 0}>Předchozí</button>
            <select
              value={tipViewMode === 'all' ? 'all' : resolvedGroupIndex}
              onChange={(event) => {
                if (event.target.value === 'all') {
                  setTipViewMode('all')
                  return
                }
                setTipViewMode('group')
                setActiveGroupIndex(Number(event.target.value))
              }}
              aria-label="Vyber rozsah tipování"
            >
              <option value="all">Všechny otevřené</option>
              {matchGroups.map((group, index) => <option key={group.key} value={index}>{group.round ? `${group.round}. kolo` : `${index + 1}. skupina`}</option>)}
            </select>
            <button type="button" className="auth-button" onClick={() => setActiveGroupIndex(Math.min(matchGroups.length - 1, resolvedGroupIndex + 1))} disabled={tipViewMode === 'all' || resolvedGroupIndex === matchGroups.length - 1}>Další</button>
          </div>
          {displayedGroups.map((group) => (
            <div className="player-tip-group" key={group.key}>
              {tipViewMode === 'all' ? <h3>{group.round ? `${group.round}. kolo` : 'Skupina'}</h3> : null}
              {group.matches.map((match) => (
                <div className="player-tip-row" key={match._id}>
                  <div>
                    <strong>{formatMatchDateTime(match.startsAt)}</strong>
                    <span>{match.home} – {match.away} · Bank {match.bank} Kč</span>
                  </div>
                  <div className="player-tip-score">
                    <input type="number" min="0" max="99" value={values[match._id]?.homeScore ?? ''} onChange={(event) => updateScore(match._id, 'homeScore', event.target.value)} aria-label={`Tip domácího týmu ${match.home}`} />
                    <span>:</span>
                    <input type="number" min="0" max="99" value={values[match._id]?.awayScore ?? ''} onChange={(event) => updateScore(match._id, 'awayScore', event.target.value)} aria-label={`Tip hostujícího týmu ${match.away}`} />
                    <button type="button" className="auth-submit" onClick={() => saveTip(match._id)} disabled={busyMatchId === match._id}>{busyMatchId === match._id ? 'Ukládám…' : 'Uložit tip'}</button>
                  </div>
                  {tipMessages[match._id] ? <p className={`player-tip-row-message${tipMessages[match._id].isError ? ' is-error' : ' is-success'}`} role="alert">{tipMessages[match._id].text}</p> : null}
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </section>
  )
}
