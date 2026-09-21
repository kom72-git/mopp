import { useEffect, useRef, useState } from 'react'

function parsePeriods(text) {
  return text.split('\n').map((line) => {
    const [label, monthsText] = line.split(';').map((part) => part?.trim())
    const months = String(monthsText || '').split(',').map((month) => month.trim()).filter(Boolean)
    const isDateList = months.every((month) => /^\d{1,2}\.\d{1,2}\.$/.test(month) || /^\d{1,2}\.\d{1,2}\.\s*[–-]\s*\d{1,2}\.\d{1,2}\.$/.test(month))
    const generatedPeriodId = `period-${String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    return { id: isDateList ? generatedPeriodId : (months.join('-') || label), label, months }
  }).filter((period) => period.label && period.months.length > 0)
}

function getAdminTournamentStatus(tournament) {
  const start = new Date(tournament?.startDate || '').getTime()
  const end = new Date(tournament?.endDate || '').getTime()
  const now = Date.now()
  if (Number.isFinite(start) && now < start) return { key: 'draft', label: 'Připravuje se' }
  if (Number.isFinite(end) && now > end + 86400000 - 1) return { key: 'finished', label: 'Ukončeno' }
  if (Number.isFinite(start)) return { key: 'active', label: 'Probíhá' }
  return { key: 'draft', label: 'Připravuje se' }
}

function AutoResizeTextarea({ value, minRows = 3, ...props }) {
  const textareaRef = useRef(null)
  useEffect(() => {
    const node = textareaRef.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${node.scrollHeight}px`
  }, [value])
  return <textarea ref={textareaRef} value={value} rows={minRows} className="auto-resize-textarea" {...props} />
}

