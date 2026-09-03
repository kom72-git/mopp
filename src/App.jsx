import { useEffect, useMemo, useRef, useState } from 'react'
import Cropper from 'react-easy-crop'
import './App.css'
import { matches as fallbackMatches, players as fallbackPlayers } from './data/moppData'
import { defaultTournamentId, getTournamentById, tournaments } from './data/tournaments'
import { getFlagUrl } from './data/countryFlags'
import { getTeamDisplayName, getTeamLogoUrl } from './data/teamLogos'
import AdminPanel from './components/AdminPanel'
import FantasyAdminPanel from './components/FantasyAdminPanel'
import FantasyOverview from './components/FantasyOverview'
import PlayerTipsPanel from './components/PlayerTipsPanel'

// Volitelny rucni bonus navic mimo vyhry ze zapasu.
// Tady pridej extra castky, ktere chces pricist k automatickemu souctu vyher.
const bonusWinningsByPlayerId = {
  p1: 0, // Kom
  p2: 0, // Kraty
  p3: 0, // Radek
  p4: 0, // Roman
  p5: 0, // Spaca
  p6: 0, // Slanec
  p7: 0, // Lada
  p8: 0, // Prd
  p9: 0, // Jony
  p10: 0, // Mirax
  p11: 0, // Honza
}

// Volitelne rucni korekce vyplat pro konkretni zapasy.
// Format: { matchId: { playerId: castka } }
const manualPayoutOverridesByMatchId = {
}

const chartColors = ['#2563eb', '#0ea5e9', '#06b6d4', '#14b8a6', '#22c55e', '#84cc16', '#eab308', '#f59e0b', '#f97316', '#a855f7', '#ec4899']

const emptyData = { players: [], matches: [] }

function getStoredTournamentId() {
  if (typeof window === 'undefined') return defaultTournamentId

  try {
    const queryTournamentId = new URLSearchParams(window.location.search).get('tournament')
    if (queryTournamentId) return queryTournamentId
    const storedTournamentId = window.localStorage.getItem('mopp-selected-tournament')
    if (/^db:[a-f0-9]{24}$/i.test(String(storedTournamentId ?? ''))) return storedTournamentId
    return getTournamentById(storedTournamentId)?.id ?? defaultTournamentId
  } catch {
    return defaultTournamentId
  }
}

function formatCount(count, one, few, many) {
  if (count === 1) return `${count} ${one}`
  if (count >= 2 && count <= 4) return `${count} ${few}`
  return `${count} ${many}`
}

function buildLiveSyncMessage(previousData, nextData) {
  const prevMatches = previousData?.matches ?? []
  const nextMatches = nextData?.matches ?? []
  const prevMatchesById = new Map(prevMatches.map((match) => [match.id, match]))

  let tipsChanged = 0

  for (const match of nextMatches) {
    const prevMatch = prevMatchesById.get(match.id)
    if (!prevMatch) {
      tipsChanged += (match.tips ?? []).length
      continue
    }

    const prevTipsByPlayer = new Map((prevMatch.tips ?? []).map((tip) => [tip.playerId, tip]))
    for (const tip of match.tips ?? []) {
      const prevTip = prevTipsByPlayer.get(tip.playerId)
      if (!prevTip || prevTip.pick !== tip.pick || prevTip.points !== tip.points) {
        tipsChanged += 1
      }
    }
  }

  if (tipsChanged === 0) {
    return 'Žádné tipy k synchronizaci. Data jsou aktuální.'
  }

  return `Synchronizace dokončena: upraveno ${formatCount(tipsChanged, 'tip', 'tipy', 'tipů')}.`
}

function pointsClass(points) {
  if (points === 10) return 'tip-pill is-exact'
  if (points === 5) return 'tip-pill is-near'
  if (points === 3) return 'tip-pill is-win'
  if (points === 0) return 'tip-pill is-miss'
  return 'tip-pill is-pending'
}

function formBlockClass(entry) {
  if (entry?.isNoBet) return 'is-no-bet'
  const points = entry?.points
  if (points === 10) return 'is-exact'
  if (points === 5) return 'is-near'
  if (points === 3) return 'is-win'
  if (points === 0) return 'is-miss'
  return 'is-pending'
}

function extractRound(match) {
  if (Number.isFinite(match?.round)) return match.round
  const matched = match?.startsAt?.match(/^(\d+)\./)
  return matched ? Number(matched[1]) : null
}

function formatRound(round, roundLabel = 'den') {
  return `${round}. ${roundLabel}`
}

function isTournamentActiveByDate(tournament) {
  if (tournament?.status === 'active') return true
  const startDate = tournament?.startDate
  if (!startDate) return false

  const now = new Date()
  const start = new Date(`${startDate}T00:00:00`)
  if (Number.isNaN(start.getTime())) return false
  return now >= start
}

function getTournamentStatus(tournament) {
  if (tournament?.status === 'finished') return { key: 'finished', label: 'Ukončeno' }

  const start = new Date(tournament?.firstMatchStartsAt || tournament?.startDate || '').getTime()
  if (Number.isFinite(start) && start > Date.now()) return { key: 'draft', label: 'Připravuje se' }
  if (tournament?.status === 'draft' && !Number.isFinite(start)) return { key: 'draft', label: 'Připravuje se' }
  if (tournament?.status === 'active') return { key: 'active', label: 'Probíhá' }
  return { key: 'finished', label: 'Ukončeno' }
}

function extractCalendarDate(startsAt) {
  const matched = startsAt?.match(/^\d+\.\s*\([^)]+\)\s*(\d{1,2}\.\d{1,2}\.)/)
  if (matched) return matched[1]

  const fallback = startsAt?.match(/(\d{1,2}\.\d{1,2}\.)/g)
  return fallback?.[fallback.length - 1] ?? null
}

function parseMatchDate(startsAt) {
  const matched = startsAt?.match(/(\d{1,2})\.(\d{1,2})\.\s*(\d{1,2}):(\d{2})/)
  if (!matched) return null

  const day = Number(matched[1])
  const month = Number(matched[2]) - 1
  const hour = Number(matched[3])
  const minute = Number(matched[4])
  return new Date(2026, month, day, hour, minute)
}

function parseStartsAtDisplay(startsAt, matchId, round, tournamentYear) {
  const isIsoDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(startsAt ?? ''))
  if (isIsoDate) {
    const date = new Date(startsAt)
    if (!Number.isNaN(date.getTime())) {
      const weekday = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'][date.getDay()]
      const weekdayShort = ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so'][date.getDay()]
      const pad = (n) => String(n).padStart(2, '0')
      return {
        roundLabel: Number.isFinite(Number(round)) ? `${round}.` : '',
        matchNo: '',
        dayName: weekday,
        dayShort: weekdayShort,
        rest: `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()} (${pad(date.getHours())}:${pad(date.getMinutes())})`,
      }
    }
  }

  const matched = startsAt?.match(/^(\d+\.)\s*\(([^)]+)\)\s*(.+)$/)
  if (!matched) {
    return {
      roundLabel: startsAt ?? '',
      matchNo: '',
      dayName: '',
      rest: '',
    }
  }

  const [, roundLabel, dayRaw, restRaw] = matched
  const dayToken = dayRaw.trim().toLowerCase()
  const dayNames = {
    po: 'pondělí',
    pondeli: 'pondělí',
    'pondělí': 'pondělí',
    ut: 'úterý',
    'út': 'úterý',
    utery: 'úterý',
    'úterý': 'úterý',
    st: 'středa',
    streda: 'středa',
    'středa': 'středa',
    ct: 'čtvrtek',
    'čt': 'čtvrtek',
    ctvrtek: 'čtvrtek',
    'čtvrtek': 'čtvrtek',
    pa: 'pátek',
    'pá': 'pátek',
    patek: 'pátek',
    'pátek': 'pátek',
    so: 'sobota',
    sobota: 'sobota',
    ne: 'neděle',
    nedele: 'neděle',
    'neděle': 'neděle',
  }

  const dayName = dayNames[dayToken] ?? dayRaw
  const dayShort = {
    pondělí: 'po',
    úterý: 'út',
    středa: 'st',
    čtvrtek: 'čt',
    pátek: 'pá',
    sobota: 'so',
    neděle: 'ne',
  }[dayName] ?? dayName
  const restDate = restRaw.trimStart().match(/^(\d{1,2}\.\d{1,2}\.)(.*)$/)
  const rest = restDate && tournamentYear
    ? (() => {
      const time = restDate[2].trim()
      return `${Number(restDate[1].split('.')[0])}.${Number(restDate[1].split('.')[1])}.${tournamentYear}${time ? ` (${time})` : ''}`
    })()
    : restRaw.trimStart()
  const matchNo = ''
  return {
    roundLabel,
    matchNo,
    dayName,
    dayShort,
    rest,
  }
}

function StartsAtLabel({ startsAt, matchId, round, tournamentYear }) {
  const parts = parseStartsAtDisplay(startsAt, matchId, round, tournamentYear)
  if (!parts.dayName) return <>{parts.roundLabel}</>

  return (
    <span className="starts-at-label">
      <strong className="starts-at-round">{parts.roundLabel}</strong>
      {' '}
    <span className="starts-at-day">{parts.dayShort}</span>
      <span className="starts-at-date">{parts.rest}</span>
    </span>
  )
}

function readAvatarSource(file) {
  return new Promise((resolve, reject) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      reject(new Error('Vyber obrázek JPEG, PNG nebo WebP.'))
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      reject(new Error('Původní obrázek může mít nejvýše 5 MB.'))
      return
    }

    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Obrázek se nepodařilo načíst.'))
    reader.readAsDataURL(file)
  })
}

function createCroppedAvatar(source, cropArea) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 160
      canvas.height = 160
      const context = canvas.getContext('2d')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, 160, 160)
      context.drawImage(image, cropArea.x, cropArea.y, cropArea.width, cropArea.height, 0, 0, 160, 160)
      resolve(canvas.toDataURL('image/jpeg', 0.82))
    }
    image.onerror = () => reject(new Error('Ořez obrázku se nepodařil.'))
    image.src = source
  })
}

