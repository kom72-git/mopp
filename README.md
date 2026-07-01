# MOPP

Samostatny projekt mimo KTF.

## Stack

- Frontend: React + Vite (v koreni projektu)
- API: Node.js + Express v adresari `api`

## Spusteni

1. API

```bash
cd api
npm run dev
```

API bezi na `http://localhost:4000`.

2. Frontend

```bash
npm run dev
```

Frontend bezi na `http://localhost:4173`.

Frontend proxy smeruje `/api` na `http://localhost:4000`.

Preview build pouziva `http://localhost:4174` pouze kdyz spustis `npm run preview`.
Pri beznem vyvoji (`npm run dev`) tenhle port bezne nebezi.

## Porty MOPP (rychly tahak)

- MOPP slozka: /home/node/moop
- KTF slozka: /workspaces/ktf

I kdyz ve VS Code nekdy uvidis i dalsi porty (typicky 3001 a 5173 z jineho projektu),
pro MOPP jsou dulezite jen tyto:

- Frontend (Vite dev): `4173`
- API (Express): `4000`
- Preview (Vite preview): `4174` (jen pro `npm run preview`)

Pro bezne pouziti otevirat:

- `http://localhost:4173` (frontend)
- `http://localhost:4000` (API)

### Porty pres tlacitko Pridat port (bez terminalu)

1. Otevri panel `PORTY` ve VS Code.
2. Klikni na tlacitko `Pridat port`.
3. Zadej port `4000` a potvrď Enter.
4. Znovu klikni na `Pridat port`.
5. Zadej port `4173` a potvrď Enter.
6. U techto dvou portu nech puvod `Automaticky presmerovano` nebo `Vyvojove kontejnery`.
7. Pokud se objevi i `3001` nebo `5173`, klikni na ne pravym tlacitkem a dej `Stop Forwarding` (nebo `Remove Port`).
8. Ve sloupci `Spusteny proces` zkontroluj, ze pro MOPP mas:

- port `4000`: proces `node index.js` (API)
- port `4173`: proces `vite` (frontend)

Pokud je u portu `4000` nebo `4173` sloupec `Spusteny proces` prazdny,
port je jen presmerovany, ale aplikace na nem realne nebezi.

Poznamka:

- `Pridat port` dela jen presmerovani ve VS Code.
- Aplikace se otevre jen kdyz je za tim portem spusteny proces.

### Kde je nastaveni portu v projektu

- `package.json` - frontend dev na `4173`, preview na `4174`
- `api/index.js` - API bezi na `4000`
- `.devcontainer/devcontainer.json` - forward porty pro MOPP
- `.devcontainer/start-services.sh` - auto start + cisteni cizich procesu
- `.vscode/tasks.json` - task `MOPP: Start Services` pri otevreni slozky
- `.vscode/settings.json` - povoleni auto tasku + vypnuta obnova starych forwardu

## Synchronizace Google Sheet

- Lokalne: spust `npm run dev:api` a pak trojklik na logo provede `POST /api/sync-sheet`, ktery prepise `src/data/moppData.js`.
- Web ted pri nacteni i trojkliku umi sahnout na `/api/data`, ktere vraci cerstva data primo z Google Sheetu. Kvuli zmene tipu uz tedy neni potreba delat commit.
- Lokalne trojklik porad prepise `src/data/moppData.js`, aby zustal aktualni fallback pro build a lokalni vyvoj.
- Na Vercelu musi byt dostupna serverless funkce `/api/data`, ktera cte Google Sheet za behu.

### Historie uprav tipu (updatedAt pod jmenem)

- Samotny Google Sheet CSV neobsahuje cas posledni upravy bunky.
- Zakladni rezim je navazany na existujici synchronizaci (trojklik na logo): pri sync se porovnaji tipy a zmenenym tipum se prida cas synchronizace.
- Audit se uklada do `public/tip-audit.json` a API `/api/data` ho automaticky primicha do vysledku jako `updatedAt`.
- Pri prvnim zapnuti se casy zpetne nedoplni hromadne: `updatedAt` se nastavi az pri skutecne zmene tipu zachycene synchronizaci.
- Pro starsi zapasy muzes casy doplnit rucne v [src/data/tournaments.js](src/data/tournaments.js) pres `manualTipUpdatedAtByMatchId`.
- Jednodussi varianta je `manualTipTimestampEntries` s radky typu `m1, p8, 2026-06-29 17:30`.
- Format: `{ m12: { p1: '2026-06-12T09:15:00+02:00', p4: '2026-06-12T09:20:00+02:00' } }`.
- Rucni hodnoty maji prednost pred automatickym casem ze synchronizace, aby se neprepisovaly.
