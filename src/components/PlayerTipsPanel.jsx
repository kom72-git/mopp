import { useEffect, useMemo, useRef, useState } from 'react'
import { getTeamDisplayName } from '../data/teamLogos'

function formatMatchDateTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const formattedDate = new Intl.DateTimeFormat('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
  const formattedTime = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' }).format(date)
  return `${formattedDate} (${formattedTime})`
}

function formatMatchDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function buildMatchGroups(matches) {
  const groups = new Map()
  for (const match of matches) {
    const key = Number.isFinite(Number(match.round)) ? `round-${match.round}` : String(match.startsAt).slice(0, 10)
    if (!groups.has(key)) groups.set(key, { key, round: match.round, matches: [] })
    groups.get(key).matches.push(match)
  }
  return [...groups.values()].sort((first, second) => Number(first.round) - Number(second.round))
}

export default function PlayerTipsPanel({ selectedTournamentId, scheduleRefreshKey, hasSelectionNotification, pendingTipNotificationCount = 0, onSelectionUpdated, onTipUpdated, onClose }) {
  const [matches, setMatches] = useState([])
  const [values, setValues] = useState({})
  const [message, setMessage] = useState('')
  const [tipMessages, setTipMessages] = useState({})
  const [busyMatchId, setBusyMatchId] = useState('')
  const [tipPageIndex, setTipPageIndex] = useState(0)
  const [tipDisplayMode, setTipDisplayMode] = useState('open')
  const [tipHistory, setTipHistory] = useState([])
  const [tipHistoryPage, setTipHistoryPage] = useState(0)
  const tipPageSize = 6
  const [scheduleRounds, setScheduleRounds] = useState([])
  const [scheduleSelections, setScheduleSelections] = useState({})
  const [scheduleHistory, setScheduleHistory] = useState([])
  const [upcomingSelectionRounds, setUpcomingSelectionRounds] = useState([])
  const [scheduleMessage, setScheduleMessage] = useState('')
  const [tipsMode, setTipsMode] = useState('mine')
  const autoSaveTimers = useRef({})

  useEffect(() => {
    let cancelled = false
    const loadOpenMatches = () => fetch('/api/player/matches', { credentials: 'include' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.message || 'Zápasy se nepodařilo načíst')
        return payload
      })
      .then((payload) => {
        if (cancelled) return
        const loadedMatches = payload.matches ?? []
        setMatches(loadedMatches)
        setValues((current) => Object.fromEntries(loadedMatches.map((match) => [match._id, current[match._id] ?? {
          homeScore: match.tip?.homeScore ?? '',
          awayScore: match.tip?.awayScore ?? '',
        }])))
      })
      .catch((error) => {
        if (!cancelled) setMessage(error.message)
      })
    loadOpenMatches()
    const refreshId = window.setInterval(loadOpenMatches, 30000)
    return () => {
      cancelled = true
      window.clearInterval(refreshId)
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
      .catch((error) => { if (!cancelled) setScheduleMessage(error.message) })
    return () => { cancelled = true }
  }, [selectedTournamentId, scheduleRefreshKey])

  useEffect(() => {
    if (!selectedTournamentId) return undefined
    let cancelled = false
    fetch(`/api/player/tip-history?tournamentId=${encodeURIComponent(selectedTournamentId)}`, { credentials: 'include' })
      .then((response) => response.json())
      .then((payload) => { if (!cancelled) setTipHistory(payload.matches ?? []) })
      .catch(() => { if (!cancelled) setTipHistory([]) })
    return () => { cancelled = true }
  }, [selectedTournamentId, matches])

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
    const previousTip = values[matchId]
    setBusyMatchId(matchId)
    setTipMessages((current) => ({ ...current, [matchId]: null }))
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
      setValues((current) => ({ ...current, [matchId]: previousTip }))
      if (error.message.includes('už nelze tipovat')) setMatches((current) => current.filter((match) => match._id !== matchId))
    } finally {
      await new Promise((resolve) => window.setTimeout(resolve, minBusyMs))
      setBusyMatchId('')
    }
  }

  const deleteTip = async (matchId) => {
    window.clearTimeout(autoSaveTimers.current[matchId])
    setBusyMatchId(matchId)
    setTipMessages((current) => ({ ...current, [matchId]: null }))
    try {
      const response = await fetch(`/api/player/tips/${matchId}`, { method: 'DELETE', credentials: 'include' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Tip se nepodařilo smazat')
      setValues((current) => ({ ...current, [matchId]: { homeScore: '', awayScore: '' } }))
      setMatches((current) => current.map((match) => match._id === matchId ? { ...match, tip: null } : match))
      setTipMessage(matchId, 'Tip smazán', false)
      onTipUpdated?.()
    } catch (error) {
      setTipMessage(matchId, error.message, true)
    } finally {
      setBusyMatchId('')
    }
  }

  const saveScheduleSelection = async (round) => {
    const matchIds = scheduleSelections[round.round] ?? []
    setScheduleMessage('Ukládám výběr…')
    try {
      const response = await fetch(`/api/player/schedule-selections/${round.round}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ tournamentId: selectedTournamentId, matchIds }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Výběr se nepodařilo uložit')
      setScheduleRounds((current) => current.map((item) => item.round === round.round ? { ...item, matches: item.matches.filter((match) => payload.selection.matchIds.includes(match.id)), canSelect: false, selection: payload.selection } : item))
      setUpcomingSelectionRounds((current) => current.filter((item) => item.round !== round.round))
      onSelectionUpdated?.()
      await onTipUpdated?.()
      setScheduleMessage('Výběr byl uložen a uzamčen.')
    } catch (error) {
      setScheduleMessage(error.message)
    }
  }

  const tipPageCount = Math.max(1, Math.ceil(matches.length / tipPageSize))
  const tipHistoryPageCount = Math.max(1, Math.ceil(tipHistory.length / tipPageSize))
  const currentTipPageIndex = Math.min(tipPageIndex, tipPageCount - 1)
  const pagedTipGroups = useMemo(
    () => buildMatchGroups(matches.slice(currentTipPageIndex * tipPageSize, (currentTipPageIndex + 1) * tipPageSize)),
    [currentTipPageIndex, matches],
  )

  const tippedMatchCount = matches.filter((match) => match.tip !== null).length
  const selectionOverviewRounds = useMemo(() => {
    const roundsByNumber = new Map()
    for (const round of scheduleRounds) {
      if (round.selection || round.canSelect) {
        roundsByNumber.set(Number(round.round), {
          ...round,
          matches: round.matches ?? [],
          requiredSelectionCount: round.requiredSelectionCount ?? 1,
        })
      }
    }
    for (const round of upcomingSelectionRounds) {
      if (!roundsByNumber.has(Number(round.round))) {
        roundsByNumber.set(Number(round.round), {
          round: Number(round.round),
          startsAt: round.startsAt,
          matches: [],
          requiredSelectionCount: round.requiredSelectionCount ?? 1,
          canSelect: false,
        })
      }
    }
    return [...roundsByNumber.values()].sort((first, second) => first.round - second.round)
  }, [scheduleRounds, upcomingSelectionRounds])

  const scheduleContent = (
    <section className="player-schedule-picker" aria-label="Výběr zápasu">
      {scheduleMessage ? <p className="player-tips-message" role="alert">{scheduleMessage}</p> : null}
      {scheduleHistory.length > 0 ? <div className="player-schedule-box player-schedule-history-box"><h3>Poslední vybrané zápasy</h3><div className="player-schedule-history player-schedule-history-top">{scheduleHistory.map((match, index) => <span key={`${match.round}-${index}`}>{match.round}. kolo · {match.home} – {match.away}</span>)}</div></div> : null}
      <div className="player-schedule-box player-schedule-overview-box">
        <h3>Kdy tipuji a moje výběry zápasů</h3>
        {selectionOverviewRounds.map((round) => {
          const roundStart = round.startsAt ?? round.matches?.[0]?.startsAt
          const roundDate = round.selection && roundStart
            ? formatMatchDateTime(roundStart)
            : !round.matches?.length && roundStart
              ? formatMatchDate(roundStart)
              : ''
          return <div className={`player-schedule-round${round.selection ? ' is-closed' : ''}`} key={round.round}>
          <div className="player-schedule-timing-row is-single-selection"><strong>{round.round}. kolo</strong>{roundDate ? <span>{roundDate}</span> : null}</div>
          {round.canSelect ? <div className="tips-notification-message"><span>Ověřuj <strong>datum</strong> a <strong>čas</strong> konání vybíraného zápasu. Termíny se mohou změnit. Při odlišnostech ve vybraném zápasu, napiš adminovi!</span></div> : null}
          {round.matches.map((match) => round.canSelect ? <label className="player-schedule-match" key={match.id}><input type="checkbox" checked={(scheduleSelections[round.round] ?? []).includes(match.id)} disabled={(scheduleSelections[round.round] ?? []).length >= (round.requiredSelectionCount ?? 1) && !(scheduleSelections[round.round] ?? []).includes(match.id)} onChange={() => setScheduleSelections((current) => { const selected = current[round.round] ?? []; return { ...current, [round.round]: selected.includes(match.id) ? selected.filter((id) => id !== match.id) : [...selected, match.id] } })} /><span>{getTeamDisplayName(match.home)} – {getTeamDisplayName(match.away)} · <strong>{formatMatchDateTime(match.startsAt)}</strong></span></label> : <div className="player-schedule-closed-match" key={match.id}><span>{getTeamDisplayName(match.home)} – {getTeamDisplayName(match.away)}</span></div>)}
          {round.canSelect ? <button type="button" className="auth-submit" disabled={(scheduleSelections[round.round] ?? []).length !== (round.requiredSelectionCount ?? 1)} onClick={() => saveScheduleSelection(round)}>Potvrdit výběr</button> : null}
        </div>
        })}
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
        <button type="button" role="tab" aria-selected={tipsMode === 'mine'} className={tipsMode === 'mine' ? 'is-active' : ''} onClick={() => setTipsMode('mine')}>Moje tipy{pendingTipNotificationCount > 0 ? <span className="tips-tab-notification"><img src="/icons/notifikace.png" alt="Neodevzdané tipy" title="Neodevzdané tipy" />{pendingTipNotificationCount > 1 ? <span>{pendingTipNotificationCount}</span> : null}</span> : null}</button>
        <button type="button" role="tab" aria-selected={tipsMode === 'selection'} className={tipsMode === 'selection' ? 'is-active' : ''} onClick={() => setTipsMode('selection')}>Výběr zápasu{hasSelectionNotification ? <span className="tips-tab-notification"><img src="/icons/notifikace.png" alt="Jsi na řadě s výběrem tipovaného zápasu" title="Jsi na řadě s výběrem tipovaného zápasu" /></span> : null}</button>
      </div>
      {tipsMode === 'mine' && tipDisplayMode === 'open' && pendingTipNotificationCount > 0 ? <div className="tips-notification-message" role="status"><span>Chybí tip u zápasu začínajícího do 24 hodin{pendingTipNotificationCount > 1 ? ` (${pendingTipNotificationCount})` : ''}</span></div> : null}
      {tipsMode === 'selection' && hasSelectionNotification ? <div className="tips-notification-message" role="status"><span>Jsi na řadě s výběrem tipovaného zápasu</span></div> : null}
      {message ? <p className="player-tips-message" role="alert">{message}</p> : null}
      {tipsMode === 'selection' ? scheduleContent : null}
      {tipsMode === 'selection' ? null : (
      <>
          <div className="player-tip-view-tabs" role="tablist" aria-label="Zobrazení tipů">
            <button type="button" role="tab" aria-selected={tipDisplayMode === 'open'} className={tipDisplayMode === 'open' ? 'is-active' : ''} onClick={() => setTipDisplayMode('open')}>Zápasy k tipování</button>
            <button type="button" role="tab" aria-selected={tipDisplayMode === 'history'} className={tipDisplayMode === 'history' ? 'is-active' : ''} onClick={() => setTipDisplayMode('history')}>Moje zapsané tipy</button>
          </div>
          {tipDisplayMode === 'history' ? (
            <div className="player-tip-history-list">
              {tipHistoryPageCount > 1 ? (
                <div className="player-tips-navigation">
                  {tipHistoryPage > 0 ? <button type="button" className="auth-button" onClick={() => setTipHistoryPage((page) => Math.max(0, page - 1))}>Předchozí</button> : <span />}
                  <span>{tipHistoryPage + 1} / {tipHistoryPageCount}</span>
                  {tipHistoryPage < tipHistoryPageCount - 1 ? <button type="button" className="auth-button" onClick={() => setTipHistoryPage((page) => page + 1)}>Další</button> : <span />}
                </div>
              ) : null}
              {tipHistory.slice(tipHistoryPage * tipPageSize, (tipHistoryPage + 1) * tipPageSize).map((match) => (
                <article className="player-tip-history-row" key={match._id}>
                  <div><span className="player-tip-history-meta">{match.round}. kolo · {formatMatchDateTime(match.startsAt)}</span><strong className="player-tip-history-teams">{match.home} – {match.away}</strong></div>
                  <span>Tip {match.tip.homeScore}:{match.tip.awayScore}</span>
                  <span>{match.score ? `Výsledek ${match.score}` : 'Čeká na výsledek'}{match.tip.points !== null ? ` · ${match.tip.points} b` : ''}</span>
                </article>
              ))}
              {tipHistory.length === 0 ? <p className="player-tips-message">Zatím nemáš žádné zapsané tipy.</p> : null}
            </div>
          ) : null}
          {tipDisplayMode === 'open' ? <>
          {matches.length === 0 ? <p className="player-tips-message">Zatím nejsou otevřené zápasy k tipování.</p> : <>
          {tipPageCount > 1 ? (
            <div className="player-tips-navigation">
              {currentTipPageIndex > 0 ? <button type="button" className="auth-button" onClick={() => setTipPageIndex((page) => Math.max(0, page - 1))}>Předchozí</button> : <span />}
              <span>{currentTipPageIndex + 1} / {tipPageCount}</span>
              {currentTipPageIndex < tipPageCount - 1 ? <button type="button" className="auth-button" onClick={() => setTipPageIndex((page) => Math.min(tipPageCount - 1, page + 1))}>Další</button> : <span />}
            </div>
          ) : null}
          {pagedTipGroups.map((group) => {
            return (
            <div className="player-tip-group" key={group.key}>
              {group.matches.map((match) => (
                <article className="player-tip-history-row player-tip-open-row" key={match._id}>
                  <div>
                    <span className="player-tip-history-meta">{match.round}. kolo · {formatMatchDateTime(match.startsAt)}</span>
                    <strong className="player-tip-history-teams">{match.home} – {match.away}</strong>
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
                  {match.tip ? <button type="button" className="auth-button is-danger player-tip-delete" onClick={() => deleteTip(match._id)} disabled={busyMatchId === match._id} aria-label="Smazat tip" title="Smazat">×</button> : <span className="player-tip-delete-slot" aria-hidden="true" />}
                </article>
              ))}
            </div>
            )
          })}
          </>}
          </> : null}
        </>
      )}
    </section>
  )
}
