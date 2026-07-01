export const tournaments = [
  {
    id: '2026',
    label: '2026',
    title: 'MS ve fotbale 2026',
    tabTitle: 'MS fotbal 2026', // title v záložce prohlížeče
    sheetId: '1cdrtECld-UgY8qjcc2UajQwcO3F85u1EgV2EU2sc9Lw',
    gid: '134828351',
    heroLogo: '/tournaments/2026-logo.svg',
    favicon: '/icons/ball.svg',
    roundLabel: 'den',
    startDate: '2026-06-11',
    longTermBank: {
      introLabel: 'Dlouhodobý bank',
      totalAmount: 1650,
      introSuffix: 'se rozdělí:',
      payouts: [
        { place: 1, amount: 900 },
        { place: 2, amount: 500 },
        { place: 3, amount: 250 },
      ],
      tieBreakHeading: 'V případě shodného počtu bodů rozhoduje:',
      tieBreakRules: [
        'Počet uhodnutých přesných výsledků za 10b.',
        'V případě rovnosti uhodnutých výsledků, rozhoduje celkový počet bodovaných tipů.',
        'Pokud je i zde rovnost, rozhoduje menší počet netipovaných výsledků.',
        'V případě i této rovnosti následuje los :-)',
      ],
    },
    // Editace času tipů pro jednotlivé zápasy (u starých tipů)
    // příklad: 'm1, p8, 2026-06-29 17:30'
    manualTipTimestampEntries: [
      'm41, p11, 2026-06-28 12:14', 
    ],
  },
  {
    id: 'PO-2025',
    label: 'PO-2025',
    title: 'Play-off hokejové extraligy 2025',
    tabTitle: 'Play-off ELH 2025',
    sheetId: '1cdrtECld-UgY8qjcc2UajQwcO3F85u1EgV2EU2sc9Lw',
    gid: '2015707050',
    heroLogo: '/tournaments/elh-PO2025.png',
    favicon: '/icons/puck.svg',
    roundLabel: 'kolo',
    startDate: '2025-03-07',
    longTermBank: {
      introLabel: 'Dlouhodobý bank',
      totalAmount: 800,
      introSuffix: 'se rozdělí:',
      payouts: [
        { place: 1, amount: 500 },
        { place: 2, amount: 200 },
        { place: 3, amount: 100 },
      ],
      tieBreakHeading: 'V případě shodného počtu bodů rozhoduje:',
      tieBreakRules: [
        'Počet uhodnutých přesných výsledků za 10b.',
        'V případě rovnosti uhodnutých výsledků, rozhoduje celkový počet bodovaných tipů.',
        'Pokud je i zde rovnost, rozhoduje menší počet netipovaných výsledků.',
        'V případě i této rovnosti následuje los :-)',
      ],
    },
    // Editace času tipů pro jednotlivé zápasy (u starých tipů)
    // příklad: 'm1, p8, 2026-06-29 17:30'
    manualTipTimestampEntries: [
       
    ],
  },
]

export const defaultTournamentId = tournaments[0]?.id ?? ''

export function getTournamentById(tournamentId) {
  return tournaments.find((tournament) => tournament.id === tournamentId) ?? tournaments[0] ?? null
}