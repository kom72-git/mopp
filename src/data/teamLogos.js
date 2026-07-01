const teamLogosByTournament = {
  'PO-2025': {
    Boleslav: '/loga/mbl.png',
    Brno: '/loga/kom.png',
    Budějovice: '/loga/ceb.png',
    Hradec: '/loga/hkr.png',
    'K. Vary': '/loga/kva.png',
    Liberec: '/loga/lib.png',
    Litvínov: '/loga/lit.png',
    Pardubice: '/loga/pce.png',
    Plzeň: '/loga/plz.png',
    Sparta: '/loga/spa.png',
    Třinec: '/loga/tri.png',
    Vítkovice: '/loga/vit.png',
  },
}

export function getTeamLogoUrl(tournamentId, teamName) {
  const normalizedName = String(teamName ?? '').trim()
  if (!normalizedName) return null

  const tournamentLogos = teamLogosByTournament[tournamentId]
  if (!tournamentLogos) return null

  return tournamentLogos[normalizedName] ?? null
}
