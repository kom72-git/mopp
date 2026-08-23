import { useEffect, useState } from 'react'
import { getTeamDisplayName } from '../data/teamLogos'

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

// Vstup <input type="datetime-local"> nemá časovou zónu, prohlížeč ji ale bere jako místní čas.
function dateTimeLocalToIso(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

// Server ukládá startsAt jako UTC ISO řetězec, input datetime-local ale potřebuje místní čas.
function isoToDateTimeLocal(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value ?? ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function ManualDateTimeInput({ value, onChange, dateOnly = false, ...props }) {
  return (
    <input
      {...props}
      type={dateOnly ? 'date' : 'datetime-local'}
      value={dateOnly ? String(value || '').slice(0, 10) : isoToDateTimeLocal(value)}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

function ManualDateInput({ value, onChange, ...props }) {
  return <ManualDateTimeInput {...props} dateOnly value={value ? `${value}T00:00` : ''} onChange={(nextValue) => onChange(nextValue ? nextValue.slice(0, 10) : '')} />
}

export default function AdminPanel({ selectedTournamentId: selectedTournamentKey, accountNotificationCount = 0, onAccountNotificationsRead, onTournamentMembershipChanged, onTournamentUpdated, onMatchesChanged, onClose }) {
  const [counts, setCounts] = useState(null)
  const [users, setUsers] = useState([])
  const [tipBreakdown, setTipBreakdown] = useState([])
  const [tournamentLogos, setTournamentLogos] = useState([])
  const [tournaments, setTournaments] = useState([])
  const [matches, setMatches] = useState([])
  const [scheduleMatches, setScheduleMatches] = useState([])
  const [isImportingSchedule, setIsImportingSchedule] = useState(false)
  const [selectedTournamentId, setSelectedTournamentId] = useState('')
  const [editingTournamentId, setEditingTournamentId] = useState('')
  const [editingMatchId, setEditingMatchId] = useState('')
  const [openSection, setOpenSection] = useState('')
  const [form, setForm] = useState({ name: '', subtitle: '', shortLabel: '', season: '', plannedMatchCount: '', selectionMatchCount: '1', scheduleUrl: '', status: 'draft', roundLabel: '', startDate: '', heroLogo: '', logoSet: 'elh', favicon: '', entryFee: '10', longTermContribution: '' })
  const [participantUserIds, setParticipantUserIds] = useState([])
  const [matchSelections, setMatchSelections] = useState([])
  const [stages, setStages] = useState([])
  const [scoring, setScoring] = useState({ exact: '10', near: '5', winner: '3' })
  const [tieBreakOrder, setTieBreakOrder] = useState(['exact', 'scored', 'noBet'])
  const [tieBreakRules, setTieBreakRules] = useState([])
  const [payouts, setPayouts] = useState(['', '', '', '', ''])
  const [matchForm, setMatchForm] = useState({ tournamentId: '', round: '1', startsAt: '', home: '', away: '', score: '', status: 'draft', manualBank: '' })
  const [message, setMessage] = useState('')
  const [participantMessages, setParticipantMessages] = useState({})
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
    setTipBreakdown(overview.tipBreakdown ?? [])
    setUsers(overview.users ?? [])
    const loadedTournaments = tournamentData.tournaments ?? []
    setTournaments(loadedTournaments)
    const requestedId = String(selectedTournamentKey ?? '').replace(/^db:/, '')
    const requestedMongoTournament = loadedTournaments.some((item) => item._id === requestedId)
    const activeTournamentId = requestedMongoTournament ? requestedId : selectedTournamentId || loadedTournaments[0]?._id || ''
    setSelectedTournamentId(activeTournamentId)
    setMatchForm((current) => ({ ...current, tournamentId: current.tournamentId || activeTournamentId }))
    const matchesResponse = await fetch(
      activeTournamentId ? `/api/admin/matches?tournamentId=${encodeURIComponent(activeTournamentId)}` : '/api/admin/matches',
      { credentials: 'include' },
    )
    const matchData = await matchesResponse.json().catch(() => ({}))
    if (!matchesResponse.ok) throw new Error(matchData.message || 'Zápasy se nepodařilo načíst')
    setMatches(matchData.matches ?? [])
    await loadScheduleData(activeTournamentId)
  }

  const loadScheduleData = async (tournamentId) => {
    if (!tournamentId) {
      setScheduleMatches([])
      return
    }
    const response = await fetch(`/api/admin/schedule?tournamentId=${encodeURIComponent(tournamentId)}`, { credentials: 'include' })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.message || 'Rozpis se nepodařilo načíst')
    setScheduleMatches(payload.matches ?? [])
  }

  const importSchedule = async () => {
    if (!selectedTournamentId) return
    setIsImportingSchedule(true)
    setMessage('')
    try {
      const response = await fetch('/api/admin/schedule/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tournamentId: selectedTournamentId }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Import rozpisu se nepodařil')
      setScheduleMatches(payload.matches ?? [])
      setMessage(`Rozpis načten: ${payload.count} zápasů.`)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setIsImportingSchedule(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    fetch('/api/admin/assets/tournament-logos', { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!cancelled) setTournamentLogos(payload?.logos ?? [])
      })
      .catch(() => {})

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
        setTipBreakdown(overview.tipBreakdown ?? [])
        setUsers(overview.users ?? [])
        const loadedTournaments = tournamentData.tournaments ?? []
        const requestedId = String(selectedTournamentKey ?? '').replace(/^db:/, '')
        const requestedMongoTournament = loadedTournaments.some((item) => item._id === requestedId)
        const activeTournamentId = requestedMongoTournament ? requestedId : loadedTournaments[0]?._id || ''
        const activeTournament = loadedTournaments.find((item) => item._id === activeTournamentId)
        setTournaments(loadedTournaments)
        setSelectedTournamentId(activeTournamentId)
        if (activeTournament) {
          setForm({
            name: activeTournament.name,
            subtitle: activeTournament.subtitle || '',
            shortLabel: activeTournament.shortLabel || '',
            season: activeTournament.season || '',
            plannedMatchCount: String(activeTournament.plannedMatchCount ?? ''),
            selectionMatchCount: String(activeTournament.selectionMatchCount ?? 1),
            scheduleUrl: activeTournament.scheduleUrl || '',
            status: activeTournament.status || 'draft',
            roundLabel: activeTournament.roundLabel || '',
            startDate: activeTournament.startDate || '',
            heroLogo: activeTournament.heroLogo || '',
            logoSet: activeTournament.logoSet || '',
            favicon: activeTournament.favicon || '',
            entryFee: String(activeTournament.entryFee ?? 10),
            longTermContribution: String(activeTournament.longTermContribution ?? ''),
          })
          setParticipantUserIds(activeTournament.participantUserIds?.map(String) ?? [])
          setMatchSelections(activeTournament.matchSelections ?? [])
          setStages(activeTournament.stages || [])
          setScoring({ exact: String(activeTournament.scoring?.exact ?? 10), near: String(activeTournament.scoring?.near ?? 5), winner: String(activeTournament.scoring?.winner ?? 3) })
          setTieBreakOrder(activeTournament.tieBreakOrder || ['exact', 'scored', 'noBet'])
          setTieBreakRules(activeTournament.tieBreakRules || [])
          setPayouts(Array.from({ length: 5 }, (_, index) => String(activeTournament.payouts?.find((item) => item.place === index + 1)?.amount ?? '')))
          setEditingTournamentId(activeTournament._id)
        }
        setMatchForm((current) => ({ ...current, tournamentId: activeTournamentId }))

        if (activeTournamentId) {
          const matchesResponse = await fetch(`/api/admin/matches?tournamentId=${encodeURIComponent(activeTournamentId)}`, { credentials: 'include' })
          const matchData = await matchesResponse.json().catch(() => ({}))
          if (!matchesResponse.ok) throw new Error(matchData.message || 'Zápasy se nepodařilo načíst')
          if (cancelled) return
          const loadedMatches = matchData.matches ?? []
          setMatches(loadedMatches)
          const scheduleResponse = await fetch(`/api/admin/schedule?tournamentId=${encodeURIComponent(activeTournamentId)}`, { credentials: 'include' })
          const scheduleData = await scheduleResponse.json().catch(() => ({}))
          if (!scheduleResponse.ok) throw new Error(scheduleData.message || 'Rozpis se nepodařilo načíst')
          setScheduleMatches(scheduleData.matches ?? [])
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
  }, [selectedTournamentKey])

  const updateField = (event) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  const updateMatchField = (event) => {
    setMatchForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  const updateMatchScore = (side, value) => {
    setMatchForm((current) => {
      const [homeScore = '', awayScore = ''] = String(current.score || '').split(':')
      const nextScore = side === 'home' ? `${value}:${awayScore}` : `${homeScore}:${value}`
      return { ...current, score: nextScore === ':' ? '' : nextScore }
    })
  }

  const saveParticipantIds = async (nextParticipantUserIds, changedUserId = '') => {
    if (!editingTournamentId) return
    setParticipantUserIds(nextParticipantUserIds)
    setIsBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/admin/tournaments/${editingTournamentId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...form, participantUserIds: nextParticipantUserIds, matchSelections, stages, scoring, tieBreakOrder, tieBreakRules, payouts }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Členství se nepodařilo uložit')
      setTournaments((current) => current.map((tournament) => tournament._id === editingTournamentId ? payload.tournament : tournament))
      await onTournamentUpdated?.({ ...payload.tournament, id: `db:${payload.tournament._id}` })
      onTournamentMembershipChanged?.()
      if (changedUserId) {
        setParticipantMessages((current) => ({ ...current, [changedUserId]: { text: 'Uloženo', isError: false } }))
        window.setTimeout(() => setParticipantMessages((current) => ({ ...current, [changedUserId]: null })), 2500)
      }
    } catch (error) {
      if (changedUserId) setParticipantMessages((current) => ({ ...current, [changedUserId]: { text: error.message, isError: true } }))
      else setMessage(error.message)
    } finally {
      setIsBusy(false)
    }
  }

  const toggleParticipant = (userId) => {
    const activeIds = users.filter((item) => item.status === 'active').map((item) => String(item._id))
    const selectedIds = participantUserIds.length === 0 ? activeIds : participantUserIds
    const next = selectedIds.includes(userId)
      ? selectedIds.filter((id) => id !== userId)
      : [...selectedIds, userId]
    const finalIds = next.length === activeIds.length ? [] : next
    setParticipantMessages((current) => ({ ...current, [userId]: { text: 'Ukládám…', isError: false } }))
    saveParticipantIds(finalIds, userId)
  }

  const deleteAccount = async (user) => {
    if (!window.confirm(`Opravdu smazat účet ${user.displayName || user.username}?`)) return
    setIsBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user._id)}`, { method: 'DELETE', credentials: 'include' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Účet se nepodařilo smazat')
      setUsers((current) => current.filter((item) => item._id !== user._id))
      setParticipantUserIds((current) => current.filter((id) => id !== user._id))
      setMessage(payload.message)
      onMatchesChanged?.()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setIsBusy(false)
    }
  }

  const saveMatchSelection = async (round, matchId) => {
    if (!editingTournamentId) return
    const nextSelections = [
      ...matchSelections.filter((selection) => Number(selection.round) !== Number(round)),
      { round: Number(round), matchId, selectedAt: new Date().toISOString() },
    ].sort((a, b) => Number(a.round) - Number(b.round))
    setMatchSelections(nextSelections)
    setIsBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/admin/tournaments/${editingTournamentId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...form, participantUserIds, matchSelections: nextSelections, stages, scoring, tieBreakOrder, tieBreakRules, payouts }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Výběr se nepodařilo uložit')
      setTournaments((current) => current.map((tournament) => tournament._id === editingTournamentId ? payload.tournament : tournament))
      await onTournamentUpdated?.({ ...payload.tournament, id: `db:${payload.tournament._id}` })
      setMessage('Výběr zápasu uložen.')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setIsBusy(false)
    }
  }

  const createTournament = async (event) => {
    event?.preventDefault()
    setIsBusy(true)
    setMessage('')
    try {
      const endpoint = editingTournamentId ? `/api/admin/tournaments/${editingTournamentId}` : '/api/admin/tournaments'
      const response = await fetch(endpoint, {
        method: editingTournamentId ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...form, participantUserIds, stages, scoring, tieBreakOrder, tieBreakRules, payouts }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Turnaj se nepodařilo založit')
      if (editingTournamentId) {
        setTournaments((current) => current.map((tournament) => tournament._id === editingTournamentId ? payload.tournament : tournament))
        await onTournamentUpdated?.({ ...payload.tournament, id: `db:${payload.tournament._id}` })
        setMessage('Turnaj byl upraven.')
        return
      }
      setForm({ name: '', subtitle: '', shortLabel: '', season: '', plannedMatchCount: '', selectionMatchCount: '1', scheduleUrl: '', status: 'draft', roundLabel: '', startDate: '', heroLogo: '', logoSet: 'elh', favicon: '', entryFee: '10', longTermContribution: '' })
      setParticipantUserIds([])
      setStages([])
      setPayouts(['', '', '', '', ''])
      setScoring({ exact: '10', near: '5', winner: '3' })
      setTieBreakOrder(['exact', 'scored', 'noBet'])
      setTieBreakRules([])
      await loadAdminData()
      await onTournamentUpdated?.({ ...payload.tournament, id: `db:${payload.tournament._id}` })
    } catch (error) {
      setMessage(error.message)
    } finally {
      setIsBusy(false)
    }
  }

  const saveTournamentSettings = () => {
    if (!editingTournamentId) {
      setMessage('Nejdřív vyber existující MongoDB turnaj nebo založ nový turnaj v Základu turnaje.')
      return
    }
    createTournament()
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
        body: JSON.stringify({ ...matchForm, tournamentId: selectedTournamentId, startsAt: dateTimeLocalToIso(matchForm.startsAt) }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Zápas se nepodařilo založit')
      if (editingMatchId) {
        setMatches((current) => [...current.map((match) => match._id === editingMatchId ? payload.match : match)].sort((a, b) => {
          const roundDiff = a.round - b.round
          if (roundDiff !== 0) return roundDiff
          return String(a.startsAt).localeCompare(String(b.startsAt))
        }))
        setEditingMatchId('')
        setMessage('Zápas byl upraven.')
        onMatchesChanged?.()
        return
      }
      setMatchForm((current) => ({ ...current, round: String(Number(current.round) + 1), startsAt: '', home: '', away: '', score: '', manualBank: '' }))
      setMatches((current) => [...current, payload.match].sort((a, b) => {
        const roundDiff = a.round - b.round
        if (roundDiff !== 0) return roundDiff
        return String(a.startsAt).localeCompare(String(b.startsAt))
      }))
      setCounts((current) => current ? { ...current, matches: current.matches + 1 } : current)
      onMatchesChanged?.()
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
      startsAt: isoToDateTimeLocal(match.startsAt),
      home: match.home,
      away: match.away,
      score: match.score || '',
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
      onMatchesChanged?.()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setIsBusy(false)
    }
  }

  const toggleSection = (section) => {
    setOpenSection((current) => current === section ? '' : section)
  }

  const sectionButton = (section, label) => (
    <button
      type="button"
      className="admin-section-toggle"
      onClick={() => {
        toggleSection(section)
        if (section === 'users') onAccountNotificationsRead?.()
      }}
      aria-expanded={openSection === section}
    >
      <span>{label}{section === 'users' && accountNotificationCount > 0 ? <span className="admin-section-notification" title={`${accountNotificationCount} nových hráčů`}><img src="/icons/notifikace.png" alt="" /><strong>{accountNotificationCount}</strong></span> : null}</span>
      <span aria-hidden="true">{openSection === section ? '−' : '+'}</span>
    </button>
  )

  const editTournament = (tournament) => {
    setEditingTournamentId(tournament._id)
    setSelectedTournamentId(tournament._id)
    setForm({
      name: tournament.name,
      subtitle: tournament.subtitle || '',
      shortLabel: tournament.shortLabel || '',
      season: tournament.season || '',
      plannedMatchCount: String(tournament.plannedMatchCount ?? ''),
      selectionMatchCount: String(tournament.selectionMatchCount ?? 1),
      scheduleUrl: tournament.scheduleUrl || '',
      status: tournament.status || 'draft',
      roundLabel: tournament.roundLabel || '',
      startDate: tournament.startDate || '',
      heroLogo: tournament.heroLogo || '',
      logoSet: tournament.logoSet || '',
      favicon: tournament.favicon || '',
      entryFee: String(tournament.entryFee ?? 10),
      longTermContribution: String(tournament.longTermContribution ?? ''),
    })
    setParticipantUserIds(tournament.participantUserIds?.map(String) ?? [])
    setMatchSelections(tournament.matchSelections ?? [])
    setStages(tournament.stages || [])
    setScoring({ exact: String(tournament.scoring?.exact ?? 10), near: String(tournament.scoring?.near ?? 5), winner: String(tournament.scoring?.winner ?? 3) })
    setTieBreakOrder(tournament.tieBreakOrder || ['exact', 'scored', 'noBet'])
    setTieBreakRules(tournament.tieBreakRules || [])
    setPayouts(Array.from({ length: 5 }, (_, index) => String(tournament.payouts?.find((item) => item.place === index + 1)?.amount ?? '')))
    setMessage('')
  }

  const startNewTournament = () => {
    setEditingTournamentId('')
    setParticipantUserIds([])
    setForm({ name: '', subtitle: '', shortLabel: '', season: '', plannedMatchCount: '', selectionMatchCount: '1', scheduleUrl: '', status: 'draft', roundLabel: '', startDate: '', heroLogo: '', logoSet: 'elh', favicon: '', entryFee: '10', longTermContribution: '' })
    setScoring({ exact: '10', near: '5', winner: '3' })
    setTieBreakOrder(['exact', 'scored', 'noBet'])
    setTieBreakRules([])
    setStages([])
    setPayouts(['', '', '', '', ''])
    setMessage('')
  }

  const currentAdminRound = [...matches]
    .filter((match) => new Date(match.startsAt).getTime() >= Date.now())
    .sort((a, b) => Number(a.round) - Number(b.round) || String(a.startsAt).localeCompare(String(b.startsAt)))[0]?.round

  if (!counts) return <p className="admin-panel-message admin-panel-loading">{message || 'Načítám admin přehled…'}</p>

  return (
    <section className="admin-panel" aria-label="Admin prostředí">
      <div className="admin-panel-heading">
        <h2>Admin prostředí</h2>
        <span>Přístup ověřen</span>
        <button type="button" className="panel-close-button" onClick={onClose} aria-label="Zavřít panel" title="Zavřít">×</button>
      </div>
      {message ? <p className="admin-panel-message">{message}</p> : null}
      <div className="admin-panel-stats">
        <span>Účty <strong>{counts.users}</strong></span>
        <span>Turnaje <strong>{counts.tournaments}</strong></span>
        <span>Zápasy <strong>{counts.matches}</strong></span>
        <span>Tipy <strong>{counts.tips}</strong></span>
      </div>
      <div className="admin-section">
        {sectionButton('basics', 'Základ turnaje')}
        {openSection === 'basics' ? (
          <>
          <form className="admin-tournament-form" onSubmit={createTournament}>
            <div className="admin-form-heading">
              <h3>{editingTournamentId ? 'Upravit vybraný turnaj' : 'Nový turnaj'}</h3>
              {editingTournamentId ? <button type="button" className="auth-button" onClick={startNewTournament}>Nový turnaj</button> : null}
            </div>
            <label className="admin-field">
              <span className="admin-field-label">Název turnaje</span>
              <input name="name" value={form.name} onChange={updateField} placeholder="Např. ELH play-off 2027" required />
              <small>Oficiální název, který se zobrazí v archivu a v hlavičce.</small>
            </label>
            <label className="admin-field">
              <span className="admin-field-label">Podnadpis na webu</span>
              <input name="subtitle" value={form.subtitle} onChange={updateField} placeholder="Např. Extraliga v ledním hokeji" maxLength={100} />
            </label>
            <label className="admin-field">
              <span className="admin-field-label">Krátké označení turnaje</span>
              <input name="shortLabel" value={form.shortLabel} onChange={updateField} placeholder="Např. ELH 2026/27" maxLength={60} />
              <small>Použije se v rozevíracím seznamu turnajů a v titulku záložky prohlížeče. Když zůstane prázdné, použije se název turnaje.</small>
            </label>
            <label className="admin-field">
              <span className="admin-field-label">Sezóna</span>
              <input name="season" value={form.season} onChange={updateField} placeholder="Např. 2026/27" />
              <small>Pomocné označení sezóny; může zůstat prázdné.</small>
            </label>
            <label className="admin-field">
              <span className="admin-field-label">Plánovaný počet zápasů</span>
              <input name="plannedMatchCount" type="number" min="0" step="1" value={form.plannedMatchCount} onChange={updateField} placeholder="Např. 52" />
              <small>Počet zápasů pro výpočet celkového vkladu hráče; lze kdykoli změnit.</small>
            </label>
            <label className="admin-field">
              <span className="admin-field-label">Počet vybíraných zápasů za kolo</span>
              <input name="selectionMatchCount" type="number" min="1" step="1" value={form.selectionMatchCount} onChange={updateField} required />
              <small>Pro ELH nastav 1. Hráč pak vybírá tento počet zápasů z každého kola.</small>
            </label>
            <label className="admin-field">
              <span className="admin-field-label">URL zdroje rozpisu zápasů</span>
              <input name="scheduleUrl" type="url" value={form.scheduleUrl} onChange={updateField} placeholder="https://www.hokej.cz/..." />
              <small>Zdroj, ze kterého později načteme aktuální rozpis včetně změn termínů.</small>
            </label>
            <div className="admin-tournament-form-row">
              <label className="admin-field"><span className="admin-field-label">Začátek turnaje</span><ManualDateInput name="startDate" value={form.startDate} onChange={(value) => setForm((current) => ({ ...current, startDate: value }))} title="Datum prvního zápasu turnaje." /></label>
              <label className="admin-field"><span className="admin-field-label">Logo turnaje</span><select name="heroLogo" value={form.heroLogo} onChange={updateField} title="Vyber obrázek ze složky public/tournaments."><option value="">Bez loga</option>{tournamentLogos.map((logo) => <option key={logo.path} value={logo.path}>{logo.name}</option>)}</select></label>
            </div>
            <p className="admin-field-help">Data slouží pro orientaci a zobrazení turnaje; nezakládají zápasy automaticky.</p>
            {form.heroLogo ? <img className="admin-tournament-logo-preview" src={form.heroLogo} alt="Náhled loga turnaje" /> : null}
            <div className="admin-tournament-form-row">
              <label className="admin-field"><span className="admin-field-label">Sada týmových log</span><select name="logoSet" value={form.logoSet} onChange={updateField} title="Určuje, odkud se načtou loga týmů v zápasech."><option value="">Bez sady log</option><option value="elh">ELH loga</option></select><small>Pro ELH zvol ELH loga; u mezinárodního turnaje použijeme vlajky.</small></label>
              <label className="admin-field"><span className="admin-field-label">Favicon (ikona v záložce)</span><select name="favicon" value={form.favicon} onChange={updateField} title="Ikona zobrazená v záložce prohlížeče."><option value="">Výchozí</option><option value="/icons/ball.svg">Fotbalový míč</option><option value="/icons/puck.svg">Hokejový puk</option></select><small>Změní se ikona v záložce, když je tenhle turnaj vybraný.</small></label>
            </div>
            <div className="admin-tournament-form-row">
              <label className="admin-field"><span className="admin-field-label">Stav turnaje</span><select name="status" value={form.status} onChange={updateField}><option value="draft">Připravovaný</option><option value="active">Aktivní</option><option value="finished">Ukončený</option></select><small>Aktivní turnaj je určený pro běžné používání.</small></label>
              <label className="admin-field"><span className="admin-field-label">Jednotka kola</span><input name="roundLabel" value={form.roundLabel} onChange={updateField} placeholder="den / kolo" title="Nezadává se datum. Zadej slovo den nebo kolo." required /><small>Zobrazení čísla kola, například 1. den nebo 1. kolo.</small></label>
            </div>
            <div className="admin-form-actions">
              <button type="submit" className="auth-submit" disabled={isBusy}>{isBusy ? 'Ukládám…' : editingTournamentId ? 'Uložit změny' : 'Založit turnaj'}</button>
              {editingTournamentId ? <button type="button" className="auth-button" onClick={() => setEditingTournamentId('')}>Zrušit</button> : null}
            </div>
          </form>
          <div className="admin-tournament-list">
            <h3>Existující turnaje</h3>
            {tournaments.length > 0 ? tournaments.map((tournament) => (
              <div className="admin-tournament-row" key={tournament._id}>
                <strong>{tournament.name}</strong>
                <span>{tournament.season || 'Bez sezóny'} · {tournament.status}</span>
                <div className="admin-row-actions">
                  <button type="button" className="auth-button" onClick={() => editTournament(tournament)}>Upravit</button>
                </div>
              </div>
            )) : <p className="admin-panel-note">Zatím nejsou založené žádné turnaje.</p>}
          </div>
          </>
        ) : null}
      </div>
      <div className="admin-section">
        {sectionButton('stages', 'Fáze turnaje')}
        {openSection === 'stages' ? (
          <div className="admin-tournament-form">
            <p className="admin-field-help">Každá fáze má vlastní interval Od–Do. Zápas se zařadí podle svého data a času.</p>
            {stages.map((stage, index) => (
              <div className="admin-stage-row" key={stage.id || `stage-${index}`}>
                <input value={stage.name || ''} onChange={(event) => setStages((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} placeholder="Název fáze" aria-label={`Název fáze ${index + 1}`} />
                <ManualDateTimeInput value={stage.from || ''} onChange={(value) => setStages((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, from: value } : item))} aria-label={`Začátek fáze ${index + 1}`} title="Začátek platnosti fáze." />
                <ManualDateTimeInput value={stage.to || ''} onChange={(value) => setStages((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, to: value } : item))} aria-label={`Konec fáze ${index + 1}`} title="Konec platnosti fáze." />
                <button type="button" className="auth-button is-danger" onClick={() => setStages((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Smazat</button>
              </div>
            ))}
            <div className="admin-form-actions">
              <button type="button" className="auth-button" onClick={() => setStages((current) => [...current, { id: `stage-${Date.now()}-${current.length}`, name: '', from: '' }])}>Přidat fázi</button>
              <button type="button" className="auth-submit" onClick={saveTournamentSettings} disabled={isBusy}>Uložit fáze</button>
            </div>
          </div>
        ) : null}
      </div>
      <div className="admin-section">
        {sectionButton('scoring', 'Bodování a pořadí')}
        {openSection === 'scoring' ? (
          <div className="admin-tournament-form">
            <p className="admin-field-help">Hodnoty se uloží k vybranému turnaji. Pořadí tie-breaků určuje, co rozhodne při shodě bodů.</p>
            <div className="admin-tournament-form-row">
              <label className="admin-field"><span className="admin-field-label">Přesný výsledek</span><input type="number" min="0" value={scoring.exact} onChange={(event) => setScoring((current) => ({ ...current, exact: event.target.value }))} /></label>
              <label className="admin-field"><span className="admin-field-label">Správný vítěz + skóre</span><input type="number" min="0" value={scoring.near} onChange={(event) => setScoring((current) => ({ ...current, near: event.target.value }))} /></label>
              <label className="admin-field"><span className="admin-field-label">Správný vítěz</span><input type="number" min="0" value={scoring.winner} onChange={(event) => setScoring((current) => ({ ...current, winner: event.target.value }))} /></label>
            </div>
            <label className="admin-field"><span className="admin-field-label">Tie-break pořadí</span><select value={tieBreakOrder.join(',')} onChange={(event) => setTieBreakOrder(event.target.value.split(',').filter(Boolean))}><option value="exact,scored,noBet">10b → bodované tipy → N/N</option><option value="scored,exact,noBet">bodované tipy → 10b → N/N</option><option value="exact,noBet,scored">10b → N/N → bodované tipy</option></select><small>Pořadí rozhodovacích pravidel při shodě bodů.</small></label>
            <button type="button" className="auth-submit" onClick={saveTournamentSettings} disabled={isBusy}>Uložit bodování</button>
          </div>
        ) : null}
      </div>
      <div className="admin-section">
        {sectionButton('money', 'Peníze a bank')}
        {openSection === 'money' ? (
          <div className="admin-tournament-form">
            <p className="admin-field-help">Nastavení platí pro vybraný turnaj. Výplaty lze zadat pro 1 až 5 míst; prázdná pozice se nepoužije.</p>
            <div className="admin-tournament-form-row">
              <label className="admin-field"><span className="admin-field-label">Vklad za zápas</span><input name="entryFee" type="number" min="0" value={form.entryFee} onChange={updateField} placeholder="10" /><small>Částka přidaná do banku za každého aktivního hráče.</small></label>
              <label className="admin-field"><span className="admin-field-label">Příspěvek do dlouhodobého banku</span><input name="longTermContribution" type="number" min="0" value={form.longTermContribution} onChange={updateField} placeholder="Volitelné" /><small>Jednorázový příspěvek hráče.</small></label>
            </div>
            <div className="admin-payout-grid">
              {payouts.map((amount, index) => (
                <label className="admin-field" key={`payout-${index}`}>
                  <span className="admin-field-label">{index + 1}. místo</span>
                  <input type="number" min="0" step="100" value={amount} onChange={(event) => setPayouts((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder="Neurčeno" />
                </label>
              ))}
            </div>
            <button type="button" className="auth-submit" onClick={saveTournamentSettings} disabled={isBusy}>Uložit peníze a bank</button>
          </div>
        ) : null}
      </div>
      <div className="admin-section">
        {sectionButton('rules', 'Pravidla')}
        {openSection === 'rules' ? (
          <div className="admin-tournament-form">
            <p className="admin-field-help">Textová pravidla se zobrazí v sekci Dlouhodobý bank. Maximálně pět pravidel pro jeden turnaj.</p>
            {tieBreakRules.map((rule, index) => (
              <div className="admin-stage-row" key={`rule-${index}`}>
                <input value={rule} onChange={(event) => setTieBreakRules((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder={`Pravidlo ${index + 1}`} aria-label={`Pravidlo ${index + 1}`} />
                <button type="button" className="auth-button is-danger" onClick={() => setTieBreakRules((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Smazat</button>
              </div>
            ))}
            <div className="admin-form-actions">
              <button type="button" className="auth-button" onClick={() => setTieBreakRules((current) => current.length < 5 ? [...current, ''] : current)} disabled={tieBreakRules.length >= 5}>Přidat pravidlo</button>
              <button type="button" className="auth-submit" onClick={saveTournamentSettings} disabled={isBusy}>Uložit pravidla</button>
            </div>
          </div>
        ) : null}
      </div>
      <div className="admin-section">
        {sectionButton('matches', 'Zápasy')}
        {openSection === 'matches' && tournaments.length > 0 ? (
          <>
          <form className="admin-tournament-form" onSubmit={createMatch}>
            <h3>{editingMatchId ? 'Upravit zápas' : 'Nový zápas'}</h3>
            <p className="admin-selected-context">Turnaj: {tournaments.find((tournament) => tournament._id === selectedTournamentId)?.name || 'není vybraný'}</p>
            <div className="admin-tournament-form-row">
              <input name="round" type="number" min="1" value={matchForm.round} onChange={updateMatchField} placeholder="Kolo" required />
              <ManualDateTimeInput name="startsAt" value={matchForm.startsAt} onChange={(value) => setMatchForm((current) => ({ ...current, startsAt: value }))} aria-label="Začátek zápasu" required />
              <select name="status" value={matchForm.status} onChange={updateMatchField}>
                <option value="draft">Připravovaný</option>
                <option value="open">Otevřený</option>
                <option value="locked">Uzamčený</option>
              </select>
            </div>
            <div className="admin-tournament-form-row">
              <input name="home" value={matchForm.home} onChange={updateMatchField} placeholder="Domácí tým" required />
              <input name="away" value={matchForm.away} onChange={updateMatchField} placeholder="Hostující tým" required />
              <label className="admin-score-field">
                <span className="admin-field-label">Výsledek (domácí : hosté)</span>
                <div className="player-tip-score admin-match-score" aria-label="Výsledek zápasu">
                  <input type="number" min="0" max="99" value={matchForm.score.split(':')[0] || ''} onChange={(event) => updateMatchScore('home', event.target.value)} aria-label={`Skóre domácího týmu ${matchForm.home || ''}`} placeholder="0" />
                  <span>:</span>
                  <input type="number" min="0" max="99" value={matchForm.score.split(':')[1] || ''} onChange={(event) => updateMatchScore('away', event.target.value)} aria-label={`Skóre hostujícího týmu ${matchForm.away || ''}`} placeholder="0" />
                </div>
              </label>
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
              <div className={`admin-tournament-row${Number(match.round) === Number(currentAdminRound) ? ' is-current-round' : ''}`} key={match._id}>
                <strong className="admin-match-summary"><span>{match.round}. kolo · {formatMatchDateTime(match.startsAt)}</span><span>{getTeamDisplayName(match.home)} – {getTeamDisplayName(match.away)}</span></strong>
                <span>
                  {match.status === 'open' ? 'otevřený' : match.status === 'locked' ? 'uzamčený' : match.status === 'evaluated' ? 'vyhodnocený' : 'připravovaný'}
                  {' · '}Bank {match.bank == null ? 'čeká na výsledek předchozího zápasu' : `${match.bank} Kč`} · {match.bankSource === 'automatic' ? 'automaticky' : 'ručně'}
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
        ) : openSection === 'matches' ? <p className="admin-panel-note">Nejdřív založ turnaj.</p> : null}
      </div>
      <div className="admin-section">
        {sectionButton('schedule', 'Rozpis turnaje')}
        {openSection === 'schedule' ? (
          <div className="admin-tournament-form">
            <p className="admin-field-help">Rozpis se načte ze zdroje uloženého v Základu turnaje. Import se ukládá odděleně a nepřepisuje soutěžní zápasy ani výběry hráčů.</p>
            {form.scheduleUrl ? (
              <div className="admin-form-actions">
                <button type="button" className="auth-button" onClick={() => window.open(form.scheduleUrl, '_blank', 'noopener,noreferrer')}>Otevřít zdroj</button>
                <button type="button" className="auth-submit" onClick={importSchedule} disabled={isImportingSchedule}>{isImportingSchedule ? 'Načítám…' : 'Načíst rozpis'}</button>
              </div>
            ) : <p className="admin-panel-note">Nejdřív ulož URL zdroje v Základu turnaje.</p>}
            {scheduleMatches.length > 0 ? (
              <div className="admin-schedule-list">
                {[...new Set(scheduleMatches.map((match) => Number(match.round)))].sort((a, b) => a - b).map((round) => (
                  <div className="admin-schedule-round" key={round}>
                    <strong>{round}. kolo</strong>
                    <div>{scheduleMatches.filter((match) => Number(match.round) === round).map((match) => {
                      const [date, time] = String(match.startsAt ?? '').split('T')
                      const [year, month, day] = date.split('-')
                      return <span className="admin-selection-match" key={match.sourceKey}>{getTeamDisplayName(match.home)} – {getTeamDisplayName(match.away)} · {day}-{month}-{year} {time}</span>
                    })}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="admin-section">
        {sectionButton('selections', 'Kdo vybírá zápas')}
        {openSection === 'selections' ? (
          <div className="admin-tournament-form">
            <p className="admin-field-help">Pořadí vychází z aktivních členů. Až hráč pošle výběr, založ zápas v sekci Zápasy; tady se pak automaticky zobrazí u příslušného kola.</p>
            {(() => {
              const activeUsers = users.filter((user) => user.status === 'active' && (participantUserIds.length === 0 || participantUserIds.includes(String(user._id))))
              const rounds = [...new Set(matches.map((match) => Number(match.round)).filter(Number.isFinite))].sort((a, b) => a - b)
              if (activeUsers.length === 0) return <p className="admin-panel-note">Nejdřív vyber členy turnaje.</p>
              const displayedRounds = rounds.length > 0 ? rounds : [1]
              const nextRound = rounds.length > 0 ? Math.max(...rounds) + 1 : 1
              return [...displayedRounds, ...(rounds.length > 0 ? [nextRound] : [])].map((round) => {
                const roundMatches = matches.filter((match) => Number(match.round) === round)
                const selector = activeUsers[(round - 1) % activeUsers.length]
                return (
                  <div className="admin-selection-row" key={round}>
                    <div className="admin-selection-meta">
                      <strong>{round}. kolo</strong>
                      <span>Na tahu: {selector.displayName || selector.username}</span>
                      <span>{roundMatches.length > 0 ? `Založeno zápasů: ${roundMatches.length}` : 'Čeká na výběr hráče'}</span>
                    </div>
                    {roundMatches.length > 0 ? <div className="admin-selection-options">{roundMatches.map((match) => <span className="admin-selection-match" key={match._id}>{getTeamDisplayName(match.home)} – {getTeamDisplayName(match.away)}</span>)}</div> : null}
                  </div>
                )
              })
            })()}
          </div>
        ) : null}
      </div>
      <div className="admin-section">
        {sectionButton('users', 'Účty')}
        {openSection === 'users' ? (
          <div className="admin-tournament-list">
            <p className="admin-panel-note">Zaškrtni hráče, kteří hrají právě vybraný turnaj. Výběr ovlivní počet hráčů a bank.</p>
            {users.map((user) => (
              <div className="admin-tournament-row" key={user._id}>
                <strong>{user.displayName || user.username}</strong>
                {participantMessages[String(user._id)] ? <span className={`admin-member-message${participantMessages[String(user._id)].isError ? ' is-error' : ''}`}>{participantMessages[String(user._id)].text}</span> : null}
                <span>{user.role === 'admin' ? 'admin' : 'hráč'} · {user.status} · {tipBreakdown.find((item) => item.username === user.username)?.count ?? 0} tipů</span>
                {user.status === 'active' ? (
                  <label className="admin-member-checkbox">
                    <input
                      type="checkbox"
                      checked={participantUserIds.length === 0 || participantUserIds.includes(String(user._id))}
                      onChange={() => toggleParticipant(String(user._id))}
                    />
                    <span>Hraje</span>
                  </label>
                ) : null}
                <button type="button" className="auth-button is-danger" onClick={() => deleteAccount(user)} disabled={isBusy}>Smazat účet</button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}
