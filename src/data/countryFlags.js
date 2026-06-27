const countryToCode = {
  'Alžírsko': 'dz',
  'Anglie': 'gb-eng',
  'Argentina': 'ar',
  'Austrálie': 'au',
  'Belgie': 'be',
  'Bosna a Hercegovina': 'ba',
  'Brazílie': 'br',
  'Chorvatsko': 'hr',
  'DR Kongo': 'cd',
  'Egypt': 'eg',
  'Ekvádor': 'ec',
  'Francie': 'fr',
  'Ghana': 'gh',
  'Haiti': 'ht',
  'Irák': 'iq',
  'Japonsko': 'jp',
  'Jihoafrická republika': 'za',
  'Jižní Korea': 'kr',
  'Jordánsko': 'jo',
  'Kanada': 'ca',
  'Kapverdy': 'cv',
  'Katar': 'qa',
  'Kolumbie': 'co',
  'Maroko': 'ma',
  'Mexiko': 'mx',
  'Nizozemsko': 'nl',
  'Norsko': 'no',
  'Nový Zéland': 'nz',
  'Německo': 'de',
  'Panama': 'pa',
  'Paraguay': 'py',
  'Pobřeží slonoviny': 'ci',
  'Portugalsko': 'pt',
  'Rakousko': 'at',
  'Saúdská Arábie': 'sa',
  'Senegal': 'sn',
  'Skotsko': 'gb-sct',
  'Tunisko': 'tn',
  'Turecko': 'tr',
  'USA': 'us',
  'Uruguay': 'uy',
  'Uzbekistán': 'uz',
  'Írán': 'ir',
  'Česko': 'cz',
  'Španělsko': 'es',
  'Švédsko': 'se',
  'Švýcarsko': 'ch',
}

export function getFlagCode(countryName) {
  return countryToCode[countryName] ?? null
}

export function getFlagUrl(countryName) {
  const code = getFlagCode(countryName)
  return code ? `/flags/${code}.svg` : null
}
