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

export function getTeamLogoUrl(tournamentId, teamName, logoSet = '') {
  const normalizedName = String(teamName ?? '').trim()
  if (!normalizedName) return null

  const tournamentLogos = teamLogosByTournament[tournamentId] ?? teamLogosBySet[logoSet]
  if (!tournamentLogos) return null

  return tournamentLogos[normalizedName] ?? null
}
