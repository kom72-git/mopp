# MOPP – Master of PP Project
**Status:** Aktivní verze běží (frontend + API + hráčské statistiky)

## Co je hotovo
- ✅ React + Vite frontend
- ✅ Node/Express API (`/api/data`, `/api/sync-sheet`)
- ✅ Zápasy dne + výběr kola
- ✅ Tipy hráčů pro vybraný zápas (body, výhry, čas úpravy tipu)
- ✅ Pořadí hráčů + mini trend pořadí
- ✅ Detail hráče se statistikami:
  1. **Filtr formy** (`5/10/15/20/25/vše`) s výchozí volbou `vše`
  2. **Souhrn formy** (body, průměr, trend, index)
  3. **Série bodovaných tipů** (aktuální + historické maximum)
  4. **Úspěšnost tipů** (10/5/3/0/N + benchmark proti průměru)
  5. **Peněžní bilance** (vloženo, výhry, aktuální stav + potenciál 1./2./3. místo)
- ✅ Posun pořadí u tipů se zobrazuje jen u vyhodnocených zápasů
- ✅ Mobilní auto-scroll na detail hráče

## Jak spustit
```bash
npm run dev
# Běží na http://localhost:4173/
```

API běží samostatně na `http://localhost:4000/`.

## Design
- Mobilní-first (priority)
- Responsive breakpointy: 760px (2 sloupce), 1024px (desktop)
- Barvy: modrý gradientní hero, světlé karty, barevné pillky pro body
  - Zelená (10 b) = přesný výsledek
  - Oranžová (5 b) = vítěz + skóre
  - Žlutá (3 b) = jen vítěz
  - Šedá (0 b) = žádné body

## Data
- Primárně živá data přes API `/api/data`
- Fallback data v `src/data/moppData.js`
- Audit časů změn tipů v `public/tip-audit.json`

## Příslušné soubory
- `src/App.jsx` – komponenta s daty a renderingem
- `src/App.css` – styling (mobilní-first, karty, grid)
- `src/index.css` – globální styly (fonty, barvy)
- `vite.config.js` – build config
- `package.json` – dependencies

## Příští kroky (pak řešíme)
1. **Dotažení statistik** – další srovnání hráče proti poli
2. **Admin interface** – editace zápasů/tipů bez zásahu do zdrojáků
3. **Perzistence** – DB vrstva místo souborových fallbacků
4. **Autentizace** – přihlášení hráčů (později)
5. **Deploy polish** – produkční monitoring a automatické kontroly

## Poznámka k filtrům statistik
- **Filtr formy** ovlivňuje výkonnostní statistiky hráče (forma, trend, úspěšnost, série v rámci zobrazení).
- **Peněžní bilance** je celosezónní pohled a filtrem formy se nemění.

---
Pokud jsi nový v projektu: přečti si toto, pak se podívej na prototyp na http://localhost:4173/
