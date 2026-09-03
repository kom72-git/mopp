import { useEffect, useState } from 'react'

function parsePlayers(text) {
  return text.split('\n').map((line) => {
    const [name, nick, paid] = line.split(';').map((part) => part?.trim())
    return { name, nick: nick || name, entryFeePaid: paid === '1' || String(paid).toLowerCase() === 'ano' }
  }).filter((player) => player.name)
}

function parsePeriods(text) {
  return text.split('\n').map((line) => {
    const [label, monthsText] = line.split(';').map((part) => part?.trim())
    const months = String(monthsText || '').split(',').map((month) => month.trim()).filter(Boolean)
    return { id: months.join('-') || label, label, months }
  }).filter((period) => period.label && period.months.length > 0)
}

export default function FantasyAdminPanel({ onImported, onClose }) {
  const [tournaments, setTournaments] = useState([])
  const [tournamentLogos, setTournamentLogos] = useState([])
  const [selectedTournamentId, setSelectedTournamentId] = useState('')
  const [form, setForm] = useState({ name: 'Fantasy ELH 2026/27', season: '2026/27', startDate: '', fantasyMonths: '', status: 'draft', heroLogo: '/fantasy.png', favicon: '', fantasyPeriodRankLabel: 'Měsíční', fantasyMoneyRules: { entryFee: '', periodPayouts: '500;200', longTermPool: '', longTermPayouts: '' }, tieBreakRules: [] })
  const [playersText, setPlayersText] = useState('')
  const [periodsText, setPeriodsText] = useState('Září;9\nŘíjen;10\nListopad;11\nProsinec;12\nLeden;1\nÚnor;2\nBřezen;3')
  const [rounds, setRounds] = useState([])
  const [selectedRoundId, setSelectedRoundId] = useState('new')
  const [roundDate, setRoundDate] = useState('')
  const [scores, setScores] = useState({})
  const [awards, setAwards] = useState({ best: [] })
  const [payoutPeriodId, setPayoutPeriodId] = useState('')
  const [payouts, setPayouts] = useState({})
  const [bankPayouts, setBankPayouts] = useState({})
  const [message, setMessage] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [openSection, setOpenSection] = useState('')
  const selectedTournament = tournaments.find((tournament) => tournament._id === selectedTournamentId)
  const players = parsePlayers(playersText)
  const periods = parsePeriods(periodsText)
  const payoutPeriods = [...periods, { id: 'all', label: 'Celkem' }]

  const loadTournaments = async () => {
    const response = await fetch('/api/admin/fantasy/tournaments', { credentials: 'include' })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.message || 'Fantasy turnaje se nepodařilo načíst')
    setTournaments(payload.tournaments ?? [])
    setSelectedTournamentId((current) => current || payload.tournaments?.[0]?._id || '')
  }

  useEffect(() => {
    loadTournaments().catch((error) => setMessage(error.message))
    fetch('/api/admin/assets/tournament-logos', { credentials: 'include' })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => setTournamentLogos(payload?.logos ?? []))
      .catch(() => setTournamentLogos([]))
  }, [])

  useEffect(() => {
    if (!selectedTournament) return
    setForm({ name: selectedTournament.name || '', season: selectedTournament.season || '', startDate: selectedTournament.startDate || '', fantasyMonths: selectedTournament.fantasyMonths ?? '', status: selectedTournament.status || 'draft', heroLogo: selectedTournament.heroLogo || '/fantasy.png', favicon: selectedTournament.favicon || '', fantasyPeriodRankLabel: selectedTournament.fantasyPeriodRankLabel || 'Měsíční', fantasyMoneyRules: { entryFee: selectedTournament.fantasyMoneyRules?.entryFee ?? '', periodPayouts: selectedTournament.fantasyMoneyRules?.periodPayouts ?? '500;200', longTermPool: selectedTournament.fantasyMoneyRules?.longTermPool ?? '', longTermPayouts: selectedTournament.fantasyMoneyRules?.longTermPayouts ?? '' }, tieBreakRules: selectedTournament.tieBreakRules || [] })
  }, [selectedTournament?._id])

  useEffect(() => {
    if (!selectedTournamentId) return
    fetch(`/api/fantasy/data?tournamentId=db:${selectedTournamentId}`)
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!payload?.ok) return
        setPlayersText((payload.players ?? []).map((player) => `${player.name};${player.nick};${player.entryFeePaid ? 1 : 0}`).join('\n'))
        const loadedPeriods = (payload.periods ?? []).filter((period) => period.id !== 'all')
        if (loadedPeriods.length > 0) setPeriodsText(loadedPeriods.map((period) => `${period.label};${(period.months ?? []).join(',')}`).join('\n'))
        const activePeriodId = payoutPeriodId || periods[0]?.id || 'all'
        setPayouts(Object.fromEntries((payload.players ?? []).map((player) => [player.nick, {
          prizeMoney: payload.prizeMoneyByPeriod?.[activePeriodId]?.[player.nick] ?? '',
          bestDailyRank: payload.tipsportStatsByPeriod?.[activePeriodId]?.[player.nick]?.bestDailyRank ?? '',
          bestPeriodRank: payload.tipsportStatsByPeriod?.[activePeriodId]?.[player.nick]?.bestPeriodRank ?? '',
          fantasyNets: payload.tipsportStatsByPeriod?.[activePeriodId]?.[player.nick]?.fantasyNets ?? '',
        }])))
        setBankPayouts(Object.fromEntries((payload.players ?? []).map((player) => [player.nick, { longTermBank: payload.longTermBankByPeriod?.all?.[player.nick] ?? '' }])))
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
      setAwards({ best: [] })
      return
    }
    const round = rounds.find((item) => item._id === roundId)
    setRoundDate(round?.date || '')
    setScores(round?.scores || {})
    setAwards({ best: round?.awards?.best || [] })
  }

  const createTournament = async (event) => {
    event.preventDefault()
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
        body: JSON.stringify({ players }),
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
        body: JSON.stringify({ roundId: selectedRoundId === 'new' ? '' : selectedRoundId, date: roundDate, scores, awards }),
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

  const saveBankPayouts = async () => {
    if (!selectedTournamentId) return
    setIsBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/admin/fantasy/tournaments/${selectedTournamentId}/payouts`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ periodId: 'all', payouts: bankPayouts }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Bank se nepodařilo uložit')
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

  return (
    <section className="admin-panel" aria-label="Fantasy admin prostředí">
      <div className="admin-panel-heading">
        <h2>Fantasy admin</h2>
        <span>Přístup ověřen</span>
        <button type="button" className="panel-close-button" onClick={onClose} aria-label="Zavřít panel" title="Zavřít">×</button>
      </div>
      {message ? <p className="admin-panel-message">{message}</p> : null}
      <div className="admin-section">
        {sectionButton('season', 'Základ turnaje')}
        {openSection === 'season' ? (
        <form className="admin-tournament-form" onSubmit={createTournament}>
          <label className="admin-field"><span className="admin-field-label">Název</span><input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required /></label>
          <label className="admin-field"><span className="admin-field-label">Sezóna</span><input value={form.season} onChange={(event) => setForm((current) => ({ ...current, season: event.target.value }))} /></label>
          <label className="admin-field"><span className="admin-field-label">Začátek turnaje</span><input type="date" value={form.startDate} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} /></label>
          <label className="admin-field"><span className="admin-field-label">Počet herních měsíců</span><input type="number" min="1" value={form.fantasyMonths} onChange={(event) => setForm((current) => ({ ...current, fantasyMonths: event.target.value }))} /></label>
          <div className="admin-tournament-form-row">
            <label className="admin-field"><span className="admin-field-label">Logo turnaje</span><select value={form.heroLogo} onChange={(event) => setForm((current) => ({ ...current, heroLogo: event.target.value }))}><option value="">Bez loga</option><option value="/fantasy.png">Fantasy</option>{tournamentLogos.map((logo) => <option key={logo.path} value={logo.path}>{logo.name}</option>)}</select></label>
            <label className="admin-field"><span className="admin-field-label">Favicon (ikona v záložce)</span><select value={form.favicon} onChange={(event) => setForm((current) => ({ ...current, favicon: event.target.value }))}><option value="">Výchozí</option><option value="/icons/puck.svg">Hokejový puk</option><option value="/icons/ball.svg">Fotbalový míč</option></select></label>
          </div>
          {form.heroLogo ? <img className="admin-tournament-logo-preview" src={form.heroLogo} alt="Náhled loga Fantasy turnaje" /> : null}
          <label className="admin-field"><span className="admin-field-label">Stav</span><select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}><option value="draft">Připravuje se</option><option value="active">Probíhá</option><option value="finished">Ukončeno</option></select></label>
          <label className="admin-field"><span className="admin-field-label">Popisek období Tipsportu</span><select value={form.fantasyPeriodRankLabel} onChange={(event) => setForm((current) => ({ ...current, fantasyPeriodRankLabel: event.target.value }))}><option value="Měsíční">Měsíční</option><option value="Týdenní">Týdenní</option></select></label>
          <div className="admin-form-actions">
            <button type="submit" className="auth-submit" disabled={isBusy}>Založit Fantasy turnaj</button>
            <button type="button" className="auth-button" onClick={saveTournament} disabled={isBusy || !selectedTournamentId}>Uložit vybraný</button>
            <button type="button" className="auth-button is-danger" onClick={deleteTournament} disabled={isBusy || !selectedTournamentId}>Smazat vybraný</button>
          </div>
          <label className="admin-field"><span className="admin-field-label">Fantasy turnaj</span><select value={selectedTournamentId} onChange={(event) => setSelectedTournamentId(event.target.value)}>{tournaments.map((tournament) => <option key={tournament._id} value={tournament._id}>{tournament.shortLabel || tournament.name}</option>)}</select></label>
          <label className="admin-field"><span className="admin-field-label">Hráči</span><textarea value={playersText} onChange={(event) => setPlayersText(event.target.value)} rows="5" placeholder="Jméno;nick;zaplaceno 0/1" /><small>Formát: Jméno;nick;0 nebo 1.</small></label>
          <button type="button" className="auth-submit" onClick={savePlayers} disabled={isBusy || !selectedTournamentId}>Uložit hráče</button>
          <label className="admin-field"><span className="admin-field-label">Měsíc</span><textarea value={periodsText} onChange={(event) => setPeriodsText(event.target.value)} rows="4" placeholder="Únor & březen;2,3" /><small>Formát: název;měsíce. Sloučení dvou měsíců: Únor & březen;2,3.</small></label>
          <button type="button" className="auth-submit" onClick={savePeriods} disabled={isBusy || !selectedTournamentId}>Uložit období</button>
        </form>
        ) : null}
      </div>
      <div className="admin-section">
        {sectionButton('money', 'Peníze a bank')}
        {openSection === 'money' ? (
        <div className="admin-tournament-form">
          <p className="admin-field-help">Částky výplat piš podle pořadí a odděl středníkem, např. 500;200.</p>
          <div className="admin-tournament-form-row">
            <label className="admin-field"><span className="admin-field-label">Měsíční příspěvek hráče</span><input type="number" min="0" value={form.fantasyMoneyRules.entryFee} onChange={(event) => updateMoneyRule('entryFee', event.target.value)} /></label>
            <label className="admin-field"><span className="admin-field-label">Vyplácené částky za období</span><input value={form.fantasyMoneyRules.periodPayouts} onChange={(event) => updateMoneyRule('periodPayouts', event.target.value)} placeholder="500;200" /></label>
          </div>
          <div className="admin-tournament-form-row">
            <label className="admin-field"><span className="admin-field-label">Měsíční příspěvek do dlouhodobého banku</span><input type="number" min="0" value={form.fantasyMoneyRules.longTermPool} onChange={(event) => updateMoneyRule('longTermPool', event.target.value)} /></label>
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
            <strong>{player.name}</strong>
            <label className="admin-field"><span className="admin-field-label">Body</span><input value={scores[player.nick] ?? ''} onChange={(event) => setScores((current) => ({ ...current, [player.nick]: event.target.value }))} placeholder="body nebo N" /></label>
            <label className="admin-member-checkbox"><input type="checkbox" checked={awards.best?.includes(player.nick)} onChange={(event) => setAwards((current) => ({ ...current, best: event.target.checked ? [...(current.best || []), player.nick] : (current.best || []).filter((nick) => nick !== player.nick) }))} /><span>Borec při shodě</span></label>
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
          {players.map((player) => <div className="admin-fantasy-payout-row" key={player.nick}>
            <strong>{player.name}</strong>
            <label className="admin-field"><span className="admin-field-label">Výhra</span><input type="number" min="0" value={payouts[player.nick]?.prizeMoney ?? ''} onChange={(event) => setPayouts((current) => ({ ...current, [player.nick]: { ...current[player.nick], prizeMoney: event.target.value } }))} /></label>
            <label className="admin-field"><span className="admin-field-label">Nety</span><input type="number" value={payouts[player.nick]?.fantasyNets ?? ''} onChange={(event) => setPayouts((current) => ({ ...current, [player.nick]: { ...current[player.nick], fantasyNets: event.target.value } }))} /></label>
            <label className="admin-field"><span className="admin-field-label">NEJ denní</span><input type="number" min="0" value={payouts[player.nick]?.bestDailyRank ?? ''} onChange={(event) => setPayouts((current) => ({ ...current, [player.nick]: { ...current[player.nick], bestDailyRank: event.target.value } }))} /></label>
            <label className="admin-field"><span className="admin-field-label">NEJ {form.fantasyPeriodRankLabel.toLowerCase()}</span><input type="number" min="0" value={payouts[player.nick]?.bestPeriodRank ?? ''} onChange={(event) => setPayouts((current) => ({ ...current, [player.nick]: { ...current[player.nick], bestPeriodRank: event.target.value } }))} /></label>
          </div>)}
          <button type="button" className="auth-submit" onClick={savePayouts} disabled={isBusy || !selectedTournamentId || players.length === 0}>Uložit výplaty</button>
          <label className="admin-field"><span className="admin-field-label">Dlouhodobý bank</span><small>Vyplňuje se až na konci turnaje.</small></label>
          {players.map((player) => <label className="admin-field" key={`bank-${player.nick}`}><span className="admin-field-label">{player.name}</span><input type="number" min="0" value={bankPayouts[player.nick]?.longTermBank ?? ''} onChange={(event) => setBankPayouts((current) => ({ ...current, [player.nick]: { longTermBank: event.target.value } }))} /></label>)}
          <button type="button" className="auth-submit" onClick={saveBankPayouts} disabled={isBusy || !selectedTournamentId || players.length === 0}>Uložit bank</button>
        </div>
        ) : null}
      </div>
    </section>
  )
}
