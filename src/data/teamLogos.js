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
  'Č. Budějovice': 'Budějovice',
  'České Budějovice': 'Budějovice',
  'ČEZ Motor České Budějovice': 'Budějovice',
  'Hradec Králové': 'Hradec',
  'Hr. Králové': 'Hradec',
  'Mountfield HK': 'Hradec',
  'HK Mountfield': 'Hradec',
  MHK: 'Hradec',
  'Kometa Brno': 'Brno',
  'HC Kometa Brno': 'Brno',
  'BK Mladá Boleslav': 'Boleslav',
  'Ml. Boleslav': 'Boleslav',
  'M. Boleslav': 'Boleslav',
  'Mladá Boleslav': 'Boleslav',
  MBL: 'Boleslav',
  'K. Vary': 'Karlovy Vary',
  'Karlovy Vary': 'Karlovy Vary',
  'Bílí Tygři Liberec': 'Liberec',
  'Sparta Praha': 'Sparta',
  'HC Sparta Praha': 'Sparta',
  'HC Oceláři Třinec': 'Třinec',
  'HC Vítkovice Ridera': 'Vítkovice',
  'HC Škoda Plzeň': 'Plzeň',
  'HC Dynamo Pardubice': 'Pardubice',
  'HC Verva Litvínov': 'Litvínov',
  'Rytíři Kladno': 'Kladno',
  'HC Olomouc': 'Olomouc',
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
  if (normalizedName.includes('budejovice')) return 'Budějovice'
  if (normalizedName.includes('hradec') || normalizedName.includes('mountfield') || normalizedName === 'mhk') return 'Hradec'
  if (normalizedName.includes('brno') || normalizedName.includes('kometa')) return 'Brno'
  if (normalizedName.includes('boleslav') || normalizedName === 'mbl') return 'Boleslav'
  if (normalizedName.includes('karlovy vary') || normalizedName === 'k vary') return 'Karlovy Vary'
  if (normalizedName.includes('liberec')) return 'Liberec'
  if (normalizedName.includes('kladno')) return 'Kladno'
  if (normalizedName.includes('litvinov')) return 'Litvínov'
  if (normalizedName.includes('olomouc')) return 'Olomouc'
  if (normalizedName.includes('pardubice')) return 'Pardubice'
  if (normalizedName.includes('plzen')) return 'Plzeň'
  if (normalizedName.includes('sparta')) return 'Sparta'
  if (normalizedName.includes('trinec')) return 'Třinec'
  if (normalizedName.includes('vitkovice')) return 'Vítkovice'
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
