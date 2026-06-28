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

Preview build pouziva `http://localhost:4174` (`npm run preview`).

## Synchronizace Google Sheet

- Lokalne: spust `npm run dev:api` a pak trojklik na logo provede `POST /api/sync-sheet`, ktery prepise `src/data/moppData.js`.
- Web ted pri nacteni i trojkliku umi sahnout na `/api/data`, ktere vraci cerstva data primo z Google Sheetu. Kvuli zmene tipu uz tedy neni potreba delat commit.
- Lokalne trojklik porad prepise `src/data/moppData.js`, aby zustal aktualni fallback pro build a lokalni vyvoj.
- Na Vercelu musi byt dostupna serverless funkce `/api/data`, ktera cte Google Sheet za behu.
