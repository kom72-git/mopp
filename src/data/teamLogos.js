const elhTeamLogos = {
    Boleslav: '/loga/mbl.png',
    Brno: '/loga/kom.png',
    Budějovice: '/loga/ceb.png',
    Hradec: '/loga/hkr.png',
    'Karlovy Vary': '/loga/kva.png',
    Liberec: '/loga/lib.png',
    Litvínov: '/loga/lit.png',
    Kladno: '/loga/kla.png',
    Olomouc: '/loga/olo.png',
    Pardubice: '/loga/pce.png',
    Plzeň: '/loga/plz.png',
    Sparta: '/loga/spa.png',
    Třinec: '/loga/tri.png',
    Vítkovice: '/loga/vit.png',
}

const teamLogosByTournament = {
  'PO-2025': elhTeamLogos,
}

const teamLogosBySet = {
  elh: elhTeamLogos,
}

const elhTeamNameAliases = {
  'Hradec Králové': 'Hradec',
  'Hr. Králové': 'Hradec',
  'Mountfield HK': 'Hradec',
  'HK Mountfield': 'Hradec',
  MHK: 'Hradec',
  'BK Mladá Boleslav': 'Boleslav',
  'Ml. Boleslav': 'Boleslav',
  'Mladá Boleslav': 'Boleslav',
  MBL: 'Boleslav',
}

const elhTeamDisplayNames = {
  Boleslav: 'Mladá Boleslav',
  Brno: 'Kometa Brno',
  Budějovice: 'České Budějovice',
  Hradec: 'Hradec Králové',
  'Karlovy Vary': 'Karlovy Vary',
  Liberec: 'Bílí Tygři Liberec',
  Litvínov: 'Litvínov',
  Kladno: 'Kladno',
  Olomouc: 'Olomouc',
  Pardubice: 'Pardubice',
  Plzeň: 'Plzeň',
  Sparta: 'Sparta Praha',
  Třinec: 'Třinec',
  Vítkovice: 'Vítkovice',
}

function normalizeTeamName(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function getElhAlias(teamName) {
  const normalizedName = normalizeTeamName(teamName)
  const directAlias = Object.entries(elhTeamNameAliases).find(([name]) => normalizeTeamName(name) === normalizedName)?.[1]
  if (directAlias) return directAlias
  if (normalizedName.includes('hradec') || normalizedName.includes('mountfield') || normalizedName === 'mhk') return 'Hradec'
  if (normalizedName.includes('boleslav') || normalizedName === 'mbl') return 'Boleslav'
  return null
}

export function getTeamDisplayName(teamName) {
  const normalizedName = String(teamName ?? '').trim()
  if (!normalizedName) return normalizedName
  const canonicalName = getElhAlias(normalizedName) ?? normalizedName
  return elhTeamDisplayNames[canonicalName] ?? normalizedName
}

export function getTeamLogoUrl(tournamentId, teamName, logoSet = '') {
  const normalizedName = String(teamName ?? '').trim()
  if (!normalizedName) return null

  const tournamentLogos = teamLogosByTournament[tournamentId] ?? teamLogosBySet[logoSet]
  if (!tournamentLogos) return null

  return tournamentLogos[normalizedName] ?? tournamentLogos[elhTeamNameAliases[normalizedName]] ?? tournamentLogos[getElhAlias(normalizedName)] ?? null
}
