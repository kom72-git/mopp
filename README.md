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
- Vercel: runtime API nestaci, protoze frontend cte data ze statickeho buildu. Trojklik ma na produkci volat Vercel Deploy Hook a novy build si pri `npm run build` sam stahne cerstva data diky `prebuild` skriptu.
- Pro Vercel nastav promennou `VITE_VERCEL_DEPLOY_HOOK` na URL deploy hooku. Bez ni se produkcni web neumi bezpecne synchronizovat.
