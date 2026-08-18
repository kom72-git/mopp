import { useEffect, useState } from 'react'

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

export default function PlayerTipsPanel() {
  const [matches, setMatches] = useState([])
  const [values, setValues] = useState({})
  const [message, setMessage] = useState('')
  const [busyMatchId, setBusyMatchId] = useState('')

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

  const saveTip = async (matchId) => {
    setBusyMatchId(matchId)
    setMessage('')
    try {
      const response = await fetch(`/api/player/tips/${matchId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(values[matchId]),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Tip se nepodařilo uložit')
      setMessage('Tip byl uložen.')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusyMatchId('')
    }
  }

  return (
    <section className="player-tips-panel" aria-label="Moje tipy">
      <div className="player-tips-heading">
        <h2>Moje tipy</h2>
        <span>{matches.length} otevřených zápasů</span>
      </div>
      {message ? <p className="player-tips-message">{message}</p> : null}
      {matches.length === 0 ? (
        <p className="player-tips-message">Zatím nejsou otevřené zápasy k tipování.</p>
      ) : (
        matches.map((match) => (
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
          </div>
        ))
      )}
    </section>
  )
}