export default function FantasyAdminPanel({ onImported, onClose, initialTournamentId }) {
  const blankForm = { name: '', shortLabel: '', subtitle: 'Fantasy soutěž', season: '', startDate: '', endDate: '', fantasyMonths: '', tipsportPlayerCount: '', status: 'draft', heroLogo: '/fantasy.png', favicon: '', fantasyPeriodRankLabel: 'Měsíční', fantasyMoneyRules: { entryFee: '', entryFeeFrequency: 'monthly', payoutMode: 'period', longTermPool: '', longTermPoolFrequency: 'monthly', periodPayouts: '500;200', longTermPayouts: '' }, tieBreakRules: [] }
  const blankPeriodsText = 'Září;9\nŘíjen;10\nListopad;11\nProsinec;12\nLeden;1\nÚnor;2\nBřezen;3'
  const [tournaments, setTournaments] = useState([])
  const [users, setUsers] = useState([])
  const [tournamentLogos, setTournamentLogos] = useState([])
  const [selectedTournamentId, setSelectedTournamentId] = useState('')
  const [form, setForm] = useState(blankForm)
  const [rosterPlayers, setRosterPlayers] = useState([])
  const [entryFeePaidByPeriod, setEntryFeePaidByPeriod] = useState({})
  const [periodsText, setPeriodsText] = useState(blankPeriodsText)
  const [rounds, setRounds] = useState([])
  const [selectedRoundId, setSelectedRoundId] = useState('new')
  const [roundDate, setRoundDate] = useState('')
  const [scores, setScores] = useState({})
  const [tipsportNets, setTipsportNets] = useState({})
  const [tipsportDailyRanks, setTipsportDailyRanks] = useState({})
  const [awards, setAwards] = useState({ best: [] })
  const [payoutPeriodId, setPayoutPeriodId] = useState('')
  const [payouts, setPayouts] = useState({})
  const [message, setMessage] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [openSection, setOpenSection] = useState('')
  const [importForm, setImportForm] = useState({ url: 'https://docs.google.com/spreadsheets/d/17CcjDMYwl6Y2wy5SHqYB3qCZa4RNwOEZCF0GyXzht7s/edit?gid=168502812', name: 'Fantasy play-off 2026', season: '2025/26', roundStart: 'DC', roundEnd: 'EH' })
  const [importPreview, setImportPreview] = useState(null)
  const selectedTournament = tournaments.find((tournament) => tournament._id === selectedTournamentId)
  const players = rosterPlayers
  const periods = parsePeriods(periodsText)
  const payoutPeriods = [...periods, { id: 'all', label: 'Celkem' }]

  const loadTournaments = async () => {
    const response = await fetch('/api/admin/fantasy/tournaments', { credentials: 'include' })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.message || 'Fantasy turnaje se nepodařilo načíst')
    const nextTournaments = payload.tournaments ?? []
    setTournaments(nextTournaments)
    const preferredId = String(initialTournamentId || '').replace(/^db:/, '')
    const preferredExists = preferredId && nextTournaments.some((tournament) => tournament._id === preferredId)
    setSelectedTournamentId((current) => current || (preferredExists ? preferredId : '') || nextTournaments[0]?._id || '')
  }

  useEffect(() => {
    loadTournaments().catch((error) => setMessage(error.message))
    fetch('/api/admin/fantasy/users', { credentials: 'include' })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => setUsers(payload?.users ?? []))
      .catch(() => setUsers([]))
    fetch('/api/admin/assets/tournament-logos', { credentials: 'include' })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => setTournamentLogos(payload?.logos ?? []))
      .catch(() => setTournamentLogos([]))
  }, [])

  useEffect(() => {
    if (!selectedTournament) return
    setForm({ name: selectedTournament.name || '', shortLabel: selectedTournament.shortLabel || '', subtitle: selectedTournament.subtitle || 'Fantasy soutěž', season: selectedTournament.season || '', startDate: selectedTournament.startDate || '', endDate: selectedTournament.endDate || '', fantasyMonths: selectedTournament.fantasyMonths ?? '', tipsportPlayerCount: selectedTournament.tipsportPlayerCount ?? '', status: selectedTournament.status || 'draft', heroLogo: selectedTournament.heroLogo || '/fantasy.png', favicon: selectedTournament.favicon || '', fantasyPeriodRankLabel: selectedTournament.fantasyPeriodRankLabel || 'Měsíční', fantasyMoneyRules: { entryFee: selectedTournament.fantasyMoneyRules?.entryFee ?? '', entryFeeFrequency: selectedTournament.fantasyMoneyRules?.entryFeeFrequency || 'monthly', payoutMode: selectedTournament.fantasyMoneyRules?.payoutMode || 'period', longTermPool: selectedTournament.fantasyMoneyRules?.longTermPool ?? '', longTermPoolFrequency: selectedTournament.fantasyMoneyRules?.longTermPoolFrequency || 'monthly', periodPayouts: selectedTournament.fantasyMoneyRules?.periodPayouts ?? '500;200', longTermPayouts: selectedTournament.fantasyMoneyRules?.longTermPayouts ?? '' }, tieBreakRules: selectedTournament.tieBreakRules || [] })
  }, [selectedTournament?._id])

  useEffect(() => {
    if (!selectedTournamentId) return
    fetch(`/api/fantasy/data?tournamentId=db:${selectedTournamentId}`)
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!payload?.ok) return
        setRosterPlayers(payload.players ?? [])
        setEntryFeePaidByPeriod(Object.fromEntries((payload.players ?? []).map((player) => [player.nick, player.entryFeePaidByPeriod || {}])))
        const loadedPeriods = (payload.periods ?? []).filter((period) => period.id !== 'all')
        if (loadedPeriods.length > 0) setPeriodsText(loadedPeriods.map((period) => {
          if (!period.roundDates?.length) return `${period.label};${(period.months ?? []).join(',')}`
          const dates = period.roundDates
          const displayDates = dates.length > 1 ? `${dates[0]}–${dates.at(-1)}` : dates[0]
          return `${period.label};${displayDates}`
        }).join('\n'))
        const activePeriodId = payoutPeriodId || periods[0]?.id || 'all'
        setPayouts(Object.fromEntries((payload.players ?? []).map((player) => [player.nick, {
          prizeMoney: payload.prizeMoneyByPeriod?.[activePeriodId]?.[player.nick] ?? '',
          bestDailyRank: payload.tipsportStatsByPeriod?.[activePeriodId]?.[player.nick]?.bestDailyRank ?? '',
          bestPeriodRank: payload.tipsportStatsByPeriod?.[activePeriodId]?.[player.nick]?.bestPeriodRank ?? '',
          fantasyNets: payload.tipsportStatsByPeriod?.[activePeriodId]?.[player.nick]?.fantasyNets ?? '',
          longTermBank: payload.longTermBankByPeriod?.[activePeriodId]?.[player.nick] ?? '',
          finalFantasyRank: payload.seasonStats?.[player.nick]?.finalFantasyRank ?? '',
          finalFantasyNets: payload.seasonStats?.[player.nick]?.finalFantasyNets ?? '',
        }])))
      })
      .catch(() => {})
    fetch(`/api/admin/fantasy/tournaments/${selectedTournamentId}/rounds`, { credentials: 'include' })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!payload?.ok) return
        setRounds(payload.rounds ?? [])
      })
      .catch(() => {})
  }, [payoutPeriodId, selectedTournamentId])

  const selectRound = (roundId) => {
    setSelectedRoundId(roundId)
    if (roundId === 'new') {
      setRoundDate('')
      setScores({})
      setTipsportNets({})
      setTipsportDailyRanks({})
      setAwards({ best: [] })
      return
    }
    const round = rounds.find((item) => item._id === roundId)
    setRoundDate(round?.date || '')
    setScores(round?.scores || {})
    setTipsportNets(round?.tipsportNets || {})
    setTipsportDailyRanks(round?.tipsportDailyRanks || {})
    setAwards({ best: round?.awards?.best || [] })
  }

  const startNewTournament = () => {
    setSelectedTournamentId('')
    setForm(blankForm)
    setRosterPlayers([])
    setEntryFeePaidByPeriod({})
    setPeriodsText(blankPeriodsText)
    setOpenSection('season')
    setMessage('')
  }

  const createTournament = async (event) => {
    event?.preventDefault()
    if (selectedTournamentId) return
    setIsBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/admin/fantasy/tournaments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Fantasy turnaj se nepodařilo založit')
      await loadTournaments()
      setSelectedTournamentId(payload.tournament._id)
      setMessage(payload.message)
      notifyUpdated(payload.tournament._id)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setIsBusy(false)
    }
  }

  const saveTournament = async () => {
    if (!selectedTournamentId) return
    setIsBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/admin/fantasy/tournaments/${selectedTournamentId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Turnaj se nepodařilo uložit')
      await loadTournaments()
      setMessage(payload.message)
      notifyUpdated()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setIsBusy(false)
    }
  }

  const deleteTournament = async () => {
    if (!selectedTournamentId || !window.confirm('Smazat vybraný Fantasy turnaj?')) return
    setIsBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/admin/fantasy/tournaments/${selectedTournamentId}`, { method: 'DELETE', credentials: 'include' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Turnaj se nepodařilo smazat')
      setSelectedTournamentId('')
      await loadTournaments()
      setMessage(payload.message)
      notifyUpdated('')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setIsBusy(false)
    }
  }

  const savePlayers = async () => {
    if (!selectedTournamentId) return
    setIsBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/admin/fantasy/tournaments/${selectedTournamentId}/players`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ players: players.map((player) => ({ ...player, entryFeePaidByPeriod: entryFeePaidByPeriod[player.nick] || {} })) }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Hráče se nepodařilo uložit')
      setMessage(payload.message)
      notifyUpdated()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setIsBusy(false)
    }
  }

  const savePeriods = async () => {
    if (!selectedTournamentId) return
    setIsBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/admin/fantasy/tournaments/${selectedTournamentId}/periods`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ periods }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Období se nepodařilo uložit')
      setMessage(payload.message)
      notifyUpdated()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setIsBusy(false)
    }
  }

  const saveRound = async () => {
    if (!selectedTournamentId) return
    setIsBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/admin/fantasy/tournaments/${selectedTournamentId}/rounds`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ roundId: selectedRoundId === 'new' ? '' : selectedRoundId, date: roundDate, scores, tipsportNets, tipsportDailyRanks, awards }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Kolo se nepodařilo uložit')
      const roundsResponse = await fetch(`/api/admin/fantasy/tournaments/${selectedTournamentId}/rounds`, { credentials: 'include' })
      const roundsPayload = await roundsResponse.json().catch(() => ({}))
      if (roundsResponse.ok) setRounds(roundsPayload.rounds ?? [])
      setMessage(payload.message)
      notifyUpdated()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setIsBusy(false)
    }
  }

  const deleteRound = async () => {
    if (!selectedTournamentId || selectedRoundId === 'new' || !window.confirm('Smazat vybrané Fantasy kolo?')) return
    setIsBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/admin/fantasy/tournaments/${selectedTournamentId}/rounds/${selectedRoundId}`, { method: 'DELETE', credentials: 'include' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Kolo se nepodařilo smazat')
      const roundsResponse = await fetch(`/api/admin/fantasy/tournaments/${selectedTournamentId}/rounds`, { credentials: 'include' })
      const roundsPayload = await roundsResponse.json().catch(() => ({}))
      if (roundsResponse.ok) setRounds(roundsPayload.rounds ?? [])
      selectRound('new')
      setMessage(payload.message)
      notifyUpdated()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setIsBusy(false)
    }
  }

  const savePayouts = async () => {
    if (!selectedTournamentId) return
    setIsBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/admin/fantasy/tournaments/${selectedTournamentId}/payouts`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ periodId: payoutPeriodId || periods[0]?.id || 'all', payouts }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Výplaty se nepodařilo uložit')
      setMessage(payload.message)
      notifyUpdated()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setIsBusy(false)
    }
  }

  const sectionButton = (section, label) => (
    <button type="button" className="admin-section-toggle" onClick={() => setOpenSection((current) => current === section ? '' : section)} aria-expanded={openSection === section}>
      <span>{label}</span>
      <span aria-hidden="true">{openSection === section ? '−' : '+'}</span>
    </button>
  )

  const notifyUpdated = (tournamentId = selectedTournamentId) => onImported?.(tournamentId ? `db:${tournamentId}` : undefined)
  const updateMoneyRule = (key, value) => setForm((current) => ({ ...current, fantasyMoneyRules: { ...current.fantasyMoneyRules, [key]: value } }))
  const previewImport = async () => {
    setIsBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/admin/fantasy/import-preview', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: JSON.stringify(importForm) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Náhled se nepodařilo načíst')
      setImportPreview(payload)
      setMessage(`Náhled načten: ${payload.players.length} hráčů.`)
    } catch (error) { setMessage(error.message) } finally { setIsBusy(false) }
  }
  const confirmImport = async () => {
    if (!importPreview) return
    setIsBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/admin/fantasy/import-confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name: importForm.name, season: importForm.season, sourceUrl: importForm.url, data: importPreview }) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Archiv se nepodařilo importovat')
      await loadTournaments()
      setSelectedTournamentId(String(payload.tournamentId || '').replace(/^db:/, ''))
      setImportPreview(null)
      setMessage(payload.message)
      notifyUpdated(payload.tournamentId)
    } catch (error) { setMessage(error.message) } finally { setIsBusy(false) }
  }
  const publishTournament = async () => {
    if (!selectedTournamentId) return
    setIsBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/admin/fantasy/tournaments/${selectedTournamentId}/publish`, { method: 'POST', credentials: 'include' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Archiv se nepodařilo publikovat')
      await loadTournaments()
      setMessage(payload.message)
      notifyUpdated()
    } catch (error) { setMessage(error.message) } finally { setIsBusy(false) }
  }
  const addRegisteredPlayer = (userId) => {
    if (!userId || players.some((player) => player.userId === userId)) return
    const user = users.find((item) => item._id === userId)
    setRosterPlayers((current) => [...current, { id: userId, userId, name: user?.displayName || user?.username || '', nick: user?.username || user?.displayName || '', avatar: user?.avatar || '' }])
  }
  const addGuestPlayer = () => setRosterPlayers((current) => [...current, { id: `guest-${Date.now()}-${current.length}`, userId: '', name: 'Nový hráč', nick: 'novy-hrac', avatar: '' }])
  const updateRosterPlayer = (playerId, changes) => setRosterPlayers((current) => current.map((player) => player.id === playerId ? { ...player, ...changes } : player))
  const removeRosterPlayer = (playerId) => setRosterPlayers((current) => current.filter((player) => player.id !== playerId))

  return (
    <section className="admin-panel" aria-label="Fantasy admin prostředí">
      <div className="admin-panel-heading">
        <h2>Fantasy admin</h2>
        <span>Přístup ověřen</span>
        <button type="button" className="panel-close-button" onClick={onClose} aria-label="Zavřít panel" title="Zavřít">×</button>
      </div>
      <div className="admin-editing-banner">
        <label className="admin-editing-select">
          <span>Vybraný turnaj</span>
          <select value={selectedTournamentId} onChange={(event) => setSelectedTournamentId(event.target.value)}>
            {tournaments.length === 0 ? <option value="">Žádný turnaj</option> : null}
            {tournaments.map((tournament) => <option key={tournament._id} value={tournament._id}>{tournament.shortLabel || tournament.name}</option>)}
          </select>
        </label>
        {selectedTournament ? (
          <span className={`admin-editing-status is-${getAdminTournamentStatus(selectedTournament).key}`}>
            {getAdminTournamentStatus(selectedTournament).label}
          </span>
        ) : null}
        {selectedTournament && selectedTournament.published === false ? <button type="button" className="auth-button admin-editing-publish" onClick={publishTournament} disabled={isBusy}>Publikovat archiv</button> : null}
        <button type="button" className="auth-button is-danger admin-editing-delete" onClick={deleteTournament} disabled={isBusy || !selectedTournamentId}>Smazat</button>
      </div>
      {message ? <p className="admin-panel-message">{message}</p> : null}
      <div className="admin-tournament-actions">
        <span className="admin-tournament-actions-label">Akce turnaje</span>
        <button type="button" className="auth-button" onClick={startNewTournament} disabled={isBusy}>+ Nový turnaj</button>
        <button type="button" className="auth-button" onClick={() => setOpenSection('import')} disabled={isBusy}>Importovat</button>
      </div>
      {openSection === 'import' ? (
      <div className="admin-section admin-import-section">
        <div className="admin-section-heading-row">
          <h3>Importovat</h3>
          <button type="button" className="panel-close-button" onClick={() => setOpenSection('')} aria-label="Zavřít import" title="Zavřít">×</button>
        </div>
          <div className="admin-tournament-form">
            <p className="admin-field-help">Nejdřív se načte pouze náhled. Do databáze se archiv zapíše až po potvrzení.</p>
            <label className="admin-field"><span className="admin-field-label">Odkaz na Google Sheet</span><input value={importForm.url} onChange={(event) => setImportForm((current) => ({ ...current, url: event.target.value }))} /></label>
            <div className="admin-tournament-form-row">
              <label className="admin-field"><span className="admin-field-label">Název archivu</span><input value={importForm.name} onChange={(event) => setImportForm((current) => ({ ...current, name: event.target.value }))} /></label>
              <label className="admin-field"><span className="admin-field-label">Sezóna</span><input value={importForm.season} onChange={(event) => setImportForm((current) => ({ ...current, season: event.target.value }))} /></label>
            </div>
            <div className="admin-tournament-form-row">
              <label className="admin-field"><span className="admin-field-label">První sloupec kol</span><input value={importForm.roundStart} onChange={(event) => setImportForm((current) => ({ ...current, roundStart: event.target.value.toUpperCase() }))} placeholder="DC" /></label>
              <label className="admin-field"><span className="admin-field-label">Poslední sloupec kol</span><input value={importForm.roundEnd} onChange={(event) => setImportForm((current) => ({ ...current, roundEnd: event.target.value.toUpperCase() }))} placeholder="EH" /></label>
            </div>
            <small className="admin-field-help">Načtou se pouze datované výsledky z tohoto rozsahu. Pomocné sloupce mimo rozsah se ignorují.</small>
            <button type="button" className="auth-button" onClick={previewImport} disabled={isBusy}>Načíst náhled</button>
            {importPreview ? (
              <div className="admin-import-preview">
                <strong>Náhled: {importPreview.players.length} hráčů, {importPreview.rounds.length} kol</strong>
                <div className="admin-import-preview-table">
                  <div><strong>Hráč</strong><strong>Alias</strong><strong>NEJ denní</strong><strong>NEJ týdenní</strong><strong>Umístění</strong><strong>Nety</strong><strong>Výhra</strong></div>
                  {importPreview.players.map((player) => <div key={player.nick}><span>{player.name}</span><span>{player.nick}</span><span>{player.bestDailyRank ?? '-'}</span><span>{player.bestPeriodRank ?? '-'}</span><span>{player.finalFantasyRank ?? '-'}</span><span>{player.fantasyNets ?? 0}</span><span>{player.prizeMoney ?? 0} Kč</span></div>)}
                </div>
                <button type="button" className="auth-submit" onClick={confirmImport} disabled={isBusy}>Potvrdit import do DB</button>
              </div>
            ) : null}
          </div>
      </div>
      ) : null}
      <div className="admin-section">
        {sectionButton('season', 'Základ turnaje')}
        {openSection === 'season' ? (
        <form className="admin-tournament-form" onSubmit={(event) => event.preventDefault()}>
          {!selectedTournamentId ? <p className="admin-field-help">Zakládáš nový turnaj. Vyplň základní údaje a potom použij „Uložit nový turnaj“.</p> : <p className="admin-field-help">Upravuješ vybraný turnaj. Změny uložíš tlačítkem níže.</p>}
          <label className="admin-field"><span className="admin-field-label">Název</span><input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required /></label>
          <label className="admin-field"><span className="admin-field-label">Krátké označení turnaje</span><input value={form.shortLabel} onChange={(event) => setForm((current) => ({ ...current, shortLabel: event.target.value }))} placeholder="Např. ELH 2025/26" maxLength={60} /><small>Použije se v rozevíracím seznamu turnajů. Když zůstane prázdné, použije se název turnaje.</small></label>
          <label className="admin-field"><span className="admin-field-label">Podnadpis</span><input value={form.subtitle} onChange={(event) => setForm((current) => ({ ...current, subtitle: event.target.value }))} placeholder="Fantasy soutěž" maxLength={80} /></label>
          <label className="admin-field"><span className="admin-field-label">Sezóna</span><input value={form.season} onChange={(event) => setForm((current) => ({ ...current, season: event.target.value }))} /></label>
          <div className="admin-tournament-form-row">
            <label className="admin-field"><span className="admin-field-label">Začátek turnaje</span><input type="date" value={form.startDate} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} /></label>
            <label className="admin-field"><span className="admin-field-label">Konec turnaje</span><input type="date" value={form.endDate} onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))} title="Po tomto datu se turnaj automaticky označí jako ukončený." /></label>
          </div>
          <label className="admin-field"><span className="admin-field-label">Počet herních měsíců</span><input type="number" min="1" value={form.fantasyMonths} onChange={(event) => setForm((current) => ({ ...current, fantasyMonths: event.target.value }))} /></label>
          <label className="admin-field"><span className="admin-field-label">Počet Tipsport hráčů</span><input type="number" min="1" value={form.tipsportPlayerCount} onChange={(event) => setForm((current) => ({ ...current, tipsportPlayerCount: event.target.value }))} /><small>Celkový počet hráčů na Tipsportu, vůči kterému se zobrazí pořadí v grafu.</small></label>
          <div className="admin-tournament-form-row">
            <label className="admin-field"><span className="admin-field-label">Logo turnaje</span><select value={form.heroLogo} onChange={(event) => setForm((current) => ({ ...current, heroLogo: event.target.value }))}><option value="">Bez loga</option><option value="/fantasy.png">Fantasy</option>{tournamentLogos.map((logo) => <option key={logo.path} value={logo.path}>{logo.name}</option>)}</select></label>
            <label className="admin-field"><span className="admin-field-label">Favicon (ikona v záložce)</span><select value={form.favicon} onChange={(event) => setForm((current) => ({ ...current, favicon: event.target.value }))}><option value="">Výchozí</option><option value="/icons/puck.svg">Hokejový puk</option><option value="/icons/ball.svg">Fotbalový míč</option></select></label>
          </div>
          {form.heroLogo ? <img className="admin-tournament-logo-preview" src={form.heroLogo} alt="Náhled loga Fantasy turnaje" /> : null}
          <label className="admin-field"><span className="admin-field-label">Popisek období Tipsportu</span><select value={form.fantasyPeriodRankLabel} onChange={(event) => setForm((current) => ({ ...current, fantasyPeriodRankLabel: event.target.value }))}><option value="Měsíční">Měsíční</option><option value="Týdenní">Týdenní</option></select></label>
          <div className="admin-form-actions">
            <button type="button" className="auth-submit" onClick={selectedTournamentId ? saveTournament : createTournament} disabled={isBusy}>{selectedTournamentId ? 'Uložit změny' : 'Uložit nový turnaj'}</button>
          </div>
        </form>
        ) : null}
      </div>
      <div className="admin-section">
        {sectionButton('roster', 'Hráči a období')}
        {openSection === 'roster' ? (
        <div className="admin-tournament-form">
          <div className="admin-field">
            <span className="admin-field-label">Soupiska hráčů</span>
            <small>Tipsport alias se zapisuje u každého hráče vpravo.</small>
            <div className="fantasy-roster-list">
              {players.map((player) => (
                <div className="fantasy-roster-row" key={player.id || player.nick}>
                  <div className="fantasy-roster-player">
                    {player.avatar ? <img className="user-avatar fantasy-roster-avatar" src={player.avatar} alt="" /> : <span className="user-avatar fantasy-roster-avatar is-placeholder" aria-hidden="true">{String(player.name || '?').slice(0, 1).toUpperCase()}</span>}
                    <input value={player.name || ''} onChange={(event) => updateRosterPlayer(player.id, { name: event.target.value, nameOverride: true })} aria-label={`Jméno v turnaji pro ${player.nick || player.name}`} maxLength={60} disabled={Boolean(player.userId && selectedTournament?.status !== 'finished')} title={player.userId && selectedTournament?.status !== 'finished' ? 'Jméno propojeného hráče spravuje hráč ve svém účtu.' : undefined} />
                  </div>
                  <input value={player.nick || ''} onChange={(event) => updateRosterPlayer(player.id, { nick: event.target.value })} placeholder="Tipsport alias" aria-label={`Tipsport alias pro ${player.name}`} />
                  <button type="button" className="auth-button is-danger" onClick={() => removeRosterPlayer(player.id)} aria-label={`Odebrat ${player.name}`} title="Odebrat hráče">×</button>
                </div>
              ))}
              {players.length === 0 ? <small>Na soupisce zatím nejsou žádní hráči.</small> : null}
            </div>
            <div className="admin-form-actions">
              <select value="" onChange={(event) => addRegisteredPlayer(event.target.value)} aria-label="Přidat registrovaný účet">
                <option value="">+ registrovaný účet</option>
                {users.filter((user) => !players.some((player) => player.userId === user._id)).map((user) => <option key={user._id} value={user._id}>{user.displayName || user.username}</option>)}
              </select>
              <button type="button" className="auth-button" onClick={addGuestPlayer}>+ hráč bez účtu</button>
            </div>
          </div>
          <button type="button" className="auth-submit" onClick={savePlayers} disabled={isBusy || !selectedTournamentId}>Uložit soupisku</button>
          <label className="admin-field"><span className="admin-field-label">Období</span><AutoResizeTextarea value={periodsText} onChange={(event) => setPeriodsText(event.target.value)} minRows={4} placeholder="Únor & březen;2,3 nebo 1. týden;9.3., 10.3." /><small>Formát: název;měsíce nebo konkrétní data kol. Sloučení období: Únor & březen;2,3.</small></label>
          <button type="button" className="auth-submit" onClick={savePeriods} disabled={isBusy || !selectedTournamentId}>Uložit období</button>
        </div>
        ) : null}
      </div>
      <div className="admin-section">
        {sectionButton('money', 'Peníze a bank')}
        {openSection === 'money' ? (
        <div className="admin-tournament-form">
          {players.length > 0 && periods.length > 0 ? (
            <div className="admin-field">
              <span className="admin-field-label">Vstupné podle období</span>
              <small>Zaškrtni období, za které má hráč uhrazené vstupné. Pokud jsou dva měsíce sloučené do jednoho období (viz pole Měsíc v sekci Hráči a období), platí se za ně jedna společná platba.</small>
              <div className="admin-entry-fee-grid">
                {players.map((player) => (
                  <div className="admin-entry-fee-row" key={`fee-${player.nick}`}>
                    <strong>{player.name}</strong>
                    {periods.map((period) => (
                      <label className="admin-member-checkbox" key={`${player.nick}-${period.id}`}>
                        <input
                          type="checkbox"
                          checked={Boolean(entryFeePaidByPeriod[player.nick]?.[period.id])}
                          onChange={(event) => setEntryFeePaidByPeriod((current) => ({ ...current, [player.nick]: { ...current[player.nick], [period.id]: event.target.checked } }))}
                        />
                        <span>{period.label}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
              <button type="button" className="auth-submit" onClick={savePlayers} disabled={isBusy || !selectedTournamentId}>Uložit vstupné</button>
            </div>
          ) : null}
          <h3 className="admin-subsection-title">Krátkodobý bank</h3>
          <p className="admin-field-help">Částky výplat piš podle pořadí a odděl středníkem, např. 500;200.</p>
          <div className="admin-tournament-form-row">
            <label className="admin-field"><span className="admin-field-label">Vstupné hráče</span><input type="number" min="0" value={form.fantasyMoneyRules.entryFee} onChange={(event) => updateMoneyRule('entryFee', event.target.value)} /></label>
            <label className="admin-field"><span className="admin-field-label">Frekvence vstupného</span><select value={form.fantasyMoneyRules.entryFeeFrequency} onChange={(event) => updateMoneyRule('entryFeeFrequency', event.target.value)}><option value="monthly">Každý měsíc</option><option value="tournament">Za celé období</option></select></label>
          </div>
          <div className="admin-tournament-form-row">
            <label className="admin-field"><span className="admin-field-label">Vyplácené částky za období</span><input value={form.fantasyMoneyRules.periodPayouts} onChange={(event) => updateMoneyRule('periodPayouts', event.target.value)} placeholder="500;200" disabled={form.fantasyMoneyRules.payoutMode === 'longTerm'} /></label>
            <label className="admin-field"><span className="admin-field-label">Režim výplat</span><select value={form.fantasyMoneyRules.payoutMode} onChange={(event) => updateMoneyRule('payoutMode', event.target.value)}><option value="period">Výplaty za období</option><option value="longTerm">Jen dlouhodobý bank na konci</option></select></label>
          </div>
          <h3 className="admin-subsection-title">Dlouhodobý bank</h3>
          <div className="admin-tournament-form-row">
            <label className="admin-field"><span className="admin-field-label">Příspěvek do dlouhodobého banku</span><input type="number" min="0" value={form.fantasyMoneyRules.longTermPool} onChange={(event) => updateMoneyRule('longTermPool', event.target.value)} /></label>
            <label className="admin-field"><span className="admin-field-label">Frekvence příspěvku do banku</span><select value={form.fantasyMoneyRules.longTermPoolFrequency} onChange={(event) => updateMoneyRule('longTermPoolFrequency', event.target.value)}><option value="monthly">Každý měsíc</option><option value="tournament">Jednorázově za turnaj</option></select></label>
          </div>
          <div className="admin-tournament-form-row">
            <label className="admin-field"><span className="admin-field-label">Výplaty z dlouhodobého banku</span><input value={form.fantasyMoneyRules.longTermPayouts} onChange={(event) => updateMoneyRule('longTermPayouts', event.target.value)} placeholder="1100;500" /></label>
          </div>
          <button type="button" className="auth-submit" onClick={saveTournament} disabled={isBusy || !selectedTournamentId}>Uložit peníze a bank</button>
        </div>
        ) : null}
      </div>
      <div className="admin-section">
        {sectionButton('rules', 'Pravidla')}
        {openSection === 'rules' ? (
          <div className="admin-tournament-form">
            <p className="admin-field-help">Textová pravidla se zobrazí na stránce Fantasy. Maximálně pět pravidel pro jeden turnaj.</p>
            {(form.tieBreakRules || []).map((rule, index) => (
              <div className="admin-stage-row" key={`fantasy-rule-${index}`}>
                <input value={rule} onChange={(event) => setForm((current) => ({ ...current, tieBreakRules: current.tieBreakRules.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} placeholder={`Pravidlo ${index + 1}`} aria-label={`Pravidlo ${index + 1}`} />
                <button type="button" className="auth-button is-danger" onClick={() => setForm((current) => ({ ...current, tieBreakRules: current.tieBreakRules.filter((_, itemIndex) => itemIndex !== index) }))}>Smazat</button>
              </div>
            ))}
            <div className="admin-form-actions">
              <button type="button" className="auth-button" onClick={() => setForm((current) => ({ ...current, tieBreakRules: current.tieBreakRules.length < 5 ? [...current.tieBreakRules, ''] : current.tieBreakRules }))} disabled={(form.tieBreakRules || []).length >= 5}>Přidat pravidlo</button>
              <button type="button" className="auth-submit" onClick={saveTournament} disabled={isBusy || !selectedTournamentId}>Uložit pravidla</button>
            </div>
          </div>
        ) : null}
      </div>
      <div className="admin-section">
        {sectionButton('rounds', 'Zápis kol')}
        {openSection === 'rounds' ? (
        <div className="admin-tournament-form">
          <label className="admin-field"><span className="admin-field-label">Kolo</span><select value={selectedRoundId} onChange={(event) => selectRound(event.target.value)}><option value="new">Nové kolo</option>{rounds.map((round) => {
            const missing = players.filter((player) => String(round.scores?.[player.nick] ?? '').trim() === '').map((player) => player.name)
            return <option key={round._id} value={round._id}>{round.roundNumber}. kolo · {round.date}{missing.length ? ` · chybí ${missing.join(', ')}` : ''}</option>
          })}</select></label>
          <label className="admin-field"><span className="admin-field-label">Datum kola</span><input value={roundDate} onChange={(event) => setRoundDate(event.target.value)} placeholder="např. 9.9" /></label>
          {players.map((player) => <div className="admin-fantasy-payout-row" key={player.nick}>
            <span className="admin-fantasy-player-name"><strong>{player.name}</strong><small>{player.nick}</small></span>
            <label className="admin-member-checkbox"><input type="checkbox" checked={awards.best?.includes(player.nick)} onChange={(event) => setAwards((current) => ({ ...current, best: event.target.checked ? [...(current.best || []), player.nick] : (current.best || []).filter((nick) => nick !== player.nick) }))} /><span>Borec při shodě</span></label>
            <label className="admin-field"><span className="admin-field-label">Body</span><input value={scores[player.nick] ?? ''} onChange={(event) => setScores((current) => ({ ...current, [player.nick]: event.target.value }))} placeholder="body nebo N" /></label>
            <label className="admin-field"><span className="admin-field-label">Nety</span><input type="number" min="0" value={tipsportNets[player.nick] ?? ''} onChange={(event) => setTipsportNets((current) => ({ ...current, [player.nick]: event.target.value }))} /></label>
            <label className="admin-field"><span className="admin-field-label">Pořadí Tipsport</span><input type="number" min="1" value={tipsportDailyRanks[player.nick] ?? ''} onChange={(event) => setTipsportDailyRanks((current) => ({ ...current, [player.nick]: event.target.value }))} /></label>
          </div>)}
          <div className="admin-form-actions">
            <button type="button" className="auth-submit" onClick={saveRound} disabled={isBusy || !selectedTournamentId || !roundDate || players.length === 0}>Uložit kolo</button>
            <button type="button" className="auth-button is-danger" onClick={deleteRound} disabled={isBusy || selectedRoundId === 'new'}>Smazat kolo</button>
          </div>
          {selectedTournament ? <p className="admin-field-help">Vybraný turnaj: {selectedTournament.name}</p> : null}
        </div>
        ) : null}
      </div>
      <div className="admin-section">
        {sectionButton('payouts', 'Výhry a Tipsport')}
        {openSection === 'payouts' ? (
        <div className="admin-tournament-form">
          <label className="admin-field"><span className="admin-field-label">Období</span><select value={payoutPeriodId || periods[0]?.id || 'all'} onChange={(event) => setPayoutPeriodId(event.target.value)}>{payoutPeriods.map((period) => <option key={period.id} value={period.id}>{period.label}</option>)}</select></label>
          {(payoutPeriodId || periods[0]?.id || 'all') === 'all' ? (
            <p className="admin-field-help">Ve filtru „Celkem“ vyplň po skončení turnaje celkovou vyhranou částku z dlouhodobého banku dle konečného pořadí hráčů a konečné umístění + získané nety z Tipsportu opět po skončení turnaje.</p>
          ) : null}
          {players.map((player) => <div className="admin-fantasy-payout-row" key={player.nick}>
            <span className="admin-fantasy-player-name"><strong>{player.name}</strong><small>{player.nick}</small></span>
            {(payoutPeriodId || periods[0]?.id || 'all') === 'all' ? (
              <>
                <label className="admin-field"><span className="admin-field-label">Dlouhodobý bank</span><input type="number" min="0" value={payouts[player.nick]?.longTermBank ?? ''} onChange={(event) => setPayouts((current) => ({ ...current, [player.nick]: { ...current[player.nick], longTermBank: event.target.value } }))} /></label>
                <label className="admin-field"><span className="admin-field-label">Konečné umístění</span><input type="number" min="0" value={payouts[player.nick]?.finalFantasyRank ?? ''} onChange={(event) => setPayouts((current) => ({ ...current, [player.nick]: { ...current[player.nick], finalFantasyRank: event.target.value } }))} /></label>
                <label className="admin-field"><span className="admin-field-label">Konečné nety</span><input type="number" min="0" value={payouts[player.nick]?.finalFantasyNets ?? ''} onChange={(event) => setPayouts((current) => ({ ...current, [player.nick]: { ...current[player.nick], finalFantasyNets: event.target.value } }))} /></label>
              </>
            ) : (
              <>
                <label className="admin-field"><span className="admin-field-label">Výhra</span><input type="number" min="0" value={payouts[player.nick]?.prizeMoney ?? ''} onChange={(event) => setPayouts((current) => ({ ...current, [player.nick]: { ...current[player.nick], prizeMoney: event.target.value } }))} /></label>
                <label className="admin-field"><span className="admin-field-label">Nety</span><input type="number" value={payouts[player.nick]?.fantasyNets ?? ''} onChange={(event) => setPayouts((current) => ({ ...current, [player.nick]: { ...current[player.nick], fantasyNets: event.target.value } }))} /></label>
                <label className="admin-field"><span className="admin-field-label">Pořadí Tipsport</span><input type="number" min="0" value={payouts[player.nick]?.bestPeriodRank ?? ''} onChange={(event) => setPayouts((current) => ({ ...current, [player.nick]: { ...current[player.nick], bestPeriodRank: event.target.value } }))} /></label>
              </>
            )}
          </div>)}
          <button type="button" className="auth-submit" onClick={savePayouts} disabled={isBusy || !selectedTournamentId || players.length === 0}>Uložit výplaty</button>
        </div>
        ) : null}
      </div>
    </section>
  )
}