function AuthPanel({ activeProduct, selectedTournamentId, selectedTournament, selectedFantasyTournament, fantasyRefreshKey = 0, onFantasyUpdated, onTournamentUpdated, onMatchesChanged, onTipUpdated }) {
  const [user, setUser] = useState(null)
  const [mode, setMode] = useState('login')
  const [isOpen, setIsOpen] = useState(false)
  const [activePanel, setActivePanel] = useState('')
  const [form, setForm] = useState({ usernameOrEmail: '', username: '', displayName: '', email: '', password: '', confirmPassword: '', resetToken: '' })
  const [accountForm, setAccountForm] = useState({ displayName: '', avatar: '', currentPassword: '', newPassword: '', confirmPassword: '' })
  const [avatarCropSource, setAvatarCropSource] = useState('')
  const [avatarCrop, setAvatarCrop] = useState({ x: 0, y: 0 })
  const [avatarZoom, setAvatarZoom] = useState(1)
  const [avatarCropPixels, setAvatarCropPixels] = useState(null)
  const [profileMessage, setProfileMessage] = useState('')
  const [message, setMessage] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [showPasswords, setShowPasswords] = useState(false)
  const [hasSelectionNotification, setHasSelectionNotification] = useState(false)
  const [pendingAccountNotificationCount, setPendingAccountNotificationCount] = useState(0)
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0)
  const [fantasyAccountPlayer, setFantasyAccountPlayer] = useState(null)
  const authPanelRef = useRef(null)

  useEffect(() => {
    const closePanelOnOutsideClick = (event) => {
      if (activePanel && !authPanelRef.current?.contains(event.target)) {
        setActivePanel('')
      }
    }
    document.addEventListener('pointerdown', closePanelOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closePanelOnOutsideClick)
  }, [activePanel])

  const refreshSelectionNotification = async () => {
    if (activeProduct !== 'tips' || !user || !selectedTournamentId) {
      setHasSelectionNotification(false)
      return
    }
    try {
      const response = await fetch(`/api/player/schedule?tournamentId=${encodeURIComponent(selectedTournamentId)}`, { credentials: 'include' })
      const payload = await response.json().catch(() => ({}))
      setHasSelectionNotification(response.ok && (payload.rounds ?? []).some((round) => round.canSelect))
    } catch {
      setHasSelectionNotification(false)
    }
  }

  useEffect(() => {
    refreshSelectionNotification()
  }, [activeProduct, user?.id, selectedTournamentId])

  useEffect(() => {
    if (user?.role !== 'admin') {
      setPendingAccountNotificationCount(0)
      return undefined
    }
    let cancelled = false
    const refreshPendingAccounts = async () => {
      try {
        const response = await fetch('/api/admin/overview', { credentials: 'include' })
        const payload = await response.json().catch(() => ({}))
        if (!cancelled) setPendingAccountNotificationCount(Number(payload.accountNotifications) || 0)
      } catch {
        if (!cancelled) setPendingAccountNotificationCount(0)
      }
    }
    refreshPendingAccounts()
    const intervalId = window.setInterval(refreshPendingAccounts, 30000)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [user?.id, user?.role])

  const markAccountNotificationsRead = async () => {
    try {
      await fetch('/api/admin/account-notifications/read', { method: 'POST', credentials: 'include' })
      setPendingAccountNotificationCount(0)
    } catch {
      return null
    }
  }

  const handleTournamentMembershipChanged = () => {
    setScheduleRefreshKey((current) => current + 1)
    refreshSelectionNotification()
  }

  useEffect(() => {
    const verificationToken = new URLSearchParams(window.location.search).get('verify')
    if (verificationToken) {
      fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token: verificationToken }),
      })
        .then((response) => response.json().then((payload) => ({ response, payload })))
        .then(({ response, payload }) => {
          if (!response.ok) throw new Error(payload.message || 'Ověření e-mailu se nepodařilo')
          setUser(payload.user)
          setMessage(payload.message)
          window.history.replaceState({}, '', window.location.pathname)
        })
        .catch((error) => setMessage(error.message))
      return undefined
    }

    fetch('/api/auth/me', { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => setUser(payload?.user ?? null))
      .catch(() => setUser(null))
  }, [])

  const updateField = (event) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  const updateAccountField = (event) => {
    setAccountForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  const updateAvatar = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setProfileMessage('')
    try {
      const source = await readAvatarSource(file)
      setAvatarCropSource(source)
      setAvatarCrop({ x: 0, y: 0 })
      setAvatarZoom(1)
      setAvatarCropPixels(null)
    } catch (error) {
      setProfileMessage(error.message)
    }
  }

  const applyAvatarCrop = async () => {
    if (!avatarCropSource || !avatarCropPixels) return
    setProfileMessage('')
    try {
      const avatar = await createCroppedAvatar(avatarCropSource, avatarCropPixels)
      setAccountForm((current) => ({ ...current, avatar }))
      setAvatarCropSource('')
    } catch (error) {
      setProfileMessage(error.message)
    }
  }

  const saveAccountProfile = async (event) => {
    event.preventDefault()
    setIsBusy(true)
    setProfileMessage('')
    try {
      const response = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ displayName: accountForm.displayName, avatar: accountForm.avatar }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Profil se nepodařilo uložit')
      setUser(payload.user)
      setProfileMessage(payload.message)
      await onTipUpdated?.()
    } catch (error) {
      setProfileMessage(error.message)
    } finally {
      setIsBusy(false)
    }
  }

  const changeAccountPassword = async (event) => {
    event.preventDefault()
    setIsBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(accountForm),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Heslo se nepodařilo změnit')
      setAccountForm((current) => ({ ...current, currentPassword: '', newPassword: '', confirmPassword: '' }))
      setMessage(payload.message)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setIsBusy(false)
    }
  }

  const submit = async (event) => {
    event.preventDefault()
    setIsBusy(true)
    setMessage('')

    try {
      const endpoint = mode === 'login'
        ? '/api/auth/login'
        : mode === 'register'
          ? '/api/auth/register'
          : mode === 'forgot'
            ? '/api/auth/forgot-password'
            : mode === 'verify'
              ? '/api/auth/verify-email'
            : '/api/auth/reset-password'
      const body = mode === 'login'
        ? { usernameOrEmail: form.usernameOrEmail, password: form.password }
        : mode === 'register'
          ? { ...form, displayName: form.displayName, username: form.email.split('@')[0] }
          : mode === 'forgot'
            ? { email: form.email }
            : { token: form.resetToken, password: form.password }
          if (mode === 'register' && form.password !== form.confirmPassword) {
            throw new Error('Hesla se neshodují.')
          }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Požadavek se nepodařil')
      if (mode === 'forgot') {
        if (payload.devResetToken) {
          setForm((current) => ({ ...current, resetToken: payload.devResetToken, password: '' }))
          setMode('reset')
          setMessage('Lokální resetovací odkaz je připravený. Nastav nové heslo.')
        } else {
          setMessage(payload.message)
        }
        return
      }
      if (mode === 'register' && payload.devVerificationToken) {
        setForm((current) => ({ ...current, resetToken: payload.devVerificationToken }))
        setMode('verify')
        setMessage('Lokální ověřovací odkaz je připravený. Klikni na ověření níže.')
        return
      }
      if (mode === 'register') {
        setMessage(payload.message || 'Účet byl založen. Na registrační e-mail jsme odeslali odkaz k ověření.')
        setMode('login')
        setForm((current) => ({ ...current, password: '' }))
        return
      }
      if (mode === 'verify') {
        setUser(payload.user)
        setIsOpen(false)
        await onTipUpdated?.()
        return
      }
      if (mode === 'reset') {
        setMode('login')
        setMessage('Heslo bylo změněno. Nyní se můžeš přihlásit.')
        setForm({ usernameOrEmail: '', username: '', displayName: '', email: '', password: '', confirmPassword: '', resetToken: '' })
        return
      }
      setUser(payload.user)
      setIsOpen(false)
      setForm({ usernameOrEmail: '', username: '', displayName: '', email: '', password: '', confirmPassword: '', resetToken: '' })
      await onTipUpdated?.()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setIsBusy(false)
    }
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    setUser(null)
    await onTipUpdated?.()
  }

  const paymentSummary = useMemo(() => {
    const plannedRounds = Number(selectedTournament?.plannedMatchCount ?? selectedTournament?.seasonMatchesCount ?? selectedTournament?.selectionMatchCount ?? 0)
    const entryFeePerMatch = Number(selectedTournament?.entryFee ?? selectedTournament?.entryFeePerMatch ?? 0)
    const longTermContribution = Number(selectedTournament?.longTermContribution ?? selectedTournament?.longTermBankContribution ?? 0)
    const total = plannedRounds * entryFeePerMatch + longTermContribution

    if (!Number.isFinite(plannedRounds) || !Number.isFinite(entryFeePerMatch) || !Number.isFinite(longTermContribution) || total <= 0) return null
    return { plannedRounds, entryFeePerMatch, longTermContribution, total }
  }, [selectedTournament])

  const tournamentMembership = useMemo(
    () => selectedTournament?.tournamentPlayers?.find((player) => player.userId === user?.id) ?? null,
    [selectedTournament, user?.id],
  )

  useEffect(() => {
    if (activeProduct !== 'fantasy' || !user || !selectedTournamentId?.startsWith('db:') || selectedFantasyTournament?.status === 'finished') {
      setFantasyAccountPlayer(null)
      return
    }
    let cancelled = false
    fetch(`/api/fantasy/data?tournamentId=${encodeURIComponent(selectedTournamentId)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (cancelled || !payload?.ok) return
        const names = [user.username, user.displayName].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
        setFantasyAccountPlayer((payload.players || []).find((player) => names.includes(String(player.nick || '').toLowerCase()) || names.includes(String(player.name || '').toLowerCase())) || null)
      })
      .catch(() => setFantasyAccountPlayer(null))
    return () => { cancelled = true }
  }, [activeProduct, fantasyRefreshKey, selectedFantasyTournament?.status, selectedTournamentId, user?.displayName, user?.id, user?.username])

  return (
    <div ref={authPanelRef} className={`auth-panel ${user ? 'is-authenticated' : 'is-guest'}`}>
      {user ? (
        <>
          <span className="auth-user">
            {user.avatar ? <img className="user-avatar user-avatar-nav" src={user.avatar} alt="" /> : <span className="user-avatar user-avatar-nav is-placeholder" aria-hidden="true">{(user.displayName || user.username).slice(0, 1).toUpperCase()}</span>}
            <span>{user.displayName || user.username}</span>
          </span>
          <div className="auth-panel-tabs">
            {activeProduct === 'tips' ? <button type="button" className={`auth-button auth-tips-button ${activePanel === 'tips' ? 'is-active' : ''}`} onClick={() => setActivePanel((current) => current === 'tips' ? '' : 'tips')}>Tipovat{hasSelectionNotification ? <img className="notification-bell" src="/icons/notifikace.png" alt="Jsi na řadě s výběrem zápasu" title="Jsi na řadě s výběrem zápasu" /> : null}</button> : null}
            <button type="button" className={`auth-button ${activePanel === 'account' ? 'is-active' : ''}`} onClick={() => { setActivePanel((current) => current === 'account' ? '' : 'account'); setAccountForm((current) => ({ ...current, displayName: user.displayName || '', avatar: user.avatar || '' })); setMessage('') }}>Účet</button>
            {user.role === 'admin' ? <button type="button" className={`auth-button auth-admin-button ${activePanel === 'admin' ? 'is-active' : ''}`} onClick={() => setActivePanel((current) => current === 'admin' ? '' : 'admin')}>Admin{pendingAccountNotificationCount > 0 ? <span className="admin-notification-badge" title={`${pendingAccountNotificationCount} nových hráčů`}><img className="notification-bell admin-notification-bell" src="/icons/notifikace.png" alt="" /><span>{pendingAccountNotificationCount}</span></span> : null}</button> : null}
          </div>
          <button type="button" className="auth-button auth-logout" onClick={logout}>Odhlásit</button>
          {activePanel === 'admin' && user.role === 'admin' && activeProduct === 'tips' ? <AdminPanel selectedTournamentId={selectedTournamentId} accountNotificationCount={pendingAccountNotificationCount} onAccountNotificationsRead={markAccountNotificationsRead} onTournamentMembershipChanged={handleTournamentMembershipChanged} onTournamentUpdated={onTournamentUpdated} onMatchesChanged={onMatchesChanged} onClose={() => setActivePanel('')} /> : null}
          {activePanel === 'admin' && user.role === 'admin' && activeProduct === 'fantasy' ? <FantasyAdminPanel onImported={onFantasyUpdated} onClose={() => setActivePanel('')} /> : null}
          {activePanel === 'tips' && activeProduct === 'tips' ? <PlayerTipsPanel selectedTournamentId={selectedTournamentId} scheduleRefreshKey={scheduleRefreshKey} hasSelectionNotification={hasSelectionNotification} onSelectionUpdated={() => setHasSelectionNotification(false)} onTipUpdated={onTipUpdated} onClose={() => setActivePanel('')} /> : null}
          {activePanel === 'account' ? (
            <div className="auth-form auth-account-form">
              <button type="button" className="panel-close-button" onClick={() => setActivePanel('')} aria-label="Zavřít panel" title="Zavřít">×</button>
              <form onSubmit={saveAccountProfile}>
                <h3>Můj profil</h3>
                <div className="avatar-editor">
                  {accountForm.avatar ? <img className="user-avatar user-avatar-preview" src={accountForm.avatar} alt="Náhled profilového obrázku" /> : <span className="user-avatar user-avatar-preview is-placeholder" aria-hidden="true">{(accountForm.displayName || user.username).slice(0, 1).toUpperCase()}</span>}
                  <div className="avatar-editor-actions">
                    <label className="auth-button avatar-file-button">Vybrat obrázek<input type="file" accept="image/jpeg,image/png,image/webp" onChange={updateAvatar} /></label>
                    {accountForm.avatar ? <button type="button" className="auth-button" onClick={() => setAccountForm((current) => ({ ...current, avatar: '' }))}>Odstranit</button> : null}
                  </div>
                </div>
                <label className="account-name-field">
                  <span>Změna jména</span>
                  <input name="displayName" value={accountForm.displayName} onChange={updateAccountField} placeholder="Zobrazované jméno" maxLength={60} required />
                </label>
                <button type="submit" className="auth-submit" disabled={isBusy}>Uložit profil</button>
                {profileMessage ? <p className="auth-message" role="alert">{profileMessage}</p> : null}
              </form>
              {activeProduct === 'tips' && String(selectedTournamentId ?? '').startsWith('db:') ? (
                <form>
                  <h3>Vstupné</h3>
                  <div className="account-payment-status">
                    <div className="account-payment-status-head">
                      <span className="account-payment-status-label">{selectedTournament?.title || selectedTournament?.label || 'Vybraný turnaj'}</span>
                      <span className={`player-entry-fee-badge${tournamentMembership?.entryFeePaid ? '' : ' is-pending'}`}>
                        {tournamentMembership ? (tournamentMembership.entryFeePaid ? 'Uhrazeno' : 'Neuhrazeno') : 'Nejsi v soupisce'}
                      </span>
                    </div>
                    {paymentSummary ? (
                      <div className="payment-summary-grid" aria-live="polite">
                        <span><strong>Počet kol:</strong> {paymentSummary.plannedRounds}</span>
                        <span><strong>Vklad / kolo:</strong> {paymentSummary.entryFeePerMatch} Kč</span>
                        <span><strong>Dlouhodobý bank:</strong> {paymentSummary.longTermContribution} Kč</span>
                        <span><strong>Celkem:</strong> {paymentSummary.total} Kč</span>
                      </div>
                    ) : null}
                  </div>
                </form>
              ) : null}
              {activeProduct === 'fantasy' && fantasyAccountPlayer ? (
                <form>
                  <h3>Vstupné</h3>
                  <div className="account-payment-status">
                    <div className="account-payment-status-head">
                      <span className="account-payment-status-label">{selectedFantasyTournament?.title || selectedFantasyTournament?.label || 'Fantasy turnaj'}</span>
                      <span className={`player-entry-fee-badge${fantasyAccountPlayer.entryFeePaid ? '' : ' is-pending'}`}>{fantasyAccountPlayer.entryFeePaid ? 'Uhrazeno' : 'Neuhrazeno'}</span>
                    </div>
                  </div>
                </form>
              ) : null}
              <form onSubmit={changeAccountPassword}>
                <h3>Změna hesla</h3>
                <input name="currentPassword" type="password" value={accountForm.currentPassword} onChange={updateAccountField} placeholder="Současné heslo" autoComplete="current-password" required />
                <input name="newPassword" type="password" value={accountForm.newPassword} onChange={updateAccountField} placeholder="Nové heslo" autoComplete="new-password" required />
                <input name="confirmPassword" type="password" value={accountForm.confirmPassword} onChange={updateAccountField} placeholder="Nové heslo znovu" autoComplete="new-password" required />
                <button type="submit" className="auth-submit" disabled={isBusy}>Změnit heslo</button>
                {message ? <p className="auth-message" role="alert">{message}</p> : null}
              </form>
              {avatarCropSource ? (
                <div className="avatar-crop-dialog" role="dialog" aria-modal="true" aria-label="Upravit profilový obrázek">
                  <div className="avatar-crop-card">
                    <div className="avatar-crop-head">
                      <h3>Upravit obrázek</h3>
                      <button type="button" className="panel-close-button" onClick={() => setAvatarCropSource('')} aria-label="Zrušit ořez">×</button>
                    </div>
                    <div className="avatar-crop-stage">
                      <Cropper
                        image={avatarCropSource}
                        crop={avatarCrop}
                        zoom={avatarZoom}
                        aspect={1}
                        cropShape="round"
                        showGrid={false}
                        onCropChange={setAvatarCrop}
                        onZoomChange={setAvatarZoom}
                        onCropComplete={(_, croppedAreaPixels) => setAvatarCropPixels(croppedAreaPixels)}
                      />
                    </div>
                    <label className="avatar-zoom-control">
                      <span>Přiblížení</span>
                      <input type="range" min="1" max="3" step="0.01" value={avatarZoom} onChange={(event) => setAvatarZoom(Number(event.target.value))} />
                    </label>
                    <div className="avatar-crop-actions">
                      <button type="button" className="auth-button" onClick={() => setAvatarCropSource('')}>Zrušit</button>
                      <button type="button" className="auth-submit" onClick={applyAvatarCrop} disabled={!avatarCropPixels}>Použít</button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <button type="button" className="auth-button" onClick={() => { setIsOpen((current) => !current); setMessage('') }}>
            {isOpen ? 'Zavřít' : 'Přihlásit se'}
          </button>
          {isOpen ? (
            <form className="auth-form" onSubmit={submit}>
              {mode !== 'reset' && mode !== 'verify' ? (
                <div className="auth-mode-tabs">
                  <button type="button" className={mode === 'login' ? 'is-active' : ''} onClick={() => { setMode('login'); setMessage('') }}>Přihlášení</button>
                  <button type="button" className={mode === 'register' ? 'is-active' : ''} onClick={() => { setMode('register'); setMessage('') }}>Registrace</button>
                </div>
              ) : null}
              {mode === 'verify' ? (
                <input name="resetToken" value={form.resetToken} onChange={updateField} placeholder="Ověřovací token" required />
              ) : mode === 'register' ? (
                <>
                  <input name="displayName" value={form.displayName} onChange={updateField} placeholder="Zobrazované jméno" aria-label="Zobrazované jméno" title="Jméno, které se zobrazí u tvých tipů a v pořadí hráčů." autoComplete="name" required />
                  <small className="auth-form-help">Toto jméno uvidí ostatní hráči. Přihlašovat se budeš e-mailem.</small>
                  <input name="email" type="email" value={form.email} onChange={updateField} placeholder="E-mail" autoComplete="email" required />
                </>
              ) : mode === 'forgot' ? (
                <input name="email" type="email" value={form.email} onChange={updateField} placeholder="E-mail pro obnovu hesla" autoComplete="email" required />
              ) : mode === 'reset' ? (
                <input name="password" type="password" value={form.password} onChange={updateField} placeholder="Nové heslo" autoComplete="new-password" required />
              ) : (
                <input name="usernameOrEmail" value={form.usernameOrEmail} onChange={updateField} placeholder="E-mail" aria-label="E-mail" autoComplete="email" required />
              )}
              {mode === 'login' || mode === 'register' ? (
                <>
                  <input name="password" type={mode === 'register' && showPasswords ? 'text' : 'password'} value={form.password} onChange={updateField} placeholder="Heslo" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
                  {mode === 'register' ? (
                    <>
                      <input name="confirmPassword" type={showPasswords ? 'text' : 'password'} value={form.confirmPassword} onChange={updateField} placeholder="Heslo znovu" autoComplete="new-password" required />
                      <label className="auth-password-toggle"><input type="checkbox" checked={showPasswords} onChange={(event) => setShowPasswords(event.target.checked)} aria-label="Zobrazit hesla" /> Zobrazit hesla</label>
                    </>
                  ) : null}
                </>
              ) : null}
              {message ? <p className="auth-message" role="alert">{message}</p> : null}
              <button type="submit" className="auth-submit" disabled={isBusy}>{isBusy ? 'Pracuji…' : mode === 'login' ? 'Přihlásit' : mode === 'register' ? 'Vytvořit účet' : mode === 'forgot' ? 'Obnovit heslo' : mode === 'verify' ? 'Ověřit e-mail' : 'Nastavit nové heslo'}</button>
              {mode === 'login' ? (
                <button type="button" className="auth-link" onClick={() => { setMode('forgot'); setMessage('') }}>Zapomenuté heslo?</button>
              ) : null}
            </form>
          ) : null}
        </>
      )}
    </div>
  )
}

function getStageLabel(match, stageRules = [], stageTransitions = [], stages = []) {
  const round = extractRound(match)
  const startsAt = match?.startsAt
  const parsedDate = parseMatchDate(startsAt) ?? (startsAt ? new Date(startsAt) : null)
  const date = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : new Date()

  if (date && !Number.isNaN(date.getTime()) && Array.isArray(stages) && stages.length > 0) {
    const configuredStages = stages
      .map((stage) => ({
        label: stage?.name,
        fromDate: stage?.from ? new Date(stage.from) : null,
        toDate: stage?.to ? new Date(stage.to) : null,
      }))
      .filter((stage) => stage.label && stage.fromDate && !Number.isNaN(stage.fromDate.getTime()))
      .sort((a, b) => a.fromDate - b.fromDate)
    if (configuredStages.length > 0) {
      const activeStage = configuredStages.find((stage) => date >= stage.fromDate && (!stage.toDate || date <= stage.toDate))
      return activeStage?.label ?? configuredStages[configuredStages.length - 1].label
    }
  }

  if (date && Array.isArray(stageTransitions) && stageTransitions.length > 0) {
    const transitions = stageTransitions
      .map((item) => ({
        label: item?.label,
        fromDate: item?.from ? new Date(item.from) : null,
      }))
      .filter((item) => item.label && item.fromDate && !Number.isNaN(item.fromDate.getTime()))
      .sort((a, b) => a.fromDate.getTime() - b.fromDate.getTime())

    if (transitions.length > 0) {
      let activeLabel = transitions[0].label
      for (const transition of transitions) {
        if (date >= transition.fromDate) {
          activeLabel = transition.label
        } else {
          break
        }
      }
      return activeLabel
    }
  }

  if (Number.isFinite(round) && Array.isArray(stageRules) && stageRules.length > 0) {
    const matchedRule = stageRules.find((rule) => Number.isFinite(rule?.maxRound) && round <= rule.maxRound)
    if (matchedRule?.label) return matchedRule.label
  }

  if (!date) return 'Skupinová fáze'

  const groupEnd = new Date(2026, 5, 28, 4, 0)
  const round16End = new Date(2026, 6, 4, 3, 30)
  const round8End = new Date(2026, 6, 7, 22, 0)
  const quarterEnd = new Date(2026, 6, 12, 3, 0)

  if (date <= groupEnd) return 'Skupinová fáze'
  if (date <= round16End) return 'Šestnáctifinále'
  if (date <= round8End) return 'Osmifinále'
  if (date <= quarterEnd) return 'Čtvrtfinále'
  if (date.getMonth() === 6 && (date.getDate() === 14 || date.getDate() === 15)) return 'Semifinále'
  if (date.getMonth() === 6 && date.getDate() === 18) return 'O 3. místo'
  if (date.getMonth() === 6 && date.getDate() === 19) return 'Finále'

  return 'Skupinová fáze'
}

function parseScore(score) {
  if (!score || score === '--:--') return { home: null, away: null, isDraw: false, winner: null }

  const [homeRaw, awayRaw] = String(score).split(':')
  const home = Number(homeRaw)
  const away = Number(awayRaw)
  if (!Number.isFinite(home) || !Number.isFinite(away)) {
    return { home: null, away: null, isDraw: false, winner: null }
  }

  const isDraw = home === away
  const winner = isDraw ? null : home > away ? 'home' : 'away'

  return { home, away, isDraw, winner }
}

function parseTipValue(value) {
  if (!value || value === '-') return { home: '-', away: '-' }

  const [homeRaw = '', awayRaw = ''] = String(value).split(':')
  const normalize = (token) => {
    const trimmed = token.trim()
    if (!trimmed) return '-'
    if (/^n$/i.test(trimmed)) return 'N'
    if (/^-?\d+$/.test(trimmed)) return trimmed
    return '-'
  }

  return {
    home: normalize(homeRaw),
    away: normalize(awayRaw),
  }
}

function isNoBetPick(pick) {
  return /^\s*n\s*:\s*n\s*$/i.test(String(pick ?? ''))
}

function pickToOutcome(pick) {
  const { home, away } = parseTipValue(pick)
  if (home === '-' || away === '-') return ''
  if (String(home).toUpperCase() === 'N' || String(away).toUpperCase() === 'N') return ''

  const homeGoals = Number(home)
  const awayGoals = Number(away)
  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return ''

  if (homeGoals > awayGoals) return '1'
  if (homeGoals < awayGoals) return '2'
  return 'X'
}

function isOneGoalOffPick(pick, score) {
  const parsedScore = parseScore(score)
  if (!Number.isFinite(parsedScore.home) || !Number.isFinite(parsedScore.away)) return false
  if (!pick || pick === '-' || isNoBetPick(pick)) return false

  const { home, away } = parseTipValue(pick)
  const homeGoals = Number(home)
  const awayGoals = Number(away)
  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return false

  const totalMiss = Math.abs(homeGoals - parsedScore.home) + Math.abs(awayGoals - parsedScore.away)
  return totalMiss === 1
}

function formatTipUpdatedAt(updatedAt) {
  if (!updatedAt) return ''

  const shortMatch = String(updatedAt).trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2})$/)
  if (shortMatch) {
    const [, , month, day, time] = shortMatch
    return `${day}. ${month}. ${time}`
  }

  const date = new Date(updatedAt)
  if (Number.isNaN(date.getTime())) {
    return String(updatedAt).trim()
  }

  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${day}.${month}. ${hour}:${minute}`
}

function formatTipNote(updatedAt, updatedState, updatedByUsername) {
  if (!updatedAt) return ''
  const actionLabel = updatedState === 'adminUpdated'
    ? `upraveno adminem${updatedByUsername ? ` (${updatedByUsername})` : ''}`
    : updatedState === 'updated' ? 'upraveno' : 'vloženo'
  return `${actionLabel}: ${formatTipUpdatedAt(updatedAt)}`
}

function toTipTimestampMs(value) {
  const text = String(value ?? '').trim()
  if (!text) return Number.NaN

  const shortMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/)
  if (shortMatch) {
    const [, year, month, day, hour, minute] = shortMatch
    const parsed = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
    ).getTime()
    return Number.isFinite(parsed) ? parsed : Number.NaN
  }

  const parsed = Number(new Date(text))
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function comparePlayersByTieBreak(a, b, statsByPlayer, fallbackOrder, tieBreakOrder = []) {
  const pointsDiff = (Number(b.points) || 0) - (Number(a.points) || 0)
  if (pointsDiff !== 0) return pointsDiff

  const aStats = statsByPlayer.get(a.id) ?? {}
  const bStats = statsByPlayer.get(b.id) ?? {}
  for (const criterion of tieBreakOrder) {
    if (criterion === 'exact') {
      const diff = (Number(bStats.exact) || 0) - (Number(aStats.exact) || 0)
      if (diff !== 0) return diff
    }
    if (criterion === 'scored') {
      const diff = (Number(bStats.scored) || 0) - (Number(aStats.scored) || 0)
      if (diff !== 0) return diff
    }
    if (criterion === 'noBet') {
      const diff = (Number(aStats.noBet) || 0) - (Number(bStats.noBet) || 0)
      if (diff !== 0) return diff
    }
  }

  return (fallbackOrder.get(a.id) ?? 999) - (fallbackOrder.get(b.id) ?? 999)
}

function rankPlayersByLongTermBank(players, statsByPlayer, tieBreakOrder) {
  const fallbackOrder = new Map(players.map((player, index) => [player.id, index]))
  return [...players].sort((a, b) => comparePlayersByTieBreak(a, b, statsByPlayer, fallbackOrder, tieBreakOrder))
}

function buildMatchRankSnapshots(matches, players, tieBreakOrder) {
  const playerIds = players.map((player) => player.id)
  const totals = new Map(playerIds.map((playerId) => [playerId, 0]))
  const statsByPlayer = new Map(playerIds.map((playerId) => [playerId, { exact: 0, scored: 0, noBet: 0 }]))
  const snapshots = new Map()

  for (const match of matches) {
    for (const tip of match?.tips ?? []) {
      if (!totals.has(tip.playerId)) continue
      const gained = Number.isFinite(tip.points) ? tip.points : 0
      totals.set(tip.playerId, (totals.get(tip.playerId) ?? 0) + gained)
      const stats = statsByPlayer.get(tip.playerId)
      if (tip.points === 10) stats.exact += 1
      if (tip.points === 10 || tip.points === 5 || tip.points === 3) stats.scored += 1
      if (isNoBetPick(tip.pick)) stats.noBet += 1
    }

    const rankingPlayers = players.map((player) => ({ ...player, points: totals.get(player.id) ?? 0 }))
    const sortedPlayerIds = rankPlayersByLongTermBank(rankingPlayers, statsByPlayer, tieBreakOrder).map((player) => player.id)

    const rankByPlayer = new Map()
    sortedPlayerIds.forEach((playerId, index) => {
      rankByPlayer.set(playerId, index + 1)
    })
    snapshots.set(match?.id, rankByPlayer)
  }

  return snapshots
}

function calculateMatchPayouts(match, playerOrder, overridesByMatchId, remainderRecipientsByMatchId) {
  const override = overridesByMatchId?.[match?.id]
  if (override && typeof override === 'object') {
    return new Map(Object.entries(override).map(([playerId, value]) => [playerId, Number(value) || 0]))
  }

  const tips = match?.tips ?? []
  const bank = Number(match?.bank)
  if (!Number.isFinite(bank) || bank <= 0) return new Map()

  const winners = tips.filter((tip) => tip.points === 10)
  if (winners.length === 0) return new Map()

  winners.sort((a, b) => (playerOrder.get(a.playerId) ?? 999) - (playerOrder.get(b.playerId) ?? 999))

  const base = Math.floor(bank / winners.length)
  const remainder = bank - base * winners.length
  const payouts = new Map(winners.map((winner) => [winner.playerId, base]))

  if (remainder > 0) {
    const preferredWinnerId = remainderRecipientsByMatchId?.[match?.id]
    const manualRecipientId = preferredWinnerId && payouts.has(preferredWinnerId) ? preferredWinnerId : ''

    const winnersWithTimestamp = winners
      .map((winner) => ({
        playerId: winner.playerId,
        timestampMs: toTipTimestampMs(winner.updatedAt),
      }))
      .filter((item) => Number.isFinite(item.timestampMs))
      .sort((a, b) => {
        if (a.timestampMs !== b.timestampMs) return a.timestampMs - b.timestampMs
        return (playerOrder.get(a.playerId) ?? 999) - (playerOrder.get(b.playerId) ?? 999)
      })

    const autoRecipientId = winnersWithTimestamp[0]?.playerId ?? ''
    const fallbackWinnerId = winners[0]?.playerId
    const recipientId = autoRecipientId || manualRecipientId || fallbackWinnerId

    if (recipientId) {
      payouts.set(recipientId, (payouts.get(recipientId) ?? 0) + remainder)
    }
  }

  return payouts
}

async function fetchLiveData(tournamentId) {
  const query = tournamentId ? `?tournament=${encodeURIComponent(tournamentId)}&` : '?'
  const response = await fetch(`/api/data${query}t=${Date.now()}`, { cache: 'no-store', credentials: 'include' })
  const payload = await response.json()

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message || 'Živá data nejsou dostupná')
  }

  return {
    players: payload.players ?? [],
    matches: payload.matches ?? [],
  }
}

