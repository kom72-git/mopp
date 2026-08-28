import { useEffect, useMemo, useRef, useState } from 'react'
import { getTeamDisplayName } from '../data/teamLogos'

function formatMatchDateTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const formattedDate = new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
  const formattedTime = new Intl.DateTimeFormat('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
  return `${formattedDate} (${formattedTime})`
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

export default function PlayerTipsPanel({ selectedTournamentId, scheduleRefreshKey, hasSelectionNotification, onSelectionUpdated, onTipUpdated, onClose }) {
  const [matches, setMatches] = useState([])
  const [values, setValues] = useState({})
  const [message, setMessage] = useState('')
  const [tipMessages, setTipMessages] = useState({})
  const [busyMatchId, setBusyMatchId] = useState('')
  const [activeGroupIndex, setActiveGroupIndex] = useState(null)
  const [tipViewMode, setTipViewMode] = useState('group')
  const [scheduleRounds, setScheduleRounds] = useState([])
  const [scheduleSelections, setScheduleSelections] = useState({})
  const [scheduleHistory, setScheduleHistory] = useState([])
  const [upcomingSelectionRounds, setUpcomingSelectionRounds] = useState([])
  const [scheduleMessage, setScheduleMessage] = useState('')
  const [tipsMode, setTipsMode] = useState('mine')
  const autoSaveTimers = useRef({})

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

  useEffect(() => {
    if (!selectedTournamentId) return undefined
    let cancelled = false
    fetch(`/api/player/schedule?tournamentId=${encodeURIComponent(selectedTournamentId)}`, { credentials: 'include' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.message || 'Rozpis se nepodařilo načíst')
        return payload
      })
      .then((payload) => {
        if (cancelled) return
        setScheduleRounds(payload.rounds ?? [])
        setScheduleSelections(Object.fromEntries((payload.rounds ?? []).map((round) => [round.round, round.selection?.matchIds ?? []])))
        setScheduleHistory(payload.recentSelectedMatches ?? [])
        setUpcomingSelectionRounds(payload.upcomingSelectionRounds ?? [])
      })
      .catch((error) => {
        if (!cancelled) setScheduleMessage(error.message)
      })
    return () => { cancelled = true }
  }, [selectedTournamentId, scheduleRefreshKey])

  useEffect(() => () => {
    Object.values(autoSaveTimers.current).forEach((timerId) => window.clearTimeout(timerId))
  }, [])

  const updateScore = (matchId, field, value) => {
    const nextTip = { ...values[matchId], [field]: value }
    setValues((current) => ({ ...current, [matchId]: nextTip }))
    const hasCompleteScore = nextTip.homeScore !== '' && nextTip.awayScore !== ''
      && Number.isInteger(Number(nextTip.homeScore)) && Number.isInteger(Number(nextTip.awayScore))
      && Number(nextTip.homeScore) >= 0 && Number(nextTip.homeScore) <= 99
      && Number(nextTip.awayScore) >= 0 && Number(nextTip.awayScore) <= 99

    window.clearTimeout(autoSaveTimers.current[matchId])
    if (hasCompleteScore) {
      setTipMessage(matchId, 'Čekám na potvrzení…', false)
      autoSaveTimers.current[matchId] = window.setTimeout(() => saveTip(matchId, nextTip), 500)
    } else if (nextTip.homeScore !== '' || nextTip.awayScore !== '') {
      setTipMessage(matchId, 'Doplň i druhé skóre', false, true)
    }
  }

  const setTipMessage = (matchId, text, isError, isPending = false) => {
    setTipMessages((current) => ({ ...current, [matchId]: { text, isError, isPending } }))
    if (text === 'Uloženo') return
    window.setTimeout(() => {
      setTipMessages((current) => (current[matchId]?.text === text ? { ...current, [matchId]: null } : current))
    }, 4000)
  }

  const saveTip = async (matchId, tipValues = values[matchId]) => {
    setBusyMatchId(matchId)
    setTipMessages((current) => ({ ...current, [matchId]: null }))
    const startedAt = Date.now()
    const minBusyMs = 400
    try {
      const response = await fetch(`/api/player/tips/${matchId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(tipValues),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Tip se nepodařilo uložit')
      setTipMessage(matchId, 'Uloženo', false)
      onTipUpdated?.(payload.tip)
    } catch (error) {
      setTipMessage(matchId, error.message, true)
    } finally {
      const elapsed = Date.now() - startedAt
      if (elapsed < minBusyMs) await new Promise((resolve) => window.setTimeout(resolve, minBusyMs - elapsed))
      setBusyMatchId('')
    }
  }

  const saveScheduleSelection = async (round) => {
    const matchIds = scheduleSelections[round.round] ?? []
    setScheduleMessage('Ukládám výběr…')
    try {
      const response = await fetch(`/api/player/schedule-selections/${round.round}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tournamentId: selectedTournamentId, matchIds }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Výběr se nepodařilo uložit')
      setScheduleRounds((current) => current.map((item) => item.round === round.round
        ? { ...item, matches: item.matches.filter((match) => payload.selection.matchIds.includes(match.id)), canSelect: false, selection: payload.selection }
        : item))
      setUpcomingSelectionRounds((current) => current.filter((item) => item.round !== round.round))
      onSelectionUpdated?.()
      await onTipUpdated?.()
      const matchesResponse = await fetch('/api/player/matches', { credentials: 'include' })
      const matchesPayload = await matchesResponse.json().catch(() => ({}))
      if (matchesResponse.ok) {
        const loadedMatches = matchesPayload.matches ?? []
        setMatches(loadedMatches)
        setValues(Object.fromEntries(loadedMatches.map((match) => [match._id, {
          homeScore: match.tip?.homeScore ?? '',
          awayScore: match.tip?.awayScore ?? '',
        }])))
      }
      setScheduleMessage('Výběr byl uložen a uzamčen.')
    } catch (error) {
      setScheduleMessage(error.message)
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

  const scheduleContent = (
    <section className="player-schedule-picker" aria-label="Výběr zápasu">
      {scheduleMessage ? <p className="player-tips-message" role="alert">{scheduleMessage}</p> : null}
      {scheduleHistory.length > 0 ? (
        <div className="player-schedule-box player-schedule-history-box">
          <h3>Poslední výběry</h3>
          <div className="player-schedule-history player-schedule-history-top">
                {scheduleHistory.map((match, index) => <span key={`${match.round}-${match.home}-${match.away}-${index}`}>{match.round}. kolo · {match.home} – {match.away}</span>)}
          </div>
        </div>
      ) : null}
      {upcomingSelectionRounds.length > 0 ? (
        <div className="player-schedule-box player-schedule-timing-box">
          <h3>Kdy tipuji</h3>
          <div className="player-schedule-timing-list">
            {upcomingSelectionRounds.map((item) => (
              <div className="player-schedule-timing-row" key={item.round}>
                <strong>{item.round}. kolo</strong>
                <span>{item.requiredSelectionCount} zápas{item.requiredSelectionCount === 1 ? '' : 'y'}</span>
                <span>{item.startsAt ? formatMatchDateTime(item.startsAt) : 'Termín bude doplněn'}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="player-schedule-box player-schedule-selections-box">
        <h3>Moje výběry</h3>
        {scheduleRounds.length === 0 ? <p className="player-tips-message">Zatím není dostupné kolo pro tvůj výběr.</p> : scheduleRounds.map((round) => (
          <div className={`player-schedule-round${round.selection ? ' is-closed' : ''}`} key={round.round}>
            {!round.selection ? <strong>{round.round}. kolo{round.canSelect ? ` · vyber ${round.requiredSelectionCount} zápas${round.requiredSelectionCount === 1 ? '' : 'y'}` : ''}</strong> : null}
            {round.matches.map((match) => {
              const checked = (scheduleSelections[round.round] ?? []).includes(match.id)
              if (round.selection) return <div className="player-schedule-closed-match" key={match.id}><span>{round.round}. kolo · {getTeamDisplayName(match.home)} – {getTeamDisplayName(match.away)} · {formatMatchDateTime(match.startsAt)}</span></div>
              return (
                <label className={`player-schedule-match${round.selection?.matchIds?.includes(match.id) ? ' is-selected' : ''}`} key={match.id}>
                  <input type="checkbox" checked={checked} disabled={!round.canSelect || (!checked && (scheduleSelections[round.round] ?? []).length >= round.requiredSelectionCount)} onChange={() => setScheduleSelections((current) => ({ ...current, [round.round]: checked ? (current[round.round] ?? []).filter((id) => id !== match.id) : [...(current[round.round] ?? []), match.id] }))} />
                  <span>{getTeamDisplayName(match.home)} – {getTeamDisplayName(match.away)} · {formatMatchDateTime(match.startsAt)}</span>
                </label>
              )
            })}
            {round.canSelect ? <button type="button" className="auth-submit" disabled={(scheduleSelections[round.round] ?? []).length !== round.requiredSelectionCount} onClick={() => saveScheduleSelection(round)}>Potvrdit výběr</button> : null}
          </div>
        ))}
      </div>
    </section>
  )

  return (
    <section className="player-tips-panel" aria-label="Moje tipy">
      <div className="player-tips-heading">
        <h2>Moje tipy & výběry</h2>
        <span className="tag ratio-help" title="Tvoje uložené tipy / Počet aktivních zápasů" aria-label="Tvoje uložené tipy / Počet aktivních zápasů">Tipy {tippedMatchCount}/{matches.length}</span>
        <button type="button" className="panel-close-button" onClick={onClose} aria-label="Zavřít panel" title="Zavřít">×</button>
      </div>
      <div className="player-tips-tabs" role="tablist" aria-label="Tipování">
        <button type="button" role="tab" aria-selected={tipsMode === 'mine'} className={tipsMode === 'mine' ? 'is-active' : ''} onClick={() => setTipsMode('mine')}>Moje tipy</button>
        <button type="button" role="tab" aria-selected={tipsMode === 'selection'} className={tipsMode === 'selection' ? 'is-active' : ''} onClick={() => setTipsMode('selection')}>Výběr zápasu{hasSelectionNotification ? <img className="notification-bell notification-bell-tab" src="/icons/notifikace.png" alt="Jsi na řadě s výběrem zápasu" title="Jsi na řadě s výběrem zápasu" /> : null}</button>
      </div>
      {message ? <p className="player-tips-message" role="alert">{message}</p> : null}
      {tipsMode === 'selection' ? scheduleContent : matches.length === 0 ? (
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
                    <span className="player-tip-date">{formatMatchDateTime(match.startsAt)}</span>
                    <strong className="player-tip-match">{match.home} – {match.away}</strong>
                    <span className="player-tip-meta">Bank {match.bank == null ? 'čeká na výsledek předchozího zápasu' : `${match.bank} Kč`}</span>
                  </div>
                  <div className="player-tip-score">
                    <div className="player-tip-score-controls">
                      <input type="number" min="0" max="99" value={values[match._id]?.homeScore ?? ''} onChange={(event) => updateScore(match._id, 'homeScore', event.target.value)} aria-label={`Tip domácího týmu ${match.home}`} />
                      <span>:</span>
                      <input type="number" min="0" max="99" value={values[match._id]?.awayScore ?? ''} onChange={(event) => updateScore(match._id, 'awayScore', event.target.value)} aria-label={`Tip hostujícího týmu ${match.away}`} />
                    </div>
                    <span className={`player-tip-save-status${tipMessages[match._id]?.isError ? ' is-error' : tipMessages[match._id]?.isPending ? ' is-pending' : ''}`} aria-live="polite">
                      {busyMatchId === match._id ? 'Ukládám…' : tipMessages[match._id]?.text || (match.tip ? 'Uloženo' : '')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </section>
  )
}
