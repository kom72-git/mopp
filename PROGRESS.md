# MOPP – Master of PP Project
**Status:** Statický prototyp hotový a běží

## Co je hotovo
- ✅ React + Vite frontend (stejný stack jako u známek)
- ✅ Statický prototyp s:
  1. **Zápasy** – mobilní karty se jménem zápasu, časem, výsledkem, bankem
  2. **Tipy hráčů** – pod každým zápasem seznam tipů s body (10=přesný, 5=vítěz, 3=skóre, 0=miss)
  3. **Pořadí hráčů** – žebříček seřazený podle celkových bodů

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

## Testovací data (zatím hardcodované v App.jsx)
- **4 zápasy**: 2 hotové, 1 v běhu, 1 čekající
- **5 hráčů**: Kom, Kraty, Radek, Roman, Spaca
- **Tipy**: každý hráč má tip na každý zápas s příslušnými body

## Příslušné soubory
- `src/App.jsx` – komponenta s daty a renderingem
- `src/App.css` – styling (mobilní-first, karty, grid)
- `src/index.css` – globální styly (fonty, barvy)
- `vite.config.js` – build config
- `package.json` – dependencies

## Příští kroky (pak řešíme)
1. **Admin interface** – editovat zápasy a tipy
2. **Backend API** – Node.js endpoints pro zápasy, tipy, hráče
3. **MongoDB** – ukládat skutečná data
4. **Autentizace** – přihlašování hráčů (později)
5. **GitHub + Vercel deploy** – jako u známek

## Nápady po MS (roadmapa)
1. **Detail hráče po kliku na jméno**
  - Drawer/panel s profilem hráče.
  - Aktuální forma (např. posledních 5/9 zápasů, body na zápas).
  - Jednoznačný text trendu (roste/klesá/stagnuje).
2. **Grafy pro jednoho hráče**
  - Vývoj bodů po kolech.
  - Vývoj pořadí po kolech.
3. **Heatmapa tipů hráče**
  - Přehled zápasů s barvami 10/5/3/0/N.
  - Rychlý přehled silných/slabých úseků turnaje.
4. **Srovnání hráče**
  - Proti průměru všech.
  - Proti nejbližšímu soupeři v pořadí.
5. **Streak a mini analytika**
  - Série bodovaných tipů.
  - Série bez bodu.
  - Úspěšnost přesný výsledek / vítěz / no-bet.
6. **Implementační pořadí (bez přepisu od nuly)**
  - Nejprve detail hráče + forma.
  - Poté grafy jednoho hráče.
  - Pak heatmapa a porovnání.
  - Nakonec napojení na budoucí auth + DB backend.

---
Pokud jsi nový v projektu: přečti si toto, pak se podívej na prototyp na http://localhost:4173/