function sortTournamentsBySchedule(items) {
  const now = Date.now()
  const getStart = (tournament) => {
    const time = new Date(tournament?.startDate ?? '').getTime()
    return Number.isFinite(time) ? time : 0
  }
  const getEnd = (tournament) => {
    const time = new Date(tournament?.endDate ?? '').getTime()
    return Number.isFinite(time) ? time : getStart(tournament)
  }
  const getStatusRank = (tournament) => {
    if (tournament?.status === 'active') return 0
    if (tournament?.status === 'draft' || getStart(tournament) > now) return 1
    return 2
  }

  return [...items].sort((a, b) => {
    const statusDiff = getStatusRank(a) - getStatusRank(b)
    if (statusDiff !== 0) return statusDiff

    if (getStatusRank(a) === 1) return getStart(a) - getStart(b)
    return getEnd(b) - getEnd(a)
  })
}

async function fetchTournamentCatalog() {

  const response = await fetch('/api/tournaments', { cache: 'no-store' })
  const payload = await response.json()
  if (!response.ok || !payload?.tournaments) throw new Error(payload?.message || 'Turnaje nejsou dostupné')
  return sortTournamentsBySchedule([...tournaments, ...payload.tournaments.filter((tournament) => tournament.productType !== 'fantasy')])
}

