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

export default function AdminPanel() {
  const [counts, setCounts] = useState(null)
  const [tournaments, setTournaments] = useState([])
  const [matches, setMatches] = useState([])
  const [selectedTournamentId, setSelectedTournamentId] = useState('')
  const [editingMatchId, setEditingMatchId] = useState('')
  const [form, setForm] = useState({ name: '', season: '', status: 'draft', roundLabel: '', longTermBank: '' })
  const [matchForm, setMatchForm] = useState({ tournamentId: '', round: '1', startsAt: '', home: '', away: '', status: 'draft', manualBank: '' })
  const [message, setMessage] = useState('')
  const [isBusy, setIsBusy] = useState(false)

  const loadAdminData = async () => {
    const [overviewResponse, tournamentsResponse] = await Promise.all([
      fetch('/api/admin/overview', { credentials: 'include' }),
      fetch('/api/admin/tournaments', { credentials: 'include' }),
    ])
    const overview = await overviewResponse.json().catch(() => ({}))
    const tournamentData = await tournamentsResponse.json().catch(() => ({}))
    if (!overviewResponse.ok) throw new Error(overview.message || 'Admin přehled se nepodařilo načíst')
    if (!tournamentsResponse.ok) throw new Error(tournamentData.message || 'Turnaje se nepodařilo načíst')
    setCounts(overview.counts)
    const loadedTournaments = tournamentData.tournaments ?? []
    setTournaments(loadedTournaments)
    const activeTournamentId = selectedTournamentId || loadedTournaments[0]?._id || ''
    setSelectedTournamentId(activeTournamentId)
    setMatchForm((current) => ({ ...current, tournamentId: current.tournamentId || activeTournamentId }))
    const matchesResponse = await fetch(
      activeTournamentId ? `/api/admin/matches?tournamentId=${encodeURIComponent(activeTournamentId)}` : '/api/admin/matches',
      { credentials: 'include' },
    )
    const matchData = await matchesResponse.json().catch(() => ({}))
    if (!matchesResponse.ok) throw new Error(matchData.message || 'Zápasy se nepodařilo načíst')
    setMatches(matchData.matches ?? [])
  }

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const [overviewResponse, tournamentsResponse] = await Promise.all([
          fetch('/api/admin/overview', { credentials: 'include' }),
          fetch('/api/admin/tournaments', { credentials: 'include' }),
        ])
        const overview = await overviewResponse.json().catch(() => ({}))
        const tournamentData = await tournamentsResponse.json().catch(() => ({}))
        if (!overviewResponse.ok) throw new Error(overview.message || 'Admin přehled se nepodařilo načíst')
        if (!tournamentsResponse.ok) throw new Error(tournamentData.message || 'Turnaje se nepodařilo načíst')
        if (cancelled) return
        setCounts(overview.counts)
        const loadedTournaments = tournamentData.tournaments ?? []
        const activeTournamentId = loadedTournaments[0]?._id || ''
        setTournaments(loadedTournaments)
        setSelectedTournamentId(activeTournamentId)
        setMatchForm((current) => ({ ...current, tournamentId: activeTournamentId }))

        if (activeTournamentId) {
          const matchesResponse = await fetch(`/api/admin/matches?tournamentId=${encodeURIComponent(activeTournamentId)}`, { credentials: 'include' })
          const matchData = await matchesResponse.json().catch(() => ({}))
          if (!matchesResponse.ok) throw new Error(matchData.message || 'Zápasy se nepodařilo načíst')
          if (cancelled) return
          const loadedMatches = matchData.matches ?? []
          setMatches(loadedMatches)
          const nextRound = loadedMatches.reduce((max, match) => Math.max(max, Number(match.round) || 0), 0) + 1
          setMatchForm((current) => ({ ...current, tournamentId: activeTournamentId, round: String(nextRound) }))
        }
      } catch (error) {
        if (!cancelled) setMessage(error.message)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const updateField = (event) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  const updateMatchField = (event) => {
    setMatchForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  const selectTournament = async (event) => {
    const tournamentId = event.target.value
    setSelectedTournamentId(tournamentId)
    setMatchForm((current) => ({ ...current, tournamentId }))
    const response = await fetch(`/api/admin/matches?tournamentId=${encodeURIComponent(tournamentId)}`, { credentials: 'include' })
    const payload = await response.json().catch(() => ({}))
    if (response.ok) setMatches(payload.matches ?? [])
  }

  const createTournament = async (event) => {
    event.preventDefault()
    setIsBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/admin/tournaments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Turnaj se nepodařilo založit')
      setForm({ name: '', season: '', status: 'draft', roundLabel: '', longTermBank: '' })
      await loadAdminData()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setIsBusy(false)
    }
  }

  const createMatch = async (event) => {
    event.preventDefault()
    setIsBusy(true)
    setMessage('')
    try {
      const endpoint = editingMatchId ? `/api/admin/matches/${editingMatchId}` : '/api/admin/matches'
      const response = await fetch(endpoint, {
        method: editingMatchId ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...matchForm, tournamentId: selectedTournamentId }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Zápas se nepodařilo založit')
      if (editingMatchId) {
        setMatches((current) => current.map((match) => match._id === editingMatchId ? payload.match : match))
        setEditingMatchId('')
        setMessage('Zápas byl upraven.')
        return
      }
      setMatchForm((current) => ({ ...current, round: String(Number(current.round) + 1), startsAt: '', home: '', away: '', manualBank: '' }))
      setMatches((current) => [...current, payload.match].sort((a, b) => {
        const startsAtDiff = String(a.startsAt).localeCompare(String(b.startsAt))
        if (startsAtDiff !== 0) return startsAtDiff
        return a.round - b.round
      }))
      setCounts((current) => current ? { ...current, matches: current.matches + 1 } : current)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setIsBusy(false)
    }
  }

  const editMatch = (match) => {
    setEditingMatchId(match._id)
    setSelectedTournamentId(match.tournamentId)
    setMatchForm({
      tournamentId: match.tournamentId,
      round: String(match.round),
      startsAt: match.startsAt,
      home: match.home,
      away: match.away,
      status: match.status,
      manualBank: '',
    })
    setMessage('')
  }

  const deleteMatch = async (match) => {
    if (!window.confirm(`Opravdu smazat zápas ${match.home} – ${match.away}?`)) return
    setIsBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/admin/matches/${match._id}`, { method: 'DELETE', credentials: 'include' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Zápas se nepodařilo smazat')
      setMatches((current) => current.filter((item) => item._id !== match._id))
      setCounts((current) => current ? { ...current, matches: Math.max(0, current.matches - 1) } : current)
      if (editingMatchId === match._id) setEditingMatchId('')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setIsBusy(false)
    }
  }

  if (!counts) return <p className="admin-panel-message">{message || 'Načítám admin přehled…'}</p>

  return (
    <section className="admin-panel" aria-label="Admin prostředí">
      <div className="admin-panel-heading">
        <h2>Admin prostředí</h2>
        <span>Přístup ověřen</span>
      </div>
      {message ? <p className="admin-panel-message">{message}</p> : null}
      <div className="admin-panel-stats">
        <span>Účty <strong>{counts.users}</strong></span>
        <span>Turnaje <strong>{counts.tournaments}</strong></span>
        <span>Zápasy <strong>{counts.matches}</strong></span>
        <span>Tipy <strong>{counts.tips}</strong></span>
      </div>
      <form className="admin-tournament-form" onSubmit={createTournament}>
        <h3>Nový turnaj</h3>
        <input name="name" value={form.name} onChange={updateField} placeholder="Název turnaje" required />
        <input name="season" value={form.season} onChange={updateField} placeholder="Sezóna (volitelné)" />
        <div className="admin-tournament-form-row">
          <select name="status" value={form.status} onChange={updateField}>
            <option value="draft">Připravovaný</option>
            <option value="active">Aktivní</option>
            <option value="finished">Ukončený</option>
          </select>
          <input
            name="roundLabel"
            value={form.roundLabel}
            onChange={updateField}
            placeholder="Jednotka kola: den / kolo"
            aria-label="Jednotka kola, například den nebo kolo"
            title="Toto není datum. Zadej slovo, které se zobrazí za číslem kola, například den nebo kolo."
            required
          />
          <input name="longTermBank" type="number" min="0" value={form.longTermBank} onChange={updateField} placeholder="Bank" />
        </div>
        <button type="submit" className="auth-submit" disabled={isBusy}>{isBusy ? 'Ukládám…' : 'Založit turnaj'}</button>
      </form>
      {tournaments.length > 0 ? (
        <div className="admin-tournament-list">
          <h3>Turnaje</h3>
          {tournaments.map((tournament) => (
            <div className="admin-tournament-row" key={tournament._id}>
              <strong>{tournament.name}</strong>
              <span>{tournament.season || 'Bez sezóny'} · {tournament.status}</span>
            </div>
          ))}
        </div>
      ) : <p className="admin-panel-note">Zatím nejsou založené žádné turnaje.</p>}
      {tournaments.length > 0 ? (
        <>
          <form className="admin-tournament-form" onSubmit={createMatch}>
            <h3>{editingMatchId ? 'Upravit zápas' : 'Nový zápas'}</h3>
            <select value={selectedTournamentId} onChange={selectTournament} required>
              <option value="">Vyber turnaj</option>
              {tournaments.map((tournament) => <option key={tournament._id} value={tournament._id}>{tournament.name}</option>)}
            </select>
            <div className="admin-tournament-form-row">
              <input name="round" type="number" min="1" value={matchForm.round} onChange={updateMatchField} placeholder="Kolo" required />
              <input name="startsAt" type="datetime-local" value={matchForm.startsAt} onChange={updateMatchField} required />
              <select name="status" value={matchForm.status} onChange={updateMatchField}>
                <option value="draft">Připravovaný</option>
                <option value="open">Otevřený</option>
                <option value="locked">Uzamčený</option>
              </select>
            </div>
            <div className="admin-tournament-form-row">
              <input name="home" value={matchForm.home} onChange={updateMatchField} placeholder="Domácí tým" required />
              <input name="away" value={matchForm.away} onChange={updateMatchField} placeholder="Hostující tým" required />
              <input name="manualBank" type="number" min="0" value={matchForm.manualBank} onChange={updateMatchField} placeholder="Bank ručně (volitelné)" />
            </div>
            <div className="admin-form-actions">
              <button type="submit" className="auth-submit" disabled={isBusy}>{isBusy ? 'Ukládám…' : editingMatchId ? 'Uložit změny' : 'Založit zápas'}</button>
              {editingMatchId ? <button type="button" className="auth-button" onClick={() => setEditingMatchId('')}>Zrušit</button> : null}
            </div>
          </form>
          <div className="admin-tournament-list">
            <h3>Zápasy</h3>
            {matches.length > 0 ? matches.map((match) => (
              <div className="admin-tournament-row" key={match._id}>
                <strong>{formatMatchDateTime(match.startsAt)} · {match.home} – {match.away}</strong>
                <span>
                  {match.status === 'open' ? 'otevřený' : match.status === 'locked' ? 'uzamčený' : match.status === 'evaluated' ? 'vyhodnocený' : 'připravovaný'}
                  {' · '}Bank {match.bank} Kč · {match.bankSource === 'automatic' ? 'automaticky' : 'ručně'}
                  {match.carriedBank > 0 ? ` (převod ${match.carriedBank} Kč)` : ''}
                </span>
                <div className="admin-row-actions">
                  <button type="button" className="auth-button" onClick={() => editMatch(match)}>Upravit</button>
                  <button type="button" className="auth-button is-danger" onClick={() => deleteMatch(match)} disabled={isBusy}>Smazat</button>
                </div>
              </div>
            )) : <p className="admin-panel-note">Zatím nejsou založené žádné zápasy.</p>}
          </div>
        </>
      ) : null}
    </section>
  )
}