async function fetchFantasyTournamentCatalog() {
  const fallbackFantasyTournaments = [{ id: 'fantasy-2024-25', label: 'ELH 2024/25', title: 'ELH 2024/25', shortLabel: 'ELH 2024/25', status: 'finished', productType: 'fantasy' }]
  const response = await fetch('/api/fantasy/tournaments', { cache: 'no-store' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload?.tournaments) return fallbackFantasyTournaments
  const dbTournaments = payload.tournaments.map((tournament) => ({
    id: `db:${tournament._id}`,
    label: tournament.name,
    title: tournament.name,
    shortLabel: tournament.shortLabel || tournament.name,
    status: tournament.status,
    productType: 'fantasy',
    season: tournament.season,
    fantasyMonths: tournament.fantasyMonths || 0,
    heroLogo: tournament.heroLogo || '',
    favicon: tournament.favicon || '',
    fantasyPeriodRankLabel: tournament.fantasyPeriodRankLabel || 'Měsíční',
    fantasyMoneyRules: tournament.fantasyMoneyRules || null,
  }))
  const hasArchivedSeason = dbTournaments.some((tournament) => tournament.season === '2024/25' || tournament.shortLabel === 'ELH 2024/25')
  return sortTournamentsBySchedule([...(hasArchivedSeason ? [] : fallbackFantasyTournaments), ...dbTournaments])
}
function SplitTip({ value }) {
  const { home, away } = parseTipValue(value)

  return (
    <span className="split-tip" aria-label={`Tip ${value}`}>
      <strong className={home === '-' ? 'is-placeholder' : ''}>{home}</strong>
      <strong className={away === '-' ? 'is-placeholder' : ''}>{away}</strong>
    </span>
  )
}

function getMatchTeamLogoUrl(tournamentId, teamName, logoSet) {
  return getTeamLogoUrl(tournamentId, teamName, logoSet) ?? getFlagUrl(teamName)
}

function getTeamLogoClassName(tournamentId, logoSet) {
  return tournamentId === 'PO-2025' || logoSet === 'elh' ? 'is-round-logo' : 'is-rect-logo'
}

function buildSparkline(points, width = 120, height = 42, padding = 4) {
  const values = Array.isArray(points) ? points.filter((value) => Number.isFinite(value)) : []
  if (values.length === 0) {
    return { path: '', dots: [] }
  }

  if (values.length === 1) {
    const x = width / 2
    const y = height / 2
    return { path: `M ${x} ${y}`, dots: [{ x, y, value: values[0] }] }
  }

  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const range = maxValue - minValue || 1
  const stepX = (width - padding * 2) / (values.length - 1)

  const dots = values.map((value, index) => {
    const x = padding + stepX * index
    const normalized = (value - minValue) / range
    const y = height - padding - normalized * (height - padding * 2)
    return { x, y, value }
  })

  const path = dots
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ')

  return { path, dots }
}

function buildXAxisTickIndexes(length, maxLabels = 12) {
  const safeLength = Number(length) || 0
  if (safeLength <= 0) return new Set()
  if (safeLength <= 32) {
    return new Set(Array.from({ length: safeLength }, (_, index) => index))
  }
  if (safeLength <= maxLabels) {
    return new Set(Array.from({ length: safeLength }, (_, index) => index))
  }

  const indexes = new Set([0, safeLength - 1])
  const step = Math.ceil((safeLength - 1) / Math.max(1, maxLabels - 1))
  for (let index = step; index < safeLength - 1; index += step) {
    indexes.add(index)
  }
  return indexes
}

function formatMoneyWithSign(value) {
  const amount = Number(value) || 0
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : ''
  const absolute = Math.abs(amount)
  return `${sign}${new Intl.NumberFormat('cs-CZ').format(absolute)} Kč`
}

function moneyAmountClass(value) {
  const amount = Number(value) || 0
  if (amount > 0) return 'is-positive'
  if (amount < 0) return 'is-negative'
  return 'is-neutral'
}

function App() {
  const tooltipTimerRef = useRef(null)
  const touchLegendHandledRef = useRef(false)
  const playerDetailHeadingRef = useRef(null)
  const roundTabsRef = useRef(null)
  const productTournamentMenuRef = useRef(null)
  const tournamentMenuCloseTimerRef = useRef(null)
  const initialTournamentId = getStoredTournamentId()
  const [selectedTournamentId, setSelectedTournamentId] = useState(initialTournamentId)
  const [availableTournaments, setAvailableTournaments] = useState(() => sortTournamentsBySchedule(tournaments))
    const [availableFantasyTournaments, setAvailableFantasyTournaments] = useState([])
  const [data, setData] = useState(
    initialTournamentId === defaultTournamentId
      ? { players: fallbackPlayers, matches: fallbackMatches }
      : emptyData,
  )
  const [isLiveLoading, setIsLiveLoading] = useState(true)
  const [isRoundTabsMultiRow, setIsRoundTabsMultiRow] = useState(false)
  const [isTournamentMenuOpen, setIsTournamentMenuOpen] = useState(false)
  const [isTournamentMenuHovered, setIsTournamentMenuHovered] = useState(false)
  const [tournamentMenuProduct, setTournamentMenuProduct] = useState('tips')
  const [activeProduct, setActiveProduct] = useState(() => initialTournamentId.startsWith('db:') ? 'fantasy' : 'tips')
  const [fantasyRefreshKey, setFantasyRefreshKey] = useState(0)
  const [viewStateByTournament, setViewStateByTournament] = useState({})
  useEffect(() => {
    try {
      window.localStorage.setItem('mopp-selected-tournament', selectedTournamentId)
    } catch {
      // localStorage muze byt blokovane.
    }
  }, [selectedTournamentId])
  const selectedTournament = useMemo(
    () => availableTournaments.find((tournament) => tournament.id === selectedTournamentId)
      ?? getTournamentById(selectedTournamentId)
      ?? null,
    [availableTournaments, selectedTournamentId],
  )
  const selectedFantasyTournament = useMemo(
    () => availableFantasyTournaments.find((tournament) => tournament.id === selectedTournamentId) ?? availableFantasyTournaments[0] ?? null,
    [availableFantasyTournaments, selectedTournamentId],
  )
  const activeFantasyTournamentId = selectedFantasyTournament?.id ?? selectedTournamentId
  const roundLabel = selectedTournament?.roundLabel ?? 'den'
  const longTermBank = selectedTournament?.longTermBank ?? null
  const remainderRecipientByMatchId = useMemo(
    () => selectedTournament?.remainderRecipientByMatchId ?? {},
    [selectedTournament],
  )

  useEffect(() => {
    const activeTournament = activeProduct === 'fantasy' ? selectedFantasyTournament : selectedTournament
    const faviconHref = activeTournament?.favicon
    if (!faviconHref || typeof document === 'undefined') return

    const cacheBustedHref = `${faviconHref}?t=${encodeURIComponent(activeTournament?.id ?? '')}`
    const rels = ['icon', 'shortcut icon']

    for (const rel of rels) {
      const link = document.querySelector(`link[rel='${rel}']`) || document.createElement('link')
      link.setAttribute('rel', rel)
      link.setAttribute('href', cacheBustedHref)
      if (!link.parentNode) {
        document.head.appendChild(link)
      }
    }
  }, [activeProduct, selectedFantasyTournament?.favicon, selectedFantasyTournament?.id, selectedTournament?.favicon, selectedTournament?.id])

  useEffect(() => {
    if (typeof document === 'undefined') return
    if (activeProduct === 'fantasy') {
      const suffix = selectedFantasyTournament?.shortLabel ?? selectedFantasyTournament?.title ?? selectedFantasyTournament?.label ?? 'Fantasy'
      document.title = `MOPP | Fantasy | ${suffix}`
      return
    }
    const suffix = selectedTournament?.shortLabel ?? selectedTournament?.title ?? selectedTournament?.label ?? 'MOPP'
    document.title = `MOPP | Tipovačka | ${suffix}`
  }, [activeProduct, selectedFantasyTournament, selectedTournament])

  useEffect(() => {
    const closeTournamentMenu = (event) => {
      if (!productTournamentMenuRef.current?.contains(event.target)) setIsTournamentMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeTournamentMenu)
    return () => document.removeEventListener('pointerdown', closeTournamentMenu)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchTournamentCatalog()
      .then((nextTournaments) => {
        if (cancelled) return
        setAvailableTournaments(nextTournaments)
      })
      .catch(() => {})
        fetchFantasyTournamentCatalog()
          .then((nextTournaments) => {
            if (cancelled) return
            setAvailableFantasyTournaments(nextTournaments)
              setSelectedTournamentId((current) => {
                if (!current.startsWith('db:') || nextTournaments.some((tournament) => tournament.id === current) || !nextTournaments[0]?.id) return current
                const nextId = nextTournaments[0].id
                const url = new URL(window.location.href)
                url.searchParams.set('tournament', nextId)
                window.history.replaceState({}, '', url)
                return nextId
              })
          })
          .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const players = data.players
  const matches = data.matches
  const hasUnfinishedMatches = useMemo(
    () =>
      matches.some(
        (match) =>
          !match.score ||
          match.score === '--:--' ||
          (match.tips ?? []).some((tip) => tip.points === null),
      ),
    [matches],
  )
  const highlightCurrentRound = isTournamentActiveByDate(selectedTournament) && hasUnfinishedMatches
  const scoreboard = useMemo(() => [...players].sort((a, b) => b.points - a.points), [players])
  const totalPayoutsByPlayer = useMemo(() => {
    const playerOrder = new Map(players.map((player, index) => [player.id, index]))
    const totals = new Map(players.map((player) => [player.id, 0]))

    for (const match of matches) {
      const payouts = calculateMatchPayouts(
        match,
        playerOrder,
        manualPayoutOverridesByMatchId,
        remainderRecipientByMatchId,
      )

      for (const [playerId, payout] of payouts.entries()) {
        totals.set(playerId, (totals.get(playerId) ?? 0) + (Number(payout) || 0))
      }
    }

    return totals
  }, [matches, players, remainderRecipientByMatchId])

  const longTermPayoutByPlayer = useMemo(() => {
    const payouts = new Map(players.map((player) => [player.id, 0]))
    const statsByPlayer = new Map(players.map((player) => [player.id, { exact: 0, near: 0, win: 0, scored: 0, noBet: 0 }]))
    for (const match of matches) {
      for (const tip of match.tips ?? []) {
        const stats = statsByPlayer.get(tip.playerId)
        if (!stats) continue
        if (tip.points === 10) stats.exact += 1
        if (tip.points === 5) stats.near += 1
        if (tip.points === 3) stats.win += 1
        if (tip.points === 10 || tip.points === 5 || tip.points === 3) stats.scored += 1
        if (isNoBetPick(tip.pick)) stats.noBet += 1
      }
    }
    const payoutConfig = (selectedTournament?.longTermBank?.payouts ?? [])
      .map((item) => ({
        place: Number(item?.place),
        amount: Number(item?.amount) || 0,
      }))
      .filter((item) => Number.isFinite(item.place) && item.place >= 1 && item.amount > 0)

    const bankRankedPlayers = rankPlayersByLongTermBank(players, statsByPlayer, selectedTournament?.tieBreakOrder)
    for (const payout of payoutConfig) {
      const playerAtPlace = bankRankedPlayers[payout.place - 1]
      if (!playerAtPlace) continue
      payouts.set(playerAtPlace.id, (payouts.get(playerAtPlace.id) ?? 0) + payout.amount)
    }

    return payouts
  }, [matches, players, selectedTournament])

  const standings = useMemo(
    () =>
      scoreboard.map((player) => {
        const stats = {
          exact: 0,
          near: 0,
          win: 0,
          miss: 0,
          noBet: 0,
        }

        for (const match of matches) {
          const tip = match.tips.find((item) => item.playerId === player.id)
          if (!tip) continue

          if (tip.points === 10) stats.exact += 1
          if (tip.points === 5) stats.near += 1
          if (tip.points === 3) stats.win += 1
          if (isNoBetPick(tip.pick)) stats.noBet += 1
          if (tip.points === 0 && !isNoBetPick(tip.pick)) stats.miss += 1
        }

        const matchWinnings = (totalPayoutsByPlayer.get(player.id) ?? 0) + (bonusWinningsByPlayerId[player.id] ?? 0)
        const longTermPayout = longTermPayoutByPlayer.get(player.id) ?? 0
        return {
          ...player,
          matchWinnings,
          longTermPayout,
          winnings: matchWinnings + longTermPayout,
          stats,
        }
      }),
    [longTermPayoutByPlayer, matches, scoreboard, totalPayoutsByPlayer],
  )

  const rounds = useMemo(() => {
    const all = matches.map((match) => extractRound(match)).filter((value) => value !== null)
    return [...new Set(all)].sort((a, b) => a - b)
  }, [matches])

  const orderedMatches = useMemo(() => {
    const toMatchNumber = (matchId) => {
      const numeric = Number(String(matchId ?? '').replace(/\D+/g, ''))
      return Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER
    }

    return [...matches].sort((a, b) => {
      const roundA = extractRound(a)
      const roundB = extractRound(b)
      if (Number.isFinite(roundA) && Number.isFinite(roundB) && roundA !== roundB) return roundA - roundB

      const dateA = parseMatchDate(a?.startsAt)?.getTime()
      const dateB = parseMatchDate(b?.startsAt)?.getTime()
      const hasDateA = Number.isFinite(dateA)
      const hasDateB = Number.isFinite(dateB)
      if (hasDateA && hasDateB && dateA !== dateB) return dateA - dateB
      if (hasDateA !== hasDateB) return hasDateA ? -1 : 1

      return toMatchNumber(a?.id) - toMatchNumber(b?.id)
    })
  }, [matches])

  const rankSnapshotByMatchId = useMemo(
    () => buildMatchRankSnapshots(orderedMatches, players, selectedTournament?.tieBreakOrder),
    [orderedMatches, players, selectedTournament?.tieBreakOrder],
  )

  const currentViewState = viewStateByTournament[selectedTournamentId] ?? {}
  const rankChartView = currentViewState.rankChartView ?? 'match'

  const rankTimeline = useMemo(() => {
    if (orderedMatches.length === 0) return { rounds: [], series: [], axisLabel: 'Zápas turnaje' }

    const isMatchEvaluated = (match) => {
      if (!match?.score || match.score === '--:--') return false
      return (match.tips ?? []).every((tip) => Number.isFinite(tip.points))
    }

    const evaluatedMatches = orderedMatches.filter((match) => isMatchEvaluated(match))
    if (evaluatedMatches.length === 0) return { rounds: [], series: [], axisLabel: 'Zápas turnaje' }

    const timelineEntries = rankChartView === 'day'
      ? (() => {
        const lastMatchByRound = new Map()
        for (const match of evaluatedMatches) {
          const round = extractRound(match)
          if (!Number.isFinite(round)) continue
          lastMatchByRound.set(round, match)
        }

        const roundEntries = [...lastMatchByRound.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([round, match]) => ({ label: round, match }))

        if (roundEntries.length > 0) return roundEntries
        return evaluatedMatches.map((match, index) => ({ label: index + 1, match }))
      })()
      : evaluatedMatches.map((match, index) => ({ label: index + 1, match }))

    const playerOrder = players.map((player) => player.id)
    const playerMeta = new Map(scoreboard.map((player) => [player.id, player]))
    const rankByPlayer = new Map(playerOrder.map((id) => [id, []]))

    for (const entry of timelineEntries) {
      const rankSnapshot = rankSnapshotByMatchId.get(entry.match.id)
      for (const playerId of playerOrder) {
        rankByPlayer.get(playerId).push(rankSnapshot?.get(playerId) ?? null)
      }
    }

    const series = playerOrder.map((playerId, index) => ({
      id: playerId,
      name: playerMeta.get(playerId)?.name ?? playerId,
      color: chartColors[index % chartColors.length],
      ranks: rankByPlayer.get(playerId) ?? [],
    }))

    return {
      rounds: timelineEntries.map((entry) => entry.label),
      series,
      axisLabel: rankChartView === 'day' ? 'Den turnaje' : 'Zápas turnaje',
    }
  }, [orderedMatches, players, scoreboard, rankSnapshotByMatchId, rankChartView])

  const currentRound = useMemo(() => {
    const inProgress = matches
      .filter((match) => !match.score || match.tips.some((tip) => tip.points === null))
      .map((match) => extractRound(match))
      .filter((value) => value !== null)

    if (inProgress.length > 0) return Math.min(...inProgress)
    return rounds[rounds.length - 1] ?? 1
  }, [matches, rounds])

  const selectedRound = currentViewState.selectedRound ?? currentRound
  const hidePlayedRounds = currentViewState.hidePlayedRounds ?? false
  const visiblePlayerIds = currentViewState.visiblePlayerIds ?? scoreboard.map((player) => player.id)
  const hoveredPlayerId = currentViewState.hoveredPlayerId ?? ''
  const selectedMatchId = currentViewState.selectedMatchId ?? ''
  const selectedPlayerId = currentViewState.selectedPlayerId ?? ''
  const playerFormWindow = currentViewState.playerFormWindow ?? 'all'
  const standingsFormWindow = currentViewState.standingsFormWindow ?? 'all'
  const standingsMetric = currentViewState.standingsMetric ?? 'points'
  const showLongTermBankInfo = currentViewState.showLongTermBankInfo ?? false

  const updateCurrentTournamentState = (patch) => {
    setViewStateByTournament((prev) => {
      const existing = prev[selectedTournamentId] ?? {}
      const nextPatch = typeof patch === 'function' ? patch(existing) : patch
      return {
        ...prev,
        [selectedTournamentId]: {
          ...existing,
          ...nextPatch,
        },
      }
    })
  }

  const setSelectedRound = (value) => {
    updateCurrentTournamentState((current) => ({
      selectedRound: typeof value === 'function' ? value(current.selectedRound ?? currentRound) : value,
    }))
  }

  const setHidePlayedRounds = (value) => {
    updateCurrentTournamentState((current) => ({
      hidePlayedRounds:
        typeof value === 'function' ? value(current.hidePlayedRounds ?? false) : value,
    }))
  }

  const setVisiblePlayerIds = (value) => {
    updateCurrentTournamentState((current) => ({
      visiblePlayerIds:
        typeof value === 'function'
          ? value(current.visiblePlayerIds ?? scoreboard.map((player) => player.id))
          : value,
    }))
  }

  const setHoveredPlayerId = (value) => {
    updateCurrentTournamentState((current) => ({
      hoveredPlayerId: typeof value === 'function' ? value(current.hoveredPlayerId ?? '') : value,
    }))
  }

  const setSelectedMatchId = (value) => {
    updateCurrentTournamentState((current) => ({
      selectedMatchId:
        typeof value === 'function' ? value(current.selectedMatchId ?? '') : value,
    }))
  }

  const setSelectedPlayerId = (value) => {
    updateCurrentTournamentState((current) => ({
      selectedPlayerId:
        typeof value === 'function' ? value(current.selectedPlayerId ?? '') : value,
    }))
  }

  const setPlayerFormWindow = (value) => {
    updateCurrentTournamentState((current) => ({
      playerFormWindow:
        typeof value === 'function' ? value(current.playerFormWindow ?? 'all') : value,
    }))
  }

  const setStandingsFormWindow = (value) => {
    updateCurrentTournamentState((current) => ({
      standingsFormWindow:
        typeof value === 'function' ? value(current.standingsFormWindow ?? 'all') : value,
    }))
  }

  const setStandingsMetric = (value) => {
    updateCurrentTournamentState((current) => ({
      standingsMetric:
        typeof value === 'function' ? value(current.standingsMetric ?? 'points') : value,
    }))
  }

  const setRankChartView = (value) => {
    updateCurrentTournamentState((current) => ({
      rankChartView:
        typeof value === 'function' ? value(current.rankChartView ?? 'match') : value,
    }))
  }

  const toggleSelectedPlayerId = (playerId) => {
    setSelectedPlayerId((prev) => (prev === playerId ? '' : playerId))
  }

  const setShowLongTermBankInfo = (value) => {
    updateCurrentTournamentState((current) => ({
      showLongTermBankInfo:
        typeof value === 'function' ? value(current.showLongTermBankInfo ?? false) : value,
    }))
  }

  const normalizedVisiblePlayerIds = useMemo(() => {
    const ids = scoreboard.map((player) => player.id)
    return visiblePlayerIds.filter((id) => ids.includes(id))
  }, [scoreboard, visiblePlayerIds])

  const togglePlayerVisibility = (playerId) => {
    setVisiblePlayerIds((prev) =>
      prev.includes(playerId) ? prev.filter((id) => id !== playerId) : [...prev, playerId],
    )
  }

  const playedRounds = useMemo(() => {
    const byRound = new Map()

    for (const match of matches) {
      const round = extractRound(match)
      if (!Number.isFinite(round)) continue
      if (!byRound.has(round)) byRound.set(round, [])
      byRound.get(round).push(match)
    }

    const completedRounds = new Set()
    for (const [round, roundMatchesInRound] of byRound.entries()) {
      const isCompleted = roundMatchesInRound.length > 0 && roundMatchesInRound.every((match) => {
        if (!match.score || match.score === '--:--') return false
        return (match.tips ?? []).every((tip) => Number.isFinite(tip.points))
      })
      if (isCompleted) completedRounds.add(round)
    }

    return completedRounds
  }, [matches])

  const visibleRounds = useMemo(() => {
    if (!hidePlayedRounds) return rounds
    const filtered = rounds.filter((round) => !playedRounds.has(round))
    return filtered.length > 0 ? filtered : rounds
  }, [hidePlayedRounds, rounds, playedRounds])

  const effectiveSelectedRound = useMemo(() => {
    if (visibleRounds.length === 0) return selectedRound
    if (visibleRounds.includes(selectedRound)) return selectedRound
    if (visibleRounds.includes(currentRound)) return currentRound
    return visibleRounds[0]
  }, [visibleRounds, selectedRound, currentRound])

  useEffect(() => {
    const tabs = roundTabsRef.current
    if (!tabs) return undefined

    const updateWrappedState = () => {
      const buttons = Array.from(tabs.querySelectorAll('.round-tab'))
      if (buttons.length <= 1) {
        setIsRoundTabsMultiRow(false)
        return
      }

      const firstTop = buttons[0].offsetTop
      const wrapped = buttons.some((button) => button.offsetTop !== firstTop)
      setIsRoundTabsMultiRow((prev) => (prev === wrapped ? prev : wrapped))
    }

    updateWrappedState()

    let resizeObserver = null
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(updateWrappedState)
      resizeObserver.observe(tabs)
    }

    window.addEventListener('resize', updateWrappedState)
    return () => {
      window.removeEventListener('resize', updateWrappedState)
      resizeObserver?.disconnect()
    }
  }, [visibleRounds])

  const roundMatches = useMemo(
    () => orderedMatches.filter((match) => extractRound(match) === effectiveSelectedRound),
    [orderedMatches, effectiveSelectedRound],
  )

  const roundDateLabel = useMemo(() => {
    const tournamentYear = Number(String(selectedTournament?.startDate ?? '').slice(0, 4))
    const withYear = (token) => {
      const matched = String(token ?? '').trim().match(/^(\d{1,2})\.\s*(\d{1,2})\.?$/)
      if (matched) {
        const day = Number(matched[1])
        const month = Number(matched[2])
        if (Number.isFinite(tournamentYear)) return `${day}. ${month}. ${tournamentYear}`
        return `${day}. ${month}.`
      }

      const cleaned = String(token ?? '').trim().replace(/\.$/, '')
      if (!cleaned) return ''
      return Number.isFinite(tournamentYear) ? `${cleaned}. ${tournamentYear}` : `${cleaned}.`
    }

    const dates = [...new Set(roundMatches.map((match) => extractCalendarDate(match.startsAt)).filter(Boolean))]
    if (dates.length === 0) return ''
    if (dates.length === 1) return withYear(dates[0])
    return `${withYear(dates[0])} – ${withYear(dates[dates.length - 1])}`
  }, [roundMatches, selectedTournament?.startDate])

  const effectiveSelectedMatchId = useMemo(() => {
    if (roundMatches.length === 0) return ''
    const exists = roundMatches.some((match) => match.id === selectedMatchId)
    return exists ? selectedMatchId : roundMatches[0].id
  }, [roundMatches, selectedMatchId])

  const selectedMatch = useMemo(
    () => roundMatches.find((match) => match.id === effectiveSelectedMatchId) ?? roundMatches[0],
    [roundMatches, effectiveSelectedMatchId],
  )

  const effectiveSelectedPlayerId = useMemo(() => {
    if (standings.length === 0) return ''
    if (!selectedPlayerId) return ''
    const exists = standings.some((player) => player.id === selectedPlayerId)
    return exists ? selectedPlayerId : ''
  }, [standings, selectedPlayerId])

  const playedMatches = useMemo(
    () => matches.filter((match) => match.score && match.score !== '--:--'),
    [matches],
  )

  /*
  const allPlayersTipProgress = useMemo(() => {
    const totalTipSlots = playedMatches.length * players.length
    const submittedTips = playedMatches.reduce((sum, match) => {
      const tipsInMatch = (match.tips ?? []).filter(
        (tip) => tip.pick && tip.pick !== '-' && !isNoBetPick(tip.pick),
      ).length
      return sum + tipsInMatch
    }, 0)
    const coverage = totalTipSlots > 0 ? Math.round((submittedTips / totalTipSlots) * 100) : 0

    return {
      submittedTips,
      totalTipSlots,
      coverage,
    }
  }, [playedMatches, players.length])
  */

  const selectedPlayerProfile = useMemo(() => {
    if (!effectiveSelectedPlayerId) return null

    const selectedStanding = standings.find((player) => player.id === effectiveSelectedPlayerId)
    if (!selectedStanding) return null

    const entryFeePaid = Boolean(selectedStanding.entryFeePaid)
    const timeline = matches
      .map((match) => {
        const tip = (match.tips ?? []).find((item) => item.playerId === effectiveSelectedPlayerId)
        if (!tip || !Number.isFinite(tip.points)) return null
        return {
          matchId: match.id,
          round: extractRound(match),
          points: tip.points,
          isNoBet: isNoBetPick(tip.pick),
          isOneGoalOff: isOneGoalOffPick(tip.pick, match.score),
        }
      })
      .filter(Boolean)

    const evaluatedCount = timeline.length
    const requestedWindow = playerFormWindow === 'all' ? evaluatedCount : Number(playerFormWindow)
    const recentWindowSize = Math.max(1, Math.min(evaluatedCount || 1, Number.isFinite(requestedWindow) ? requestedWindow : 10))
    const requestedFormWindow = playerFormWindow === 'all'
      ? 'all'
      : (Number.isFinite(requestedWindow) ? requestedWindow : 10)
    const recent = timeline.slice(-recentWindowSize)
    const trendWindowSize = playerFormWindow === 'all'
      ? Math.max(2, Math.floor(evaluatedCount / 2))
      : recentWindowSize
    const trendRecent = timeline.slice(-trendWindowSize)
    const trendPrevious = timeline.slice(-trendWindowSize * 2, -trendWindowSize)
    const recentRounds = [...new Set(recent.map((item) => item.round).filter((round) => Number.isFinite(round)))]

    const recentPoints = recent.reduce((sum, item) => sum + item.points, 0)
    const recentAverage = recent.length > 0 ? recentPoints / recent.length : 0
    const trendRecentAverage = trendRecent.length > 0
      ? trendRecent.reduce((sum, item) => sum + item.points, 0) / trendRecent.length
      : 0
    const previousAverage = trendPrevious.length > 0
      ? trendPrevious.reduce((sum, item) => sum + item.points, 0) / trendPrevious.length
      : null

    let trendLabel = 'bez srovnání'
    let trendDirection = 'neutral'
    let trendDeltaText = ''
    if (previousAverage !== null) {
      const diff = trendRecentAverage - previousAverage
      if (diff > 0.2) {
        trendLabel = 'roste'
        trendDirection = 'up'
        trendDeltaText = `+${diff.toFixed(2)} b/z`
      } else if (diff < -0.2) {
        trendLabel = 'klesá'
        trendDirection = 'down'
        trendDeltaText = `${diff.toFixed(2)} b/z`
      } else {
        trendLabel = 'stabilní'
        trendDirection = 'flat'
      }
    }

    const currentPositiveStreak = (() => {
      let streak = 0
      for (let i = recent.length - 1; i >= 0; i -= 1) {
        if (recent[i].points > 0) streak += 1
        else break
      }
      return streak
    })()

    const longestPositiveStreak = (() => {
      let best = 0
      let streak = 0
      for (const entry of recent) {
        if (entry.points > 0) {
          streak += 1
          if (streak > best) best = streak
        } else {
          streak = 0
        }
      }
      return best
    })()

    const currentNegativeStreak = (() => {
      let streak = 0
      for (let i = recent.length - 1; i >= 0; i -= 1) {
        if (recent[i].points > 0) break
        streak += 1
      }
      return streak
    })()

    const longestNegativeStreak = (() => {
      let best = 0
      let streak = 0
      for (const entry of recent) {
        if (entry.points > 0) {
          streak = 0
        } else {
          streak += 1
          if (streak > best) best = streak
        }
      }
      return best
    })()

    const tippedMatchesCount = playedMatches.reduce((sum, match) => {
      const tip = (match.tips ?? []).find((item) => item.playerId === effectiveSelectedPlayerId)
      if (!tip || !tip.pick || tip.pick === '-' || isNoBetPick(tip.pick)) return sum
      return sum + 1
    }, 0)
    const totalMatchesCount = playedMatches.length
    const playerTipCoverage = totalMatchesCount > 0 ? Math.round((tippedMatchesCount / totalMatchesCount) * 100) : 0

    const recentExactCount = recent.filter((item) => item.points === 10).length
    const recentNearCount = recent.filter((item) => item.points === 5).length
    const recentWinCount = recent.filter((item) => item.points === 3).length
    const recentNoBetCount = recent.filter((item) => item.isNoBet).length
    const recentOneGoalOffCount = recent.filter((item) => item.isOneGoalOff).length
    const recentMissCount = Math.max(0, recent.length - recentExactCount - recentNearCount - recentWinCount - recentNoBetCount)
    const recentScoredCount = recentExactCount + recentNearCount + recentWinCount
    const toPercent = (value, total) => (total > 0 ? Math.round((value / total) * 100) : 0)

    const selectedRank = standings.findIndex((item) => item.id === selectedStanding.id) + 1
    const entryFeePerMatch = Number(selectedTournament?.entryFee ?? selectedTournament?.entryFeePerMatch ?? 10)
    const seasonMatchesCount = Number(selectedTournament?.plannedMatchCount ?? selectedTournament?.seasonMatchesCount ?? 0)
    const longTermContribution = Number(selectedTournament?.longTermContribution ?? selectedTournament?.longTermBankContribution ?? 0)
    const payoutByPlace = new Map(
      (selectedTournament?.longTermBank?.payouts ?? [])
        .filter((item) => Number.isFinite(item?.place))
        .map((item) => [item.place, Number(item.amount) || 0]),
    )
    const projectedLongTermPayout = Number(
      (selectedTournament?.longTermBank?.payouts ?? []).find((item) => item.place === selectedRank)?.amount ?? 0,
    )
    const currentLongTermPayout = Number(selectedStanding.longTermPayout ?? 0)
    const realizedWinnings = Number(selectedStanding.matchWinnings ?? 0)
    const matchStakeTotal = Math.max(0, entryFeePerMatch * Math.max(0, seasonMatchesCount))
    const totalInserted = matchStakeTotal + longTermContribution
    const currentBalance = realizedWinnings - totalInserted
    const currentBalanceWithBank = currentBalance + currentLongTermPayout
    const potentialBalances = [...payoutByPlace.entries()]
      .filter(([place, amount]) => place >= 1 && amount > 0)
      .sort(([placeA], [placeB]) => placeA - placeB)
      .map(([place, amount]) => ({ place, balance: currentBalance + amount }))

    const recentRoundsSet = new Set(recentRounds)
    const matchesInRecentRounds = recentRoundsSet.size > 0
      ? matches.filter((match) => recentRoundsSet.has(extractRound(match)))
      : []

    const averageRates = (() => {
      if (matchesInRecentRounds.length === 0 || players.length === 0) {
        return { scored: 0, exact: 0, near: 0, win: 0 }
      }

      const perPlayerRates = players
        .map((player) => {
          let total = 0
          let exact = 0
          let near = 0
          let win = 0

          for (const match of matchesInRecentRounds) {
            const tip = (match.tips ?? []).find((item) => item.playerId === player.id)
            if (!tip || !Number.isFinite(tip.points)) continue
            total += 1
            if (tip.points === 10) exact += 1
            if (tip.points === 5) near += 1
            if (tip.points === 3) win += 1
          }

          if (total === 0) return null
          return {
            scored: toPercent(exact + near + win, total),
            exact: toPercent(exact, total),
            near: toPercent(near, total),
            win: toPercent(win, total),
          }
        })
        .filter(Boolean)

      if (perPlayerRates.length === 0) {
        return { scored: 0, exact: 0, near: 0, win: 0 }
      }

      const sum = perPlayerRates.reduce(
        (acc, item) => ({
          scored: acc.scored + item.scored,
          exact: acc.exact + item.exact,
          near: acc.near + item.near,
          win: acc.win + item.win,
        }),
        { scored: 0, exact: 0, near: 0, win: 0 },
      )

      return {
        scored: Math.round(sum.scored / perPlayerRates.length),
        exact: Math.round(sum.exact / perPlayerRates.length),
        near: Math.round(sum.near / perPlayerRates.length),
        win: Math.round(sum.win / perPlayerRates.length),
      }
    })()

    const fieldComparison = (() => {
      const playerFormStats = players
        .map((player) => {
          let totalPoints = 0
          let totalTips = 0

          for (const match of matchesInRecentRounds) {
            const tip = (match.tips ?? []).find((item) => item.playerId === player.id)
            if (!tip || !Number.isFinite(tip.points)) continue
            totalPoints += tip.points
            totalTips += 1
          }

          return {
            id: player.id,
            avg: totalTips > 0 ? totalPoints / totalTips : 0,
            totalPoints,
          }
        })
        .sort((a, b) => {
          if (b.avg !== a.avg) return b.avg - a.avg
          if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints
          return a.id.localeCompare(b.id)
        })

      const formRank = Math.max(1, playerFormStats.findIndex((item) => item.id === selectedStanding.id) + 1)
      const totalPlayers = Math.max(1, playerFormStats.length)
      const percentile = totalPlayers <= 1
        ? 100
        : Math.round(((totalPlayers - formRank) / (totalPlayers - 1)) * 100)

      const sortedAverages = playerFormStats
        .map((item) => item.avg)
        .sort((a, b) => a - b)
      const middleIndex = Math.floor(sortedAverages.length / 2)
      const middleAverage = sortedAverages.length === 0
        ? 0
        : sortedAverages.length % 2 === 1
          ? sortedAverages[middleIndex]
          : (sortedAverages[middleIndex - 1] + sortedAverages[middleIndex]) / 2

      const vsMiddle = Math.round((recentAverage - middleAverage) * 100) / 100

      const currentPoints = Number(selectedStanding.points ?? 0)
      const paidPlaces = [...payoutByPlace.keys()].filter((place) => place >= 1).sort((a, b) => a - b)
      const lastPaidPlace = paidPlaces[paidPlaces.length - 1] ?? 0
      const comparisonPlace = lastPaidPlace + 1
      const previousPlace = Math.max(1, comparisonPlace - 1)
      const comparisonPoints = Number(standings[comparisonPlace - 1]?.points ?? currentPoints)
      const previousPoints = Number(standings[previousPlace - 1]?.points ?? currentPoints)
      const isInsidePaidPlaces = lastPaidPlace > 0 && selectedRank <= lastPaidPlace
      const top3GapLabel = isInsidePaidPlaces ? `Náskok na ${comparisonPlace}. místo` : `Ztráta na ${previousPlace}. místo`
      const top3GapValue = isInsidePaidPlaces
        ? Math.max(0, currentPoints - comparisonPoints)
        : Math.max(0, previousPoints - currentPoints)

      return {
        percentile,
        vsMiddle,
        formRank,
        totalPlayers,
        top3GapLabel,
        top3GapValue,
      }
    })()

    const valueInsights = (() => {
      let againstMajority = 0
      let exactAgainstMajority = 0
      let pointsAgainstMajority = 0

      for (const match of playedMatches) {
        const selectedTip = (match.tips ?? []).find((tip) => tip.playerId === effectiveSelectedPlayerId)
        if (!selectedTip || !selectedTip.pick || selectedTip.pick === '-' || isNoBetPick(selectedTip.pick)) continue

        const selectedOutcome = pickToOutcome(selectedTip.pick)
        if (!selectedOutcome) continue

        const outcomeCounts = new Map()
        for (const tip of match.tips ?? []) {
          if (!tip.pick || tip.pick === '-' || isNoBetPick(tip.pick)) continue

          const outcome = pickToOutcome(tip.pick)
          if (!outcome) continue
          outcomeCounts.set(outcome, (outcomeCounts.get(outcome) ?? 0) + 1)
        }
        if (outcomeCounts.size === 0) continue

        let maxCount = 0
        for (const count of outcomeCounts.values()) {
          if (count > maxCount) maxCount = count
        }
        const majorityOutcomes = [...outcomeCounts.entries()]
          .filter(([, count]) => count === maxCount)
          .map(([outcome]) => outcome)

        // Pri remize nejde urcit jasnou vetsinu, zapas preskocime.
        if (majorityOutcomes.length !== 1) continue
        if (selectedOutcome === majorityOutcomes[0]) continue

        againstMajority += 1
        pointsAgainstMajority += Number(selectedTip.points) || 0
        if (selectedTip.points === 10) exactAgainstMajority += 1
      }

      return {
        againstMajority,
        exactAgainstMajority,
        pointsAgainstMajority,
        exactRate: toPercent(exactAgainstMajority, againstMajority),
        avgPoints: againstMajority > 0 ? (pointsAgainstMajority / againstMajority).toFixed(2) : '0.00',
      }
    })()

    return {
      id: selectedStanding.id,
      name: selectedStanding.name,
      avatar: selectedStanding.avatar || '',
      evaluatedCount,
      formWindow: requestedFormWindow,
      recentCount: recent.length,
      recentPoints,
      recentAverage: recentAverage.toFixed(2),
      recentFormIndex: Math.round((recentAverage / 10) * 100),
      trendLabel,
      trendDirection,
      trendDeltaText,
      currentPositiveStreak,
      longestPositiveStreak,
      currentNegativeStreak,
      longestNegativeStreak,
      recentSequence: recent.map((item) => (item.isNoBet ? 'N' : item.points)).join(', '),
      recentSeries: recent.map((item) => ({ points: item.points, isNoBet: item.isNoBet })),
      recentRounds,
      successRates: {
        scored: toPercent(recentScoredCount, recent.length),
        exact: toPercent(recentExactCount, recent.length),
        near: toPercent(recentNearCount, recent.length),
        win: toPercent(recentWinCount, recent.length),
        oneGoalOff: toPercent(recentOneGoalOffCount, recent.length),
        miss: toPercent(recentMissCount, recent.length),
        noBet: toPercent(recentNoBetCount, recent.length),
      },
      successCounts: {
        exact: recentExactCount,
        near: recentNearCount,
        win: recentWinCount,
        miss: recentMissCount,
        noBet: recentNoBetCount,
        oneGoalOff: recentOneGoalOffCount,
      },
      successRatesDelta: {
        scored: toPercent(recentScoredCount, recent.length) - averageRates.scored,
      },
      fieldComparison,
      valueInsights,
      moneySummary: {
        realizedWinnings,
        matchStakeTotal,
        longTermContribution,
        totalInserted,
        currentBalance,
        potentialBalances,
        currentLongTermPayout,
        currentBalanceWithBank,
        projectedLongTermPayout,
        selectedRank,
      },
      tippedMatchesCount,
      totalMatchesCount,
      playerTipCoverage,
    }
  }, [effectiveSelectedPlayerId, standings, playedMatches, playerFormWindow, matches, players, selectedTournament])

  const selectedPlayerRankSeries = useMemo(() => {
    if (!effectiveSelectedPlayerId) return null
    if (rankTimeline.rounds.length === 0 || rankTimeline.series.length === 0) return null

    const series = rankTimeline.series.find((player) => player.id === effectiveSelectedPlayerId)
    if (!series || series.ranks.length === 0) return null

    return {
      ...series,
      rounds: rankTimeline.rounds,
      ranks: series.ranks,
      maxRank: rankTimeline.series.length,
    }
  }, [effectiveSelectedPlayerId, rankTimeline])

  const selectedPlayerPlacement = useMemo(() => {
    if (!effectiveSelectedPlayerId) return null

    const currentRank = Math.max(1, standings.findIndex((item) => item.id === effectiveSelectedPlayerId) + 1)
    const series = rankTimeline.series.find((player) => player.id === effectiveSelectedPlayerId)
    const ranks = (series?.ranks ?? []).filter((rank) => Number.isFinite(rank))

    const bestRank = ranks.length > 0 ? Math.min(...ranks) : currentRank
    const worstRank = ranks.length > 0 ? Math.max(...ranks) : currentRank

    return {
      currentRank,
      bestRank,
      worstRank,
    }
  }, [effectiveSelectedPlayerId, standings, rankTimeline])

  useEffect(() => {
    if (!selectedPlayerProfile || typeof window === 'undefined') return

    const target = playerDetailHeadingRef.current
    if (!target) return

    const topOffset = 12
    const rafId = window.requestAnimationFrame(() => {
      const targetTop = target.getBoundingClientRect().top + window.scrollY - topOffset
      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'smooth',
      })
    })

    return () => window.cancelAnimationFrame(rafId)
  }, [selectedPlayerProfile])

  const selectedMatchStageLabel = useMemo(
    () =>
      selectedTournament?.stageLabel || getStageLabel(
          selectedMatch,
          selectedTournament?.stageRules ?? [],
          selectedTournament?.stageTransitions ?? [],
          selectedTournament?.stages ?? [],
        ),
    [selectedMatch, selectedTournament],
  )

  const selectedMatchTips = useMemo(() => {
    if (!selectedMatch) return []
    const isMatchEvaluated = Boolean(selectedMatch.score && selectedMatch.score !== '--:--')
    const selectedMatchIndex = orderedMatches.findIndex((match) => match.id === selectedMatch.id)
    const rankByPlayerForSelectedMatch = rankSnapshotByMatchId.get(selectedMatch.id) ?? new Map()
    const previousMatchId = selectedMatchIndex > 0 ? orderedMatches[selectedMatchIndex - 1]?.id : ''
    const rankByPlayerForPreviousMatch = previousMatchId
      ? rankSnapshotByMatchId.get(previousMatchId) ?? new Map()
      : new Map()

    const cumulativePointsByPlayer = new Map(players.map((player) => [player.id, 0]))
    if (selectedMatchIndex >= 0) {
      for (let index = 0; index <= selectedMatchIndex; index += 1) {
        const match = orderedMatches[index]
        for (const tip of match?.tips ?? []) {
          if (!cumulativePointsByPlayer.has(tip.playerId)) continue
          if (!Number.isFinite(tip.points)) continue
          cumulativePointsByPlayer.set(
            tip.playerId,
            (cumulativePointsByPlayer.get(tip.playerId) ?? 0) + tip.points,
          )
        }
      }
    }

    const playerOrder = new Map(players.map((player, index) => [player.id, index]))
    const payoutsByPlayer = calculateMatchPayouts(
      selectedMatch,
      playerOrder,
      manualPayoutOverridesByMatchId,
      remainderRecipientByMatchId,
    )

    return selectedMatch.tips
      .map((tip) => {
        const player = players.find((item) => item.id === tip.playerId)
        const rank =
          rankByPlayerForSelectedMatch.get(tip.playerId) ??
          scoreboard.findIndex((item) => item.id === tip.playerId) + 1
        const previousRank = rankByPlayerForPreviousMatch.get(tip.playerId)
        const canShowRankDelta = isMatchEvaluated && Number.isFinite(tip.points)
        const rankDelta = canShowRankDelta && Number.isFinite(previousRank) ? previousRank - rank : 0
        const payout = payoutsByPlayer.get(tip.playerId) ?? 0
        return {
          ...tip,
          playerName: player?.name ?? tip.playerId,
          playerAvatar: player?.avatar ?? '',
          tipNote: formatTipNote(tip.updatedAt, tip.updatedState, tip.updatedByUsername),
          tipValueHidden: Boolean(tip.tipValueHidden),
          rank,
          rankDelta,
          totalPoints: cumulativePointsByPlayer.get(tip.playerId) ?? 0,
          payout,
        }
      })
      .sort((a, b) => a.rank - b.rank)
  }, [orderedMatches, players, rankSnapshotByMatchId, scoreboard, selectedMatch, remainderRecipientByMatchId])

  const [syncMessage, setSyncMessage] = useState('')
  const [showSyncTooltip, setShowSyncTooltip] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)

  const standingsMetricOptions = [
    { value: 'points', label: 'Vše' },
    { value: 'totalWinnings', label: `Pen${String.fromCharCode(237)}ze` },
    { value: 'winnings', label: 'Tipy' },
    { value: 'exact', label: '10 bodů' },
    { value: 'near', label: '5 bodů' },
    { value: 'win', label: '3 body' },
    { value: 'miss', label: '0 bodů' },
    { value: 'noBet', label: 'N/N' },
  ]

  const selectedStandingsMetricLabel =
    standingsMetricOptions.find((option) => option.value === standingsMetric)?.label ?? 'Vše'

  const getStandingsMetricValue = (player, metric) => {
    if (metric === 'totalWinnings') return Number(player.winnings) || 0
    if (metric === 'winnings') return Number(player.matchWinnings) || 0
    if (metric === 'exact') return Number(player.stats?.exact) || 0
    if (metric === 'near') return Number(player.stats?.near) || 0
    if (metric === 'win') return Number(player.stats?.win) || 0
    if (metric === 'miss') return Number(player.stats?.miss) || 0
    if (metric === 'noBet') return Number(player.stats?.noBet) || 0
    return Number(player.points) || 0
  }

  const formatStandingsMetricValue = (player, metric) => {
    if (metric === 'totalWinnings') return `${Number(player.winnings) || 0} Kč`
    if (metric === 'winnings') return `${Number(player.matchWinnings) || 0} Kč`
    if (metric === 'exact') return `${Number(player.stats?.exact) || 0}×`
    if (metric === 'near') return `${Number(player.stats?.near) || 0}×`
    if (metric === 'win') return `${Number(player.stats?.win) || 0}×`
    if (metric === 'miss') return `${Number(player.stats?.miss) || 0}×`
    if (metric === 'noBet') return `${Number(player.stats?.noBet) || 0}×`
    return `${Number(player.points) || 0} b`
  }

  const formatStandingsSecondaryValue = (player, metric) => {
    if (metric !== 'points') return ''
    return `${Number(player.winnings) || 0} Kč`
  }

  const getStandingsWinningsBreakdown = (player) => {
    const longTermPayout = Number(player.longTermPayout) || 0
    if (longTermPayout <= 0) return null

    return {
      matchWinnings: Number(player.matchWinnings) || 0,
      longTermPayout,
    }
  }

  const displayedStandings = useMemo(() => {
    const playerOrder = new Map(scoreboard.map((player, index) => [player.id, index]))
    const payoutConfig = (selectedTournament?.longTermBank?.payouts ?? [])
      .map((item) => ({
        place: Number(item?.place),
        amount: Number(item?.amount) || 0,
      }))
      .filter((item) => Number.isFinite(item.place) && item.place >= 1 && item.amount > 0)

    const applyLongTermPayout = (baseRows) => {
      const longTermByPlayer = new Map(baseRows.map((player) => [player.id, 0]))
      const fullStandingByPlayer = new Map(standings.map((player) => [player.id, player]))
      const bankStatsByPlayer = new Map(
        scoreboard.map((player) => [player.id, fullStandingByPlayer.get(player.id)?.stats ?? {}]),
      )
      const pointsRankedRows = rankPlayersByLongTermBank(scoreboard, bankStatsByPlayer, selectedTournament?.tieBreakOrder)

      for (const payout of payoutConfig) {
        const playerAtPlace = pointsRankedRows[payout.place - 1]
        if (!playerAtPlace) continue
        longTermByPlayer.set(playerAtPlace.id, (longTermByPlayer.get(playerAtPlace.id) ?? 0) + payout.amount)
      }

      return baseRows.map((player) => {
        const fallbackMatchWinnings = (Number(player.winnings) || 0) - (Number(player.longTermPayout) || 0)
        const matchWinnings = Number(player.matchWinnings)
        const normalizedMatchWinnings = Number.isFinite(matchWinnings) ? matchWinnings : fallbackMatchWinnings
        const longTermPayout = longTermByPlayer.get(player.id) ?? 0
        return {
          ...player,
          stats: player.stats ?? { exact: 0, near: 0, win: 0, miss: 0, noBet: 0 },
          matchWinnings: normalizedMatchWinnings,
          longTermPayout,
          winnings: normalizedMatchWinnings + longTermPayout,
        }
      })
    }

    const rows = (() => {
      if (standingsFormWindow === 'all') {
        const baseRows = standings.map((player) => ({
          ...player,
          matchWinnings: Number(player.matchWinnings),
        }))
        return applyLongTermPayout(baseRows)
      }

      const windowSize = Number(standingsFormWindow)
      if (!Number.isFinite(windowSize) || windowSize <= 0) {
        const baseRows = standings.map((player) => ({
          ...player,
          matchWinnings: Number(player.matchWinnings),
        }))
        return applyLongTermPayout(baseRows)
      }

      const recentPlayedMatches = playedMatches.slice(-windowSize)
      const pointsByPlayer = new Map(scoreboard.map((player) => [player.id, 0]))
      const payoutsByPlayer = new Map(scoreboard.map((player) => [player.id, 0]))
      const statsByPlayer = new Map(
        scoreboard.map((player) => [
          player.id,
          {
            exact: 0,
            near: 0,
            win: 0,
            miss: 0,
            noBet: 0,
          },
        ]),
      )

      for (const match of recentPlayedMatches) {
        const payouts = calculateMatchPayouts(
          match,
          playerOrder,
          manualPayoutOverridesByMatchId,
          remainderRecipientByMatchId,
        )
        for (const [playerId, payout] of payouts.entries()) {
          payoutsByPlayer.set(playerId, (payoutsByPlayer.get(playerId) ?? 0) + (Number(payout) || 0))
        }

        for (const tip of match.tips ?? []) {
          if (!pointsByPlayer.has(tip.playerId)) continue

          const points = Number.isFinite(tip.points) ? tip.points : 0
          pointsByPlayer.set(tip.playerId, (pointsByPlayer.get(tip.playerId) ?? 0) + points)

          const stats = statsByPlayer.get(tip.playerId)
          if (!stats) continue
          if (tip.points === 10) stats.exact += 1
          if (tip.points === 5) stats.near += 1
          if (tip.points === 3) stats.win += 1
          if (isNoBetPick(tip.pick)) stats.noBet += 1
          if (tip.points === 0 && !isNoBetPick(tip.pick)) stats.miss += 1
        }
      }

      const baseRows = scoreboard.map((player) => {
        const matchWinnings = (payoutsByPlayer.get(player.id) ?? 0) + (bonusWinningsByPlayerId[player.id] ?? 0)
        return {
          ...player,
          points: pointsByPlayer.get(player.id) ?? 0,
          stats: statsByPlayer.get(player.id) ?? { exact: 0, near: 0, win: 0, miss: 0, noBet: 0 },
          matchWinnings,
        }
      })
      return applyLongTermPayout(baseRows)
    })()

    return rows
      .sort((a, b) => {
        const diff = getStandingsMetricValue(b, standingsMetric) - getStandingsMetricValue(a, standingsMetric)
        if (diff !== 0) return diff
        return (playerOrder.get(a.id) ?? 999) - (playerOrder.get(b.id) ?? 999)
      })
  }, [standingsFormWindow, standings, playedMatches, scoreboard, remainderRecipientByMatchId, standingsMetric, selectedTournament])

  useEffect(() => {
    let cancelled = false

    const loadLiveData = async () => {
      if (activeProduct === 'tips') setIsLiveLoading(true)
      try {
        let nextData
        let lastError
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            nextData = await fetchLiveData(selectedTournamentId)
            break
          } catch (error) {
            lastError = error
            if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 500))
          }
        }
        if (!nextData) throw lastError || new Error('Živá data nejsou dostupná')
        if (!cancelled) {
          setData(nextData)
        }
      } catch {
        if (!cancelled) {
          setData(selectedTournamentId === defaultTournamentId ? { players: fallbackPlayers, matches: fallbackMatches } : emptyData)
        }
      } finally {
        if (!cancelled) {
          setIsLiveLoading(false)
        }
      }
    }

    loadLiveData()

    return () => {
      cancelled = true
    }
  }, [activeProduct, selectedTournamentId])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    // Nejblizsi zacatek zapasu, ktery jeste nezacal - v tu chvili se ma odkryt tip ostatnich hracu.
    const now = Date.now()
    const nextStartMs = data.matches
      .map((match) => new Date(match.startsAt).getTime())
      .filter((timeMs) => Number.isFinite(timeMs) && timeMs > now)
      .reduce((earliest, timeMs) => (earliest === null || timeMs < earliest ? timeMs : earliest), null)

    if (nextStartMs === null) return undefined

    const maxDelayMs = 6 * 60 * 60 * 1000
    const delayMs = Math.min(maxDelayMs, Math.max(1000, nextStartMs - now + 1000))
    let cancelled = false

    const timeoutId = window.setTimeout(() => {
      fetchLiveData(selectedTournamentId)
        .then((nextData) => {
          if (!cancelled) setData(nextData)
        })
        .catch(() => {})
    }, delayMs)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [data.matches, selectedTournamentId])

  useEffect(() => {
    return () => {
      if (tooltipTimerRef.current) {
        clearTimeout(tooltipTimerRef.current)
      }
    }
  }, [])

  const showTooltip = (message, duration = 5200) => {
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current)
    }
    const text = String(message ?? '')
    const adaptiveDuration = Math.min(12000, Math.max(duration, 2600 + text.length * 30))
    setSyncMessage(message)
    setShowSyncTooltip(true)
    tooltipTimerRef.current = setTimeout(() => {
      setShowSyncTooltip(false)
      tooltipTimerRef.current = null
    }, adaptiveDuration)
  }

  const handleLogoClick = async (event) => {
    if (event.detail < 3 || isSyncing) return

    setIsSyncing(true)
    showTooltip('Synchronizace s Google tabulkou...', 15000)

    try {
      if (import.meta.env.PROD) {
        const previousData = data
        const nextData = await fetchLiveData(defaultTournamentId)
        if (selectedTournamentId === defaultTournamentId) {
          setData(nextData)
        }
        showTooltip(buildLiveSyncMessage(previousData, nextData))
        return
      }

      let response
      let payload

      try {
        response = await fetch('/api/sync-sheet', { method: 'POST' })
        payload = await response.json()
      } catch {
        try {
          response = await fetch('http://localhost:4000/api/sync-sheet', { method: 'POST' })
          payload = await response.json()
        } catch {
          throw new Error('API není dostupné')
        }
      }

      if (!response.ok || !payload?.ok) {
        showTooltip(payload?.message || 'Synchronizace selhala')
      } else {
        const nextData = await fetchLiveData(defaultTournamentId).catch(() => null)
        if (nextData && selectedTournamentId === defaultTournamentId) {
          setData(nextData)
        }
        showTooltip(payload.message || 'Synchronizace dokončena')
      }
    } catch {
      showTooltip(
        'API není dostupné. Lokálně musí běžet backend na portu 4000. Ve workspace už to má startovat samo; když ne, zkus obnovit okno VS Code.',
        9000,
      )
    } finally {
      setIsSyncing(false)
    }
  }

  const refreshCurrentTournament = async () => {
    const [catalogResult, dataResult] = await Promise.allSettled([
      fetchTournamentCatalog(),
      fetchLiveData(selectedTournamentId),
    ])
    if (catalogResult.status === 'fulfilled') setAvailableTournaments(catalogResult.value)
    if (dataResult.status === 'fulfilled') setData(dataResult.value)
    return catalogResult.status === 'fulfilled' || dataResult.status === 'fulfilled'
  }

  const handleTournamentUpdated = refreshCurrentTournament
  const handleTipUpdated = refreshCurrentTournament
  const handleMatchesChanged = refreshCurrentTournament

  const refreshFantasyTournaments = async () => {
    const nextTournaments = await fetchFantasyTournamentCatalog()
    setAvailableFantasyTournaments(nextTournaments)
    return nextTournaments
  }

  const selectTournament = (nextTournamentId) => {
    window.clearTimeout(tournamentMenuCloseTimerRef.current)
    setIsLiveLoading(true)
    setData(nextTournamentId === defaultTournamentId ? { players: fallbackPlayers, matches: fallbackMatches } : emptyData)
    setSelectedTournamentId(nextTournamentId)
    setActiveProduct('tips')
    setIsTournamentMenuOpen(false)
    setIsTournamentMenuHovered(false)
    const url = new URL(window.location.href)
    url.searchParams.set('tournament', nextTournamentId)
    window.history.replaceState({}, '', url)
  }

  const selectFantasyTournament = (nextTournamentId) => {
    window.clearTimeout(tournamentMenuCloseTimerRef.current)
    setSelectedTournamentId(nextTournamentId)
    setActiveProduct('fantasy')
    setIsTournamentMenuOpen(false)
    setIsTournamentMenuHovered(false)
    setFantasyRefreshKey((current) => current + 1)
    const url = new URL(window.location.href)
    url.searchParams.set('tournament', nextTournamentId)
    window.history.replaceState({}, '', url)
  }

  const openTournamentMenuFromHover = (product) => {
    window.clearTimeout(tournamentMenuCloseTimerRef.current)
    setTournamentMenuProduct(product)
    setIsTournamentMenuHovered(true)
  }

  const closeTournamentMenuFromHover = () => {
    window.clearTimeout(tournamentMenuCloseTimerRef.current)
    tournamentMenuCloseTimerRef.current = window.setTimeout(() => {
      setIsTournamentMenuHovered(false)
    }, 220)
  }

  const isTournamentMenuVisible = isTournamentMenuOpen || isTournamentMenuHovered
  const isTipsTournamentMenuVisible = isTournamentMenuVisible && tournamentMenuProduct === 'tips'
  const isFantasyTournamentMenuVisible = isTournamentMenuVisible && tournamentMenuProduct === 'fantasy'

  return (
    <main className={`layout is-${activeProduct}`}>
      <header className={`hero hero-${activeProduct}`}>
        <div className="hero-content">
          <div className="hero-identity">
            <span className="hero-brand-name">Master of PP</span>
            <span className="hero-section">{activeProduct === 'fantasy' ? 'Fantasy' : 'Tipovačka'}</span>
          </div>
          <h1>{activeProduct === 'fantasy' ? selectedFantasyTournament?.title ?? selectedFantasyTournament?.label ?? 'Fantasy' : selectedTournament?.title ?? selectedTournament?.label ?? 'MOPP turnaj'}</h1>
          <div className="tournament-subtitle-row">
            <p className="tournament-subtitle">{activeProduct === 'fantasy' ? selectedFantasyTournament?.season ? `Sezóna ${selectedFantasyTournament.season}` : 'Fantasy soutěž' : selectedTournament?.subtitle ?? 'Tipovací soutěž'}</p>
          </div>
          {(activeProduct === 'fantasy' ? selectedFantasyTournament : selectedTournament) ? (() => {
            const status = getTournamentStatus(activeProduct === 'fantasy' ? selectedFantasyTournament : selectedTournament)
            return <span className={`tournament-status hero-tournament-status is-${status.key}`}>{status.label}</span>
          })() : null}
        </div>

        <figure className="hero-logo-wrap">
          {activeProduct === 'fantasy' ? (
            <img className="hero-logo fantasy-hero-logo" src={selectedFantasyTournament?.heroLogo || '/fantasy.png'} alt={`Logo turnaje ${selectedFantasyTournament?.title ?? selectedFantasyTournament?.label ?? 'Fantasy'}`} />
          ) : (
            <button type="button" className="hero-logo-button" onClick={handleLogoClick}>
              <img
                className="hero-logo"
                src={selectedTournament?.heroLogo ?? '/tournaments/2026-logo.svg'}
                alt={`Logo turnaje ${selectedTournament?.title ?? selectedTournament?.label ?? ''}`}
                loading="lazy"
              />
            </button>
          )}
          {showSyncTooltip ? (
            <span className={`sync-tooltip ${isSyncing ? 'is-info' : ''}`}>{syncMessage}</span>
          ) : null}
        </figure>
      </header>

      <nav className="account-nav" aria-label="Navigace účtu">
        <div className="account-nav-main">
          <div className="product-nav" aria-label="Sekce Master of PP" ref={productTournamentMenuRef}>
            <div
              className={`product-tournament-control${isTipsTournamentMenuVisible ? ' is-open' : ''}`}
              onMouseEnter={() => openTournamentMenuFromHover('tips')}
              onMouseLeave={closeTournamentMenuFromHover}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setIsTournamentMenuOpen(false)
                  setIsTournamentMenuHovered(false)
                }
              }}
            >
              <div className="product-tournament-buttons">
                <button type="button" aria-pressed={activeProduct === 'tips'} className={`product-tab product-tips-tab${activeProduct === 'tips' ? ' is-active' : ''}`} onClick={() => setActiveProduct('tips')}>
                  Tipovačka
                </button>
                <button
                  type="button"
                  className={`product-tournament-toggle${activeProduct === 'tips' ? ' is-active' : ''}`}
                  aria-label="Vybrat turnaj Tipovačky"
                  aria-haspopup="listbox"
                  aria-expanded={isTipsTournamentMenuVisible}
                  onPointerUp={(event) => {
                    setTournamentMenuProduct('tips')
                    if (event.pointerType !== 'mouse') setIsTournamentMenuOpen((current) => !current)
                  }}
                  onClick={(event) => {
                    setTournamentMenuProduct('tips')
                    if (event.detail === 0) setIsTournamentMenuOpen((current) => !current)
                  }}
                >
                  <span className="tournament-menu-chevron" aria-hidden="true" />
                </button>
              </div>
              {isTipsTournamentMenuVisible ? (
                <div className="tournament-menu product-tournament-menu" role="listbox" aria-label="Výběr turnaje Tipovačky" onMouseEnter={() => openTournamentMenuFromHover('tips')} onMouseLeave={closeTournamentMenuFromHover}>
                  {availableTournaments.map((tournament) => {
                    const status = getTournamentStatus(tournament)
                    return (
                      <button type="button" role="option" aria-selected={tournament.id === selectedTournamentId} className={`tournament-menu-option is-${status.key}${tournament.id === selectedTournamentId ? ' is-selected' : ''}`} key={tournament.id} onClick={() => selectTournament(tournament.id)}>
                        <span>{tournament.shortLabel ?? tournament.title ?? tournament.label}</span>
                        <small>{status.key === 'finished' ? 'Archiv' : status.label}</small>
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
            <div className={`product-tournament-control${isFantasyTournamentMenuVisible ? ' is-open' : ''}`}
              onMouseEnter={() => openTournamentMenuFromHover('fantasy')}
              onMouseLeave={closeTournamentMenuFromHover}
            >
              <div className="product-tournament-buttons">
                <button type="button" role="tab" aria-selected={activeProduct === 'fantasy'} className={`product-tab product-tips-tab${activeProduct === 'fantasy' ? ' is-active' : ''}`} onClick={() => {
                  setIsTournamentMenuOpen(false)
                  setIsTournamentMenuHovered(false)
                  setActiveProduct('fantasy')
                }}>Fantasy</button>
                <button type="button" className={`product-tournament-toggle${activeProduct === 'fantasy' ? ' is-active' : ''}`} aria-label="Vybrat Fantasy turnaj" aria-haspopup="listbox" aria-expanded={isFantasyTournamentMenuVisible} onPointerUp={(event) => {
                  setTournamentMenuProduct('fantasy')
                  if (event.pointerType !== 'mouse') setIsTournamentMenuOpen((current) => !current)
                }} onClick={(event) => {
                  setTournamentMenuProduct('fantasy')
                  if (event.detail === 0) setIsTournamentMenuOpen((current) => !current)
                }}><span className="tournament-menu-chevron" aria-hidden="true" /></button>
              </div>
              {isFantasyTournamentMenuVisible ? (
                <div className="tournament-menu product-tournament-menu" role="listbox" aria-label="Výběr Fantasy turnaje" onMouseEnter={() => openTournamentMenuFromHover('fantasy')} onMouseLeave={closeTournamentMenuFromHover}>
                  {availableFantasyTournaments.map((tournament) => {
                    const status = getTournamentStatus(tournament)
                    return <button type="button" role="option" aria-selected={tournament.id === selectedTournamentId} className={`tournament-menu-option is-${status.key}${tournament.id === selectedTournamentId ? ' is-selected' : ''}`} key={tournament.id} onClick={() => selectFantasyTournament(tournament.id)}><span>{tournament.shortLabel ?? tournament.title ?? tournament.label}</span><small>{status.key === 'finished' ? 'Archiv' : status.label}</small></button>
                  })}
                  {availableFantasyTournaments.length === 0 ? <span className="tournament-menu-option">Zatím žádný Fantasy turnaj</span> : null}
                </div>
              ) : null}
            </div>
          </div>
          <AuthPanel activeProduct={activeProduct} selectedTournamentId={activeProduct === 'fantasy' ? activeFantasyTournamentId : selectedTournamentId} selectedTournament={selectedTournament} selectedFantasyTournament={selectedFantasyTournament} fantasyRefreshKey={fantasyRefreshKey} onFantasyUpdated={async (nextTournamentId) => { await refreshFantasyTournaments(); if (nextTournamentId) { setSelectedTournamentId(nextTournamentId); setActiveProduct('fantasy') }; setFantasyRefreshKey((current) => current + 1) }} onTournamentUpdated={handleTournamentUpdated} onMatchesChanged={handleMatchesChanged} onTipUpdated={handleTipUpdated} />
        </div>
      </nav>

      {activeProduct === 'fantasy' ? <FantasyOverview selectedTournamentId={activeFantasyTournamentId} selectedTournament={selectedFantasyTournament} refreshKey={fantasyRefreshKey} /> : (
      <>
      <section className="panel controls-panel">
        <div className="panel-head">
          <h2>
            {formatRound(effectiveSelectedRound, roundLabel)}
            {roundDateLabel ? (
              <span className="heading-meta" aria-hidden="true">
                <span className="heading-separator">·</span>
                <span>{roundDateLabel}</span>
              </span>
            ) : null}
          </h2>
          <div className="round-panel-actions">
            <button type="button" className={`info-toggle round-filter-toggle ${hidePlayedRounds ? 'is-active' : ''}`.trim()} aria-pressed={hidePlayedRounds} onClick={() => setHidePlayedRounds((prev) => !prev)}>
              {hidePlayedRounds ? 'Zobrazit odehraná kola' : 'Skrýt odehraná kola'}
            </button>
          </div>
        </div>

        <div
          ref={roundTabsRef}
          className={`round-tabs ${isRoundTabsMultiRow ? 'is-multi-row' : ''}`.trim()}
          role="tablist"
          aria-label={`Výběr ${roundLabel}`}
        >
          {visibleRounds.map((round) => {
            const timeClass =
              highlightCurrentRound
                ? round < currentRound
                  ? 'is-past'
                  : round > currentRound
                    ? 'is-future'
                    : 'is-current'
                : ''
            const activeClass = round === effectiveSelectedRound ? 'is-active' : ''
            const isCurrentRound = highlightCurrentRound && round === currentRound

            return (
              <button
                key={round}
                type="button"
                className={`round-tab ${timeClass} ${activeClass}`.trim()}
                aria-current={isCurrentRound ? 'date' : undefined}
                onClick={() => setSelectedRound(round)}
              >
                <span className="round-tab-label">{formatRound(round, roundLabel)}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="panel day-matches-panel">
        <div className="panel-head">
          <h2>Zápasy dne · {selectedMatchStageLabel}</h2>
          {roundDateLabel ? <span className="tag">{roundDateLabel}</span> : null}
        </div>

        <div className="day-matches-row">
          {roundMatches.map((match) => {
            const homeFlag = getMatchTeamLogoUrl(selectedTournamentId, match.home, selectedTournament?.logoSet)
            const awayFlag = getMatchTeamLogoUrl(selectedTournamentId, match.away, selectedTournament?.logoSet)
            const teamLogoClassName = getTeamLogoClassName(selectedTournamentId, selectedTournament?.logoSet)
            const isActive = match.id === selectedMatch?.id
            const submittedTips = match.tipCount ?? match.tips.filter((tip) => tip.pick && tip.pick !== '-').length
            const score = parseScore(match.score)

            return (
              <button
                key={match.id}
                type="button"
                className={`match-item ${isActive ? 'is-active' : ''} ${roundMatches.length > 1 ? 'is-clickable' : ''}`.trim()}
                onClick={() => setSelectedMatchId(match.id)}
              >
                <p className="match-item-top">
                  <StartsAtLabel startsAt={match.startsAt} matchId={match.id} round={match.round} tournamentYear={String(selectedTournament?.startDate ?? '').slice(0, 4)} />
                </p>
                {match.selectedByName ? <span className="match-item-meta">Vybral: {match.selectedByName}</span> : null}
                {match.updatedByAdminName ? <span className="match-item-admin-note">(Editoval admin)</span> : null}

                <div className="match-item-main">
                  <div className="teams-stack">
                    <span className="team-inline">
                      <span className="team-left">
                        {homeFlag ? (
                          <img className={`flag ${teamLogoClassName}`} src={homeFlag} alt={`Logo ${match.home}`} loading="lazy" />
                        ) : null}
                        {getTeamDisplayName(match.home)}
                      </span>
                      <strong className={`team-goals ${score.winner === 'home' ? 'is-winner' : ''}`}>
                        {score.home ?? '-'}
                      </strong>
                    </span>
                    <span className="team-inline">
                      <span className="team-left">
                        {awayFlag ? (
                          <img className={`flag ${teamLogoClassName}`} src={awayFlag} alt={`Logo ${match.away}`} loading="lazy" />
                        ) : null}
                        {getTeamDisplayName(match.away)}
                      </span>
                      <strong className={`team-goals ${score.winner === 'away' ? 'is-winner' : ''}`}>
                        {score.away ?? '-'}
                      </strong>
                    </span>
                  </div>
                </div>

                <p className="match-item-sub">Bank {match.bank == null ? '? (čeká na výsledek předchozího zápasu)' : `${match.bank} Kč`} • <span className="ratio-help" title="Odevzdané tipy / Počet členů vybraného turnaje" aria-label="Odevzdané tipy / Počet členů vybraného turnaje">Tipy {submittedTips}/{match.playerCount ?? players.length}</span></p>
              </button>
            )
          })}
        </div>
      </section>

      <section className="workspace">
        <aside className="panel match-list-panel">
          <div className="panel-head">
            <h2>
              {standingsFormWindow === 'all' ? 'Pořadí hráčů' : `Pořadí hráčů (${standingsFormWindow}z)`}
              <span className="standings-metric-active" aria-hidden="true">
                <span className="heading-separator">·</span>
                <span>{selectedStandingsMetricLabel}</span>
              </span>
            </h2>
            <span className={`standings-metric-shell ${standingsMetric !== 'points' ? 'is-filtered' : ''}`.trim()}>
              <select
                className="standings-metric-select"
                aria-label="Řazení pořadí"
                value={standingsMetric}
                onChange={(event) => setStandingsMetric(event.target.value)}
              >
                {standingsMetricOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </span>
          </div>

          <div className="standings-list">
            {displayedStandings.map((player, index) => {
              const winningsBreakdown = getStandingsWinningsBreakdown(player)
              const isMoneyMetric = standingsMetric === 'winnings' || standingsMetric === 'totalWinnings'
              const isTipsMetric = standingsMetric === 'winnings'
              return (
              <article className="stand-card" key={player.id}>
                <div className="stand-top">
                  <p className="stand-rank">{index + 1}.</p>
                  <h3>
                    <button
                      type="button"
                      className={`stand-player-button ${player.id === effectiveSelectedPlayerId ? 'is-active' : ''}`}
                      onClick={() => toggleSelectedPlayerId(player.id)}
                      title="Zobrazit detail hráče"
                    >
                      <span>{player.name}</span>
                    </button>
                  </h3>
                  <strong className="stand-points">{formatStandingsMetricValue(player, standingsMetric)}</strong>
                </div>

                {!isMoneyMetric ? (
                <div className="stand-bottom">
                  <div className="stand-stats">
                    <span className={`stat-pill is-exact ${standingsMetric === 'exact' ? 'is-active' : ''}`.trim()}>
                      <span className="stat-label">10b</span>
                      <strong className="stat-count">{player.stats.exact}×</strong>
                    </span>
                    <span className={`stat-pill is-near ${standingsMetric === 'near' ? 'is-active' : ''}`.trim()}>
                      <span className="stat-label">5b</span>
                      <strong className="stat-count">{player.stats.near}×</strong>
                    </span>
                    <span className={`stat-pill is-win ${standingsMetric === 'win' ? 'is-active' : ''}`.trim()}>
                      <span className="stat-label">3b</span>
                      <strong className="stat-count">{player.stats.win}×</strong>
                    </span>
                    <span className={`stat-pill is-miss ${standingsMetric === 'noBet' ? 'is-active' : ''}`.trim()}>
                      <span className="stat-label">N</span>
                      <strong className="stat-count">{player.stats.noBet}×</strong>
                    </span>
                  </div>
                  {standingsMetric === 'points' || winningsBreakdown ? (
                    <span
                      className={`stand-winnings${winningsBreakdown ? '' : ' is-placeholder'}`.trim()}
                      title={(() => {
                        if (!winningsBreakdown) return undefined
                        return `Zápasy: ${winningsBreakdown.matchWinnings} Kč · Dlouhodobý bank: ${winningsBreakdown.longTermPayout} Kč`
                      })()}
                    >
                      {winningsBreakdown ? (
                        <span className="bank-icon" aria-hidden="true" title="Dlouhodobý bank">💰</span>
                      ) : null}
                      <span className="stand-winnings-total">{formatStandingsSecondaryValue(player, standingsMetric)}</span>
                    </span>
                  ) : null}
                </div>
                ) : null}
                {isMoneyMetric ? (
                  <p
                    className={`stand-bank-note ${winningsBreakdown ? '' : 'is-hidden'}`.trim()}
                    title={winningsBreakdown ? `Dlouhodobý bank: +${winningsBreakdown.longTermPayout} Kč` : undefined}
                  >
                    {winningsBreakdown ? (
                      isTipsMetric ? (
                        <>
                          <span className="bank-icon" aria-hidden="true">💰</span>
                          <span>{`+${winningsBreakdown.longTermPayout} Kč`}</span>
                        </>
                      ) : (
                        <>
                          <span>{`${winningsBreakdown.matchWinnings} Kč +`}</span>
                          <span className="bank-icon" aria-hidden="true">💰</span>
                          <span>{`${winningsBreakdown.longTermPayout} Kč`}</span>
                        </>
                      )
                    ) : (
                      '+'
                    )}
                  </p>
                ) : null}
              </article>
              )
            })}
          </div>

          <div className="standings-window-controls" role="group" aria-label="Rozsah pořadí podle formy">
            <span className="player-window-label">Aktuální forma:</span>
            {[5, 10, 15, 'all'].map((option) => {
              const isActive = standingsFormWindow === option || (option === 'all' && standingsFormWindow === 'all')
              const label = option === 'all' ? 'vše' : `${option} z`
              return (
                <button
                  key={`standings-window-${option}`}
                  type="button"
                  className={`player-window-tab ${isActive ? 'is-active' : ''}`}
                  onClick={() => setStandingsFormWindow(option)}
                >
                  {label}
                </button>
              )
            })}
          </div>

        </aside>

        <section className="panel detail-panel">
          {selectedPlayerProfile ? (
            <>
              <div className="panel-head player-focus-headline" ref={playerDetailHeadingRef}>
                <h2 className="player-focus-title">
                  {selectedPlayerProfile.avatar ? <img className="user-avatar user-avatar-player" src={selectedPlayerProfile.avatar} alt="" /> : <span className="user-avatar user-avatar-player is-placeholder" aria-hidden="true">{selectedPlayerProfile.name.slice(0, 1).toUpperCase()}</span>}
                  <span>Statistika hráče</span>
                  <span className="player-focus-separator" aria-hidden="true">|</span>
                  <span className="player-focus-player-name">{selectedPlayerProfile.name}</span>
                  {selectedPlayerProfile.entryFeePaid ? (
                    <span className="player-entry-fee-badge" title="Vstupné uhrazeno">✓ Uhrazeno</span>
                  ) : (
                    <span className="player-entry-fee-badge is-pending" title="Vstupné neuhrazeno">• Neuhrazeno</span>
                  )}
                </h2>
                <button
                  type="button"
                  className="info-toggle player-focus-close"
                  onClick={() => setSelectedPlayerId('')}
                >
                  <span>Zavřít</span>
                  <span className="player-focus-close-icon" aria-hidden="true">&times;</span>
                </button>
              </div>

              <div className="player-window-controls" role="group" aria-label="Rozsah formy hráče">
                <span className="player-window-label">Vyber:</span>
                {[5, 10, 15, 20, 25, 'all'].map((option) => {
                  const isActive = selectedPlayerProfile.formWindow === option || (option === 'all' && selectedPlayerProfile.formWindow === 'all')
                  const label = option === 'all' ? 'vše' : `${option} z`
                  return (
                    <button
                      key={String(option)}
                      type="button"
                      className={`player-window-tab ${isActive ? 'is-active' : ''}`}
                      onClick={() => setPlayerFormWindow(option)}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>

              <p className="player-window-note tip-callout tip-callout-note">
                <span className="tip-callout-prefix">
                  <span className="tip-callout-icon" aria-hidden="true">i</span>
                  <span className="tip-callout-label">Tip:</span>
                </span>
                <span className="tip-callout-text">
                  filtrem lze přepínat mezi celkovou statistikou a posledními zápasy, tedy aktuální formou.
                </span>
              </p>

              {/*
              <section className="player-tip-progress-row" aria-label="Aktivita tipování">
                <article className="player-tip-progress">
                  <h3>Natipováno hráčem (odehrané zápasy)</h3>
                  <p>
                    <strong>{selectedPlayerProfile.tippedMatchesCount}/{selectedPlayerProfile.totalMatchesCount}</strong>
                    {' '}
                    ({selectedPlayerProfile.playerTipCoverage} %)
                  </p>
                </article>
                <article className="player-tip-progress">
                  <h3>Natipováno všichni hráči (odehrané zápasy)</h3>
                  <p>
                    <strong>{allPlayersTipProgress.submittedTips}/{allPlayersTipProgress.totalTipSlots}</strong>
                    {' '}
                    ({allPlayersTipProgress.coverage} %)
                  </p>
                </article>
              </section>
              */}

              <section className="player-rank-mini" aria-label="Vývoj pořadí hráče">
                <div className="player-rank-mini-head">
                  <h3>Vývoj pořadí hráče ({rankChartView === 'day' ? 'po dnech' : 'po zápasech'})</h3>
                  <span className="standings-metric-shell">
                    <select
                      className="standings-metric-select"
                      aria-label="Zobrazení vývoje pořadí"
                      value={rankChartView}
                      onChange={(event) => setRankChartView(event.target.value)}
                    >
                      <option value="day">Po dnech</option>
                      <option value="match">Po zápasech</option>
                    </select>
                  </span>
                </div>
                {selectedPlayerRankSeries ? (
                  <div className="player-rank-mini-wrap" role="img" aria-label={`Vývoj pořadí hráče ${selectedPlayerProfile.name}`}>
                    {(() => {
                      const width = 940
                      const height = 116
                      const margin = { top: 12, right: 20, bottom: 32, left: 36 }
                      const innerWidth = width - margin.left - margin.right
                      const innerHeight = height - margin.top - margin.bottom
                      const rounds = selectedPlayerRankSeries.rounds
                      const ranks = selectedPlayerRankSeries.ranks
                      const maxRank = selectedPlayerRankSeries.maxRank
                      const tickIndexes = buildXAxisTickIndexes(rounds.length, 20)
                      const stepX = rounds.length > 1 ? innerWidth / (rounds.length - 1) : 0
                      const rankToY = (rank) => margin.top + ((rank - 1) / Math.max(1, maxRank - 1)) * innerHeight
                      const indexToX = (index) => margin.left + index * stepX
                      const middleRanks = maxRank >= 8
                        ? [Math.round((maxRank + 1) / 3), Math.round((2 * (maxRank + 1)) / 3)]
                        : [Math.round((maxRank + 1) / 2)]
                      const axisRanks = [1, ...middleRanks, maxRank]
                        .filter((rank, index, arr) => Number.isFinite(rank) && arr.indexOf(rank) === index)
                        .sort((a, b) => a - b)
                      const path = ranks
                        .map((rank, index) => `${index === 0 ? 'M' : 'L'} ${indexToX(index)} ${rankToY(rank)}`)
                        .join(' ')

                      return (
                        <svg viewBox={`0 0 ${width} ${height}`} className="player-rank-mini-chart" preserveAspectRatio="none">
                          <rect x="0" y="0" width={width} height={height} fill="#f9fcff" />

                          {axisRanks.map((rank) => (
                            <g key={`mini-grid-${rank}`}>
                              <line
                                x1={margin.left}
                                y1={rankToY(rank)}
                                x2={width - margin.right}
                                y2={rankToY(rank)}
                                className="rank-grid-line"
                              />
                              <text x={8} y={rankToY(rank) + 4} className="rank-axis-label">
                                {rank}.
                              </text>
                            </g>
                          ))}

                          {rounds.map((round, index) => (
                            tickIndexes.has(index) ? (
                              <text
                                key={`mini-x-${round}`}
                                x={indexToX(index)}
                                y={height - 18}
                                textAnchor="middle"
                                className="rank-axis-label"
                              >
                                {round}
                              </text>
                            ) : null
                          ))}

                          <path d={path} stroke={selectedPlayerRankSeries.color} className="rank-line" />
                          {ranks.map((rank, index) => (
                            <circle
                              key={`${selectedPlayerProfile.id}-mini-rank-${index}`}
                              cx={indexToX(index)}
                              cy={rankToY(rank)}
                              r="2.8"
                              fill={selectedPlayerRankSeries.color}
                              className="rank-line-end"
                            />
                          ))}
                        </svg>
                      )
                    })()}
                  </div>
                ) : (
                  <p className="player-rank-mini-empty">Pro tohoto hráče zatím není graf pořadí k dispozici.</p>
                )}
              </section>

              <section className="player-focus-wide" aria-label="Detail hráče">
                <div className="player-focus-grid">
                <article className="player-focus-card">
                  <h3>Za {selectedPlayerProfile.recentCount} zápasů získáno</h3>
                  <p>
                    <strong>{selectedPlayerProfile.recentPoints}</strong>
                    <span className="player-card-unit"> b</span>
                  </p>
                </article>

                <article className="player-focus-card">
                  <h3>Průměr</h3>
                  <p>
                    <strong>{selectedPlayerProfile.recentAverage}</strong>
                    <span className="player-card-unit"> b/z</span>
                  </p>
                </article>

                <article className="player-focus-card is-trend">
                  <h3><span className="trend-chip">Trend</span></h3>
                  <p>
                    <span className={`player-trend-label is-${selectedPlayerProfile.trendDirection} trend-chip trend-chip-inline`}>
                      <span>{selectedPlayerProfile.trendLabel}</span>
                      {selectedPlayerProfile.trendDeltaText ? (
                        <span className="player-trend-delta">
                          <strong className="player-trend-delta-value">{selectedPlayerProfile.trendDeltaText.split(' ')[0]}</strong>
                          <span className="player-card-unit"> {selectedPlayerProfile.trendDeltaText.split(' ').slice(1).join(' ')}</span>
                        </span>
                      ) : null}
                    </span>
                  </p>

                  {(() => {
                    const sparkline = buildSparkline(
                      selectedPlayerProfile.recentSeries.map((entry) => entry.points),
                      172,
                      56,
                      8,
                    )
                    if (!sparkline.path) return null

                    const baselineY = 58
                    const areaPath = sparkline.dots.length > 0
                      ? `M ${sparkline.dots[0].x.toFixed(2)} ${baselineY} ${sparkline.dots
                        .map((dot) => `L ${dot.x.toFixed(2)} ${dot.y.toFixed(2)}`)
                        .join(' ')} L ${sparkline.dots[sparkline.dots.length - 1].x.toFixed(2)} ${baselineY} Z`
                      : ''

                    return (
                      <svg className="player-sparkline" viewBox="0 0 180 64" preserveAspectRatio="none" role="img" aria-label="Trend bodů hráče">
                        <path className="player-sparkline-area" d={areaPath} />
                        <path className="player-sparkline-line" d={sparkline.path} />
                        {sparkline.dots.map((dot, index) => (
                          <circle
                            key={`${selectedPlayerProfile.id}-${index}`}
                            className={`player-sparkline-dot ${index === sparkline.dots.length - 1 ? 'is-last' : ''}`}
                            cx={dot.x}
                            cy={dot.y}
                            r={index === sparkline.dots.length - 1 ? 2.4 : 1.5}
                          />
                        ))}
                      </svg>
                    )
                  })()}
                </article>
              </div>

              <article className="player-focus-card is-streak-wide">
                <h3>Série tipů</h3>
                <div className="player-streak-grid">
                  <div className="player-streak-item">
                    <span className="player-streak-item-title">S body</span>
                    <div className="player-streak-metrics">
                      <span className="player-streak-value is-current">
                        {selectedPlayerProfile.currentPositiveStreak > 0 &&
                        selectedPlayerProfile.currentPositiveStreak === selectedPlayerProfile.longestPositiveStreak ? (
                          <span className="player-streak-badge">REKORD</span>
                        ) : null}
                        <span className="player-streak-mini-label">Aktuální</span>
                        <span className="player-streak-number">{selectedPlayerProfile.currentPositiveStreak}</span>
                      </span>
                      <span className="player-streak-value is-historical">
                        <span className="player-streak-mini-label">Historická</span>
                        <span className="player-streak-number">{selectedPlayerProfile.longestPositiveStreak}</span>
                      </span>
                    </div>
                  </div>
                  <div className="player-streak-item is-negative">
                    <span className="player-streak-item-title">Bez bodu</span>
                    <div className="player-streak-metrics">
                      <span className="player-streak-value is-current">
                        {selectedPlayerProfile.currentNegativeStreak > 0 &&
                        selectedPlayerProfile.currentNegativeStreak === selectedPlayerProfile.longestNegativeStreak ? (
                          <span className="player-streak-badge is-negative">REKORD</span>
                        ) : null}
                        <span className="player-streak-mini-label">Aktuální</span>
                        <span className="player-streak-number">{selectedPlayerProfile.currentNegativeStreak}</span>
                      </span>
                      <span className="player-streak-value is-historical">
                        <span className="player-streak-mini-label">Historická</span>
                        <span className="player-streak-number">{selectedPlayerProfile.longestNegativeStreak}</span>
                      </span>
                    </div>
                  </div>
                </div>
              </article>

              <div className="player-focus-seq">
                <span className="player-focus-seq-label">Grafický zisk bodů (od nejstaršího)</span>
                <div className="player-form-blocks" aria-label="Body v posledních zápasech">
                  {selectedPlayerProfile.recentSeries.length > 0 ? (
                    selectedPlayerProfile.recentSeries.map((entry, index) => (
                      <span
                        key={`${selectedPlayerProfile.id}-form-${index}`}
                        className={`player-form-block ${formBlockClass(entry)}`}
                        title={entry.isNoBet ? 'N/N (bez tipu)' : `${entry.points} b`}
                        aria-label={entry.isNoBet ? 'N/N bez tipu' : `${entry.points} bodů`}
                      />
                    ))
                  ) : (
                    <span className="player-form-empty">–</span>
                  )}
                </div>
              </div>

              <section className="player-success" aria-label="Úspěšnost tipů">
                <div className="player-success-head">
                  <h3>Úspěšnost tipů</h3>
                  <span
                    className={`player-success-benchmark ${
                      selectedPlayerProfile.successRatesDelta.scored > 0
                        ? 'is-up'
                        : selectedPlayerProfile.successRatesDelta.scored < 0
                          ? 'is-down'
                          : 'is-flat'
                    }`}
                  >
                    {selectedPlayerProfile.successRatesDelta.scored > 0
                      ? `o ${selectedPlayerProfile.successRatesDelta.scored} % lepší než průměr`
                      : selectedPlayerProfile.successRatesDelta.scored < 0
                        ? `o ${Math.abs(selectedPlayerProfile.successRatesDelta.scored)} % horší než průměr`
                        : 'stejné jako průměr'}
                  </span>
                </div>
                <div className="player-success-grid">
                  <div className="player-success-item is-exact">
                    <span className="player-success-label">10 bodů</span>
                    <div className="player-success-main">
                      <strong className="player-success-value">{selectedPlayerProfile.successCounts.exact}×</strong>
                      <span className="player-success-count">{selectedPlayerProfile.successRates.exact} %</span>
                    </div>
                  </div>
                  <div className="player-success-item is-near">
                    <span className="player-success-label">5 bodů</span>
                    <div className="player-success-main">
                      <strong className="player-success-value">{selectedPlayerProfile.successCounts.near}×</strong>
                      <span className="player-success-count">{selectedPlayerProfile.successRates.near} %</span>
                    </div>
                  </div>
                  <div className="player-success-item is-win">
                    <span className="player-success-label">3 body</span>
                    <div className="player-success-main">
                      <strong className="player-success-value">{selectedPlayerProfile.successCounts.win}×</strong>
                      <span className="player-success-count">{selectedPlayerProfile.successRates.win} %</span>
                    </div>
                  </div>
                  <div className="player-success-item is-total">
                    <span className="player-success-label">Úspěšnost</span>
                    <div className="player-success-main">
                      <strong className="player-success-value">{selectedPlayerProfile.successRates.scored} %</strong>
                    </div>
                  </div>
                  <div className="player-success-item is-miss">
                    <span className="player-success-label">0 bodů</span>
                    <div className="player-success-main">
                      <strong className="player-success-value">{selectedPlayerProfile.successCounts.miss}×</strong>
                      <span className="player-success-count">{selectedPlayerProfile.successRates.miss} %</span>
                    </div>
                  </div>
                  <div className="player-success-item is-nobet">
                    <span className="player-success-label">N/N</span>
                    <div className="player-success-main">
                      <strong className="player-success-value">{selectedPlayerProfile.successCounts.noBet}×</strong>
                      <span className="player-success-count">{selectedPlayerProfile.successRates.noBet} %</span>
                    </div>
                  </div>
                  <div className="player-success-item is-one-goal">
                    <span className="player-success-label">±1 gól</span>
                    <div className="player-success-main">
                      <strong className="player-success-value">{selectedPlayerProfile.successCounts.oneGoalOff}×</strong>
                      <span className="player-success-count">{selectedPlayerProfile.successRates.oneGoalOff} %</span>
                    </div>
                  </div>
                </div>
              </section>

              <section className="player-field-compare" aria-label="Tipy proti většině">
                <h3>Tipy proti většině</h3>
                <div className="player-field-compare-grid">
                  <div className="player-field-item">
                    <span>Tipy mimo většinu</span>
                    <strong>{selectedPlayerProfile.valueInsights.againstMajority}×</strong>
                  </div>
                  <div className="player-field-item">
                    <span>10b u odlišných tipů</span>
                    <strong>{selectedPlayerProfile.valueInsights.exactRate} % ({selectedPlayerProfile.valueInsights.exactAgainstMajority}×)</strong>
                  </div>
                  <div className="player-field-item">
                    <span>Body z těchto tipů</span>
                    <strong>{selectedPlayerProfile.valueInsights.pointsAgainstMajority} b</strong>
                  </div>
                  <div className="player-field-item">
                    <span>Průměr z těchto tipů</span>
                    <strong>{selectedPlayerProfile.valueInsights.avgPoints} b/z</strong>
                  </div>
                </div>
              </section>

              <section className="player-field-compare" aria-label="Srovnání hráče s polem">
                <h3>Srovnání s polem</h3>
                <div className="player-field-compare-grid">
                  <div className="player-field-item">
                    <span>V poli je před</span>
                    <strong>{selectedPlayerProfile.fieldComparison.percentile} % hráčů</strong>
                  </div>
                  <div className="player-field-item">
                    <span>Proti středu pole</span>
                    <strong
                      className={`player-field-value ${
                        selectedPlayerProfile.fieldComparison.vsMiddle > 0
                          ? 'is-up'
                          : selectedPlayerProfile.fieldComparison.vsMiddle < 0
                            ? 'is-down'
                            : 'is-flat'
                      }`}
                    >
                      {selectedPlayerProfile.fieldComparison.vsMiddle > 0 ? '+' : ''}
                      {selectedPlayerProfile.fieldComparison.vsMiddle.toFixed(2)} b/z
                    </strong>
                  </div>
                  <div className="player-field-item">
                    <span>{selectedPlayerProfile.fieldComparison.top3GapLabel}</span>
                    <strong>{selectedPlayerProfile.fieldComparison.top3GapValue} b</strong>
                  </div>
                  <div className="player-field-item player-field-item-placement">
                    <span>Umístění (nejlépe | nejhůře)</span>
                    <strong>
                      <span className="placement-current">{selectedPlayerPlacement?.currentRank ?? '-'}.</span>
                      <span className="placement-range">({selectedPlayerPlacement?.bestRank ?? '-'}. | {selectedPlayerPlacement?.worstRank ?? '-'}.)</span>
                    </strong>
                  </div>
                </div>
              </section>

              <section className="player-money-wide" aria-label="Peněžní bilance hráče">
                <div className="player-money-head">
                  <h3>Peněžní bilance</h3>
                  <span>Tato statistika se nefiltruje</span>
                </div>
                <div className="player-money-grid">
                  <article className="money-stat-box is-outflow">
                    <span>Vloženo celkem</span>
                    <strong className={`money-amount ${moneyAmountClass(-selectedPlayerProfile.moneySummary.totalInserted)}`}>
                      {formatMoneyWithSign(-selectedPlayerProfile.moneySummary.totalInserted)}
                    </strong>
                  </article>
                  <article className="money-stat-box is-win">
                    <span>Výhry ze zápasů</span>
                    <strong className={`money-amount ${moneyAmountClass(selectedPlayerProfile.moneySummary.realizedWinnings)}`}>
                      {formatMoneyWithSign(selectedPlayerProfile.moneySummary.realizedWinnings)}
                    </strong>
                  </article>
                  <article className={`money-stat-box is-now ${selectedPlayerProfile.moneySummary.currentBalance >= 0 ? 'is-up' : 'is-down'}`}>
                    <span>Čistý zisk</span>
                    <strong className={`money-amount ${moneyAmountClass(selectedPlayerProfile.moneySummary.currentBalance)}`}>
                      {formatMoneyWithSign(selectedPlayerProfile.moneySummary.currentBalance)}
                    </strong>
                  </article>
                  {selectedPlayerProfile.moneySummary.currentLongTermPayout > 0 ? (
                    <article className={`money-stat-box is-now ${selectedPlayerProfile.moneySummary.currentBalanceWithBank >= 0 ? 'is-up' : 'is-down'}`}>
                      <span>Čistý zisk s bankem</span>
                      <strong className={`money-amount ${moneyAmountClass(selectedPlayerProfile.moneySummary.currentBalanceWithBank)}`}>
                        {formatMoneyWithSign(selectedPlayerProfile.moneySummary.currentBalanceWithBank)}
                      </strong>
                    </article>
                  ) : null}
                </div>
                <article className="money-potential-strip" aria-label="Potenciální zisk podle umístění">
                  <span className="money-potential-label">Potenciální zisk podle umístění</span>
                  <div className="money-potential-values">
                    {selectedPlayerProfile.moneySummary.potentialBalances.map(({ place, balance }) => (
                      <p className="money-potential-value" key={place}>
                        <span>{place}.</span>
                        <strong className={`money-amount ${moneyAmountClass(balance)}`}>
                          {formatMoneyWithSign(balance)}
                        </strong>
                      </p>
                    ))}
                  </div>
                </article>
              </section>
              </section>
            </>
          ) : null}

          {selectedMatch ? (
            <>
              <div className="panel-head tips-panel-head">
                <h2>Tipy hráčů pro zápas</h2>
                <span className="tag ratio-help" title="Odevzdané tipy / Počet členů vybraného turnaje" aria-label="Odevzdané tipy / Počet členů vybraného turnaje">Tipy {selectedMatch.tipCount ?? selectedMatchTips.filter((tip) => tip.pick && tip.pick !== '-').length}/{selectedMatch.playerCount ?? players.length}</span>
              </div>

              <header className="selected-match-head">
                <p className="selected-match-time">
                  <StartsAtLabel startsAt={selectedMatch.startsAt} matchId={selectedMatch.id} round={selectedMatch.round} tournamentYear={String(selectedTournament?.startDate ?? '').slice(0, 4)} />
                </p>
                {selectedMatch.selectedByName ? <p className="selected-match-meta">Vybral: {selectedMatch.selectedByName}</p> : null}
                <div className="selected-match-main">
                  <div className="selected-teams-stack">
                    {(() => {
                      const homeFlag = getMatchTeamLogoUrl(selectedTournamentId, selectedMatch.home, selectedTournament?.logoSet)
                      const awayFlag = getMatchTeamLogoUrl(selectedTournamentId, selectedMatch.away, selectedTournament?.logoSet)
                      const teamLogoClassName = getTeamLogoClassName(selectedTournamentId, selectedTournament?.logoSet)
                      const score = parseScore(selectedMatch.score)

                      return (
                        <>
                          <span className="team-inline">
                            <span className="team-left">
                              {homeFlag ? (
                                <img
                                  className={`flag ${teamLogoClassName}`}
                                  src={homeFlag}
                                  alt={`Logo ${selectedMatch.home}`}
                                  loading="lazy"
                                />
                              ) : null}
                              {getTeamDisplayName(selectedMatch.home)}
                            </span>
                            <strong className={`team-goals ${score.winner === 'home' ? 'is-winner' : ''}`}>
                              {score.home ?? '-'}
                            </strong>
                          </span>

                          <span className="team-inline">
                            <span className="team-left">
                              {awayFlag ? (
                                <img
                                  className={`flag ${teamLogoClassName}`}
                                  src={awayFlag}
                                  alt={`Logo ${selectedMatch.away}`}
                                  loading="lazy"
                                />
                              ) : null}
                              {getTeamDisplayName(selectedMatch.away)}
                            </span>
                            <strong className={`team-goals ${score.winner === 'away' ? 'is-winner' : ''}`}>
                              {score.away ?? '-'}
                            </strong>
                          </span>
                        </>
                      )
                    })()}
                  </div>
                </div>
                <div className="selected-match-bottom">
                  <p className="selected-match-bank">Bank {selectedMatch.bank == null ? '? (čeká na výsledek předchozího zápasu)' : `${selectedMatch.bank} Kč`}</p>
                  {selectedMatch.updatedByAdminName ? <p className="selected-match-admin-note">(Editoval admin)</p> : null}
                </div>
              </header>

              {selectedMatch.tipsVisible === false ? (
                <>
                  <p className="tips-hidden-message">Tipy ostatních hráčů se zobrazí po začátku zápasu.</p>
                </>
              ) : null}

              <div className="tips-table" role="table" aria-label="Tipy hráčů">
                <div className="tips-head" role="row">
                  <span>Poř.</span>
                  <span className="tips-head-shift" aria-hidden="true" />
                  <span>Hráč</span>
                  <span>Tip</span>
                  <span>Výhra</span>
                  <span>Celkem</span>
                  <span>Zápas</span>
                </div>

                {selectedMatchTips.map((tip) => (
                  <div className="tips-row" role="row" key={`${selectedMatch.id}-${tip.playerId}`}>
                    <span className="rank-cell">{tip.rank}.</span>
                    <span className="shift-cell">
                      {tip.rankDelta > 0 ? (
                        <span className="rank-shift is-up" aria-label={`Posun nahoru o ${tip.rankDelta} míst`} title={`+${tip.rankDelta}`}>
                          ↑{tip.rankDelta}
                        </span>
                      ) : tip.rankDelta < 0 ? (
                        <span className="rank-shift is-down" aria-label={`Propad o ${Math.abs(tip.rankDelta)} míst`} title={`-${Math.abs(tip.rankDelta)}`}>
                          ↓{Math.abs(tip.rankDelta)}
                        </span>
                      ) : (
                        <span className="rank-shift is-flat" aria-hidden="true" />
                      )}
                    </span>
                    <span className="name-cell">
                      <button
                        type="button"
                        className={`tip-player-button ${tip.playerId === effectiveSelectedPlayerId ? 'is-active' : ''}`}
                        onClick={() => toggleSelectedPlayerId(tip.playerId)}
                        title="Zobrazit detail hráče"
                      >
                        {tip.playerAvatar ? <img className="user-avatar user-avatar-tip" src={tip.playerAvatar} alt="" /> : <span className="user-avatar user-avatar-tip is-placeholder" aria-hidden="true">{tip.playerName.slice(0, 1).toUpperCase()}</span>}
                        <span className="player-name">{tip.playerName}</span>
                      </button>
                      {tip.tipNote ? <span className="tip-note">{tip.tipNote}</span> : null}
                    </span>

                    <span className="tip-value">
                      {tip.tipValueHidden ? <span className="hidden-tip-value">skryto</span> : <SplitTip value={tip.pick} />}
                    </span>

                    <span className="payout-cell">
                      {tip.payout > 0 ? <span className="payout-badge">+{tip.payout} Kč</span> : null}
                    </span>

                    <span className="total-points-cell">{tip.totalPoints}</span>

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

      <section className="panel long-term-bank-panel" aria-label="Dlouhodobý bank">
        <article className={`long-term-bank-card ${showLongTermBankInfo ? 'is-open' : ''}`.trim()}>
          <button
            type="button"
            className="long-term-bank-toggle"
            aria-expanded={showLongTermBankInfo}
            onClick={() => setShowLongTermBankInfo((prev) => !prev)}
          >
            <span className="long-term-bank-toggle-label">
              <span className="bank-icon" aria-hidden="true">💰</span>
              <span>{longTermBank?.introLabel ?? 'Dlouhodobý bank'}</span>
            </span>
            <span className="long-term-bank-toggle-summary">
              <strong className="long-term-bank-toggle-value">{longTermBank?.totalAmount ?? 0} Kč</strong>
              {longTermBank?.contributorCount > 0 && longTermBank?.contributionAmount > 0 ? (
                <small>Příspěvky hráčů · {longTermBank.contributorCount} × {longTermBank.contributionAmount} Kč</small>
              ) : null}
            </span>
            <span className="long-term-bank-toggle-hint">{showLongTermBankInfo ? 'Skrýt detail' : 'Zobrazit detail'}</span>
          </button>

          {showLongTermBankInfo ? (
            <div className="long-term-bank-info">
              <p className="long-term-bank-summary">{longTermBank?.introSuffix ?? 'se rozdělí takto:'}</p>

              <ol className="long-term-bank-payouts">
                {(longTermBank?.payouts ?? []).map((item) => (
                  <li
                    key={item.place}
                    className={`long-term-bank-place ${
                      item.place === 1 ? 'is-exact' : item.place === 2 ? 'is-near' : 'is-win'
                    }`}
                  >
                    <strong>{item.place}.</strong>
                    <span className="long-term-bank-amount">{item.amount} Kč</span>
                  </li>
                ))}
              </ol>

              <div className="long-term-bank-rules">
                <h3>{longTermBank?.tieBreakHeading ?? 'V případě shodného počtu bodů rozhoduje:'}</h3>
                <ol>
                  {(longTermBank?.tieBreakRules ?? []).map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ol>
              </div>
            </div>
          ) : null}
        </article>
      </section>

      <section className="panel rank-chart-panel">
        <div className="panel-head">
          <h2>Vývoj pořadí hráčů ({rankChartView === 'day' ? 'po dnech' : 'po zápasech'})</h2>
          <span className="standings-metric-shell">
            <select
              className="standings-metric-select"
              aria-label="Zobrazení vývoje pořadí"
              value={rankChartView}
              onChange={(event) => setRankChartView(event.target.value)}
            >
              <option value="day">Po dnech</option>
              <option value="match">Po zápasech</option>
            </select>
          </span>
        </div>

        {rankTimeline.rounds.length > 0 ? (
          <>
            <div className="rank-chart-wrap" role="img" aria-label="Graf vývoje pořadí hráčů">
              {(() => {
                const width = 940
                const height = 330
                const margin = { top: 16, right: 18, bottom: 38, left: 40 }
                const innerWidth = width - margin.left - margin.right
                const innerHeight = height - margin.top - margin.bottom
                const maxRank = rankTimeline.series.length
                const stepX = rankTimeline.rounds.length > 1 ? innerWidth / (rankTimeline.rounds.length - 1) : 0
                const tickIndexes = buildXAxisTickIndexes(rankTimeline.rounds.length, 24)
                const rankToY = (rank) => margin.top + ((rank - 1) / Math.max(1, maxRank - 1)) * innerHeight
                const indexToX = (index) => margin.left + index * stepX
                const visibleSeries = rankTimeline.series.filter((player) => normalizedVisiblePlayerIds.includes(player.id))

                return (
                  <svg viewBox={`0 0 ${width} ${height}`} className="rank-chart" preserveAspectRatio="xMidYMid meet">
                    <rect x="0" y="0" width={width} height={height} fill="#f9fcff" />

                    {Array.from({ length: maxRank }, (_, i) => i + 1).map((rank) => (
                      <g key={`grid-${rank}`}>
                        <line
                          x1={margin.left}
                          y1={rankToY(rank)}
                          x2={width - margin.right}
                          y2={rankToY(rank)}
                          className="rank-grid-line"
                        />
                        <text x={8} y={rankToY(rank) + 4} className="rank-axis-label">
                          {rank}.
                        </text>
                      </g>
                    ))}

                    {rankTimeline.rounds.map((round, index) => (
                      tickIndexes.has(index) ? (
                        <text
                          key={`x-${round}`}
                          x={indexToX(index)}
                          y={height - 20}
                          textAnchor="middle"
                          className="rank-axis-label"
                        >
                          {round}
                        </text>
                      ) : null
                    ))}

                    <text x={width / 2} y={height - 4} textAnchor="middle" className="rank-axis-title">
                      {rankTimeline.axisLabel}
                    </text>

                    {visibleSeries.map((player) => {
                      const hasHover = Boolean(hoveredPlayerId)
                      const isHovered = hoveredPlayerId === player.id
                      const path = player.ranks
                        .map((rank, index) => `${index === 0 ? 'M' : 'L'} ${indexToX(index)} ${rankToY(rank)}`)
                        .join(' ')

                      return (
                        <g key={player.id}>
                          <path
                            d={path}
                            stroke={player.color}
                            className={`rank-line ${hasHover && !isHovered ? 'is-dim' : ''} ${isHovered ? 'is-highlight' : ''}`.trim()}
                            aria-label={`Hráč ${player.name}`}
                            onMouseEnter={() => setHoveredPlayerId(player.id)}
                            onMouseLeave={() => setHoveredPlayerId('')}
                            onClick={() => setHoveredPlayerId(player.id)}
                          >
                            <title>{player.name}</title>
                          </path>
                          {player.ranks.map((rank, index) => (
                            <circle
                              key={`${player.id}-pt-${index}`}
                              cx={indexToX(index)}
                              cy={rankToY(rank)}
                              r="2.6"
                              fill={player.color}
                              className={`rank-line-end ${hasHover && !isHovered ? 'is-dim' : ''} ${isHovered ? 'is-highlight' : ''}`.trim()}
                              aria-label={`Hráč ${player.name}`}
                              onMouseEnter={() => setHoveredPlayerId(player.id)}
                              onMouseLeave={() => setHoveredPlayerId('')}
                              onClick={() => setHoveredPlayerId(player.id)}
                            >
                              <title>{player.name}</title>
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
                  className={`rank-legend-item ${normalizedVisiblePlayerIds.includes(player.id) ? '' : 'is-muted'} ${hoveredPlayerId && hoveredPlayerId !== player.id ? 'is-dim' : ''} ${hoveredPlayerId === player.id ? 'is-hover' : ''}`.trim()}
                  key={`legend-${player.id}`}
                  onClick={() => {
                    if (touchLegendHandledRef.current) {
                      touchLegendHandledRef.current = false
                      return
                    }
                    togglePlayerVisibility(player.id)
                  }}
                  onTouchStart={(event) => {
                    event.preventDefault()
                    touchLegendHandledRef.current = true

                    if (hoveredPlayerId !== player.id) {
                      setHoveredPlayerId(player.id)
                      return
                    }

                    togglePlayerVisibility(player.id)
                    setHoveredPlayerId('')
                  }}
                  onMouseEnter={() => setHoveredPlayerId(player.id)}
                  onMouseLeave={() => setHoveredPlayerId('')}
                  onFocus={() => setHoveredPlayerId(player.id)}
                  onBlur={() => setHoveredPlayerId('')}
                >
                  <span className="rank-legend-dot" style={{ backgroundColor: player.color }} />
                  {player.name}
                </button>
              ))}
            </div>
            <p className="rank-legend-hint tip-callout">
              <span className="tip-callout-prefix">
                <span className="tip-callout-icon" aria-hidden="true">i</span>
                <span className="tip-callout-label">Tip:</span>
              </span>
              <span className="tip-callout-text">přejetím přes jméno v legendě nebo přes čáru či bod grafu zobrazíš hráče v tooltipu a zvýrazníš jeho jméno; kliknutím na jméno hráče čáru skryješ/zobrazíš.</span>
            </p>
          </>
        ) : (
          <p>Zatím nejsou data pro graf.</p>
        )}
      </section>
      </>
      )}
    </main>
  )
}

export default App
