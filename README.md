# TimeSplit API (Express + PostgreSQL)

API para almacenar sesiones de juego con **splits** en milisegundos (modo **carreras** y **fútbol**), con:
- **Upsert** de sesiones con splits.
- **Paginado y filtros** (player, mode, rango de fechas).
- **Leaderboard** por mejor score.
- **Stats** agregadas.
- **Autenticación opcional por API Key**.
- **Docker Compose** (PostgreSQL + API).

> Compatible con el cliente Python del juego (`timesplit_game.py`) vía `sync_to_api`.

---

## Requisitos

- Node.js 18+ (o usa Docker)
- PostgreSQL 14+ (o usa Docker)
- `DATABASE_URL` válida

---

## Estructura
timesplit-api/
├─ server.js
├─ package.json
├─ .gitignore
├─ .dockerignore
├─ .env.example
├─ docker-compose.yml
└─ migrations/
└─ 01_schema.sql


---

## Variables de entorno

Crea un `.env` (opcional) a partir de `.env.example`:

```ini
PORT=3000
DATABASE_URL=postgres://tsr:tsr@localhost:5432/tsr
CORS_ORIGIN=*
API_KEY=           # opcional: si se define, se exige header x-api-key


Si API_KEY está vacío, no se exige autenticación.

Ejecutar con Docker (recomendado)
docker compose up


API: http://localhost:3000

Health: GET /api/health → { "ok": true }

La migración se ejecuta automáticamente en el arranque.

Ejecutar local (sin Docker)

Instala dependencias:

npm i


Asegúrate de tener PostgreSQL corriendo y la DB del DATABASE_URL.

Arranca:

npm run start
# o en desarrollo (reload automático)
npm run dev

Contrato (resumen)
POST /api/sessions (upsert + splits)
{
  "id": "s_abcd1234",
  "player": "Mati",
  "mode": "carreras",      // "futbol"
  "startedAt": 1724880000000,
  "durationMs": 60000,
  "totalScore": 123.45,
  "splits": [
    {"t": 200, "lap": 1, "score": 3.5, "note": null},
    {"t": 400, "lap": 1, "score": 7.2, "note": "SHOT"}
  ]
}


durationMs debe ser ≥ max(splits[].t).

Respuesta:

{ "ok": true, "upserted": "s_abcd1234", "splits_inserted": 2 }

GET /api/sessions

Query: page, limit, player, mode, from, to

Respuesta:

{
  "data": [ { "id":"...", "player":"...", "mode":"...", "started_at":"...", "duration_ms":0, "total_score":"0", "splits": 10 } ],
  "page":1, "limit":25, "total": 83
}

GET /api/sessions/:id

Devuelve la sesión y sus splits (ordenados por t_ms asc).

GET /api/leaderboard?mode&limit

Top N por mejor total_score. Si no se pasa mode, agrupa por jugador y modo.

GET /api/players?limit&search

Lista jugadores: sessions y best_score. search filtra por player ILIKE.

GET /api/modes

Estadísticas por modo: total, promedio y máximo total_score.

GET /api/stats

Totales globales (sessions, players) y promedios por modo.

GET /api/health, /api/version

Salud y versión.

Autenticación (opcional)

Si defines API_KEY, todos los endpoints bajo /api exigirán:

x-api-key: TU_CLAVE


Ejemplo con curl:

curl -X GET "http://localhost:3000/api/leaderboard?mode=carreras" \
  -H "x-api-key: TU_CLAVE"

Pruebas rápidas (curl)
# Salud
curl http://localhost:3000/api/health

# Crear/actualizar sesión
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "id":"s_demo1","player":"Mati","mode":"carreras",
    "startedAt":1724880000000,"durationMs":60000,"totalScore":99.9,
    "splits":[{"t":200,"lap":1,"score":1.1},{"t":400,"lap":1,"score":2.2,"note":"SHOT"}]
  }'

# Listado con filtros
curl "http://localhost:3000/api/sessions?player=Mati&mode=carreras&limit=5"

# Detalle con splits
curl http://localhost:3000/api/sessions/s_demo1

# Leaderboard
curl "http://localhost:3000/api/leaderboard?mode=carreras&limit=5"

# Stats globales
curl http://localhost:3000/api/stats


Si activas API_KEY, añade -H "x-api-key: TU_CLAVE".

Integración con el juego Python

En Windows PowerShell:

setx TSR_API "http://localhost:3000/api/sessions"
setx TSR_API_KEY "TU_CLAVE"   # opcional si activaste API_KEY


En macOS/Linux (bash):

export TSR_API="http://localhost:3000/api/sessions"
export TSR_API_KEY="TU_CLAVE"  # opcional


El juego enviará sesiones con U (Sync).
Si definiste TSR_API_KEY, agrega el header x-api-key en el cliente (ya documentado).

Troubleshooting

ECONNREFUSED: La API no está arriba o el puerto/URL no coinciden con TSR_API.

permission denied for database: revisa usuario/clave/DB de DATABASE_URL.

durationMs must be >= max split.t: ajusta durationMs o tus timestamps t.

unauthorized: te falta el header x-api-key (si activaste API_KEY).

Licencia

MIT — úsalo y modifícalo libremente.


---

## `postman/timesplit-api.postman_collection.json`

> Crea la carpeta `postman/` en el repo y guarda este archivo ahí.

```json
{
  "info": {
    "name": "TimeSplit API",
    "_postman_id": "a0f0faaa-1234-4aaa-bbbb-cccccccccccc",
    "description": "Colección para probar la API de TimeSplit (Express + PostgreSQL). Incluye health, sesiones, leaderboard, stats, etc.",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "variable": [
    { "key": "baseUrl", "value": "http://localhost:3000" },
    { "key": "apiKey",  "value": "" }
  ],
  "item": [
    {
      "name": "Health",
      "request": { "method": "GET", "url": "{{baseUrl}}/api/health" }
    },
    {
      "name": "Version",
      "request": { "method": "GET", "url": "{{baseUrl}}/api/version" }
    },
    {
      "name": "Upsert Session (demo)",
      "request": {
        "method": "POST",
        "header": [
          { "key": "Content-Type", "value": "application/json" },
          { "key": "x-api-key", "value": "{{apiKey}}", "disabled": true }
        ],
        "url": "{{baseUrl}}/api/sessions",
        "body": {
          "mode": "raw",
          "raw": "{\n  \"id\":\"s_demo1\",\n  \"player\":\"Mati\",\n  \"mode\":\"carreras\",\n  \"startedAt\": 1724880000000,\n  \"durationMs\": 60000,\n  \"totalScore\": 99.9,\n  \"splits\": [\n    {\"t\":200, \"lap\":1, \"score\":1.1},\n    {\"t\":400, \"lap\":1, \"score\":2.2, \"note\":\"SHOT\"}\n  ]\n}"
        }
      }
    },
    {
      "name": "List Sessions (filters)",
      "request": {
        "method": "GET",
        "header": [{ "key": "x-api-key", "value": "{{apiKey}}", "disabled": true }],
        "url": {
          "raw": "{{baseUrl}}/api/sessions?player=Mati&mode=carreras&limit=5",
          "host": ["{{baseUrl}}"],
          "path": ["api", "sessions"],
          "query": [
            { "key": "player", "value": "Mati" },
            { "key": "mode", "value": "carreras" },
            { "key": "limit", "value": "5" }
          ]
        }
      }
    },
    {
      "name": "Get Session by ID",
      "request": {
        "method": "GET",
        "header": [{ "key": "x-api-key", "value": "{{apiKey}}", "disabled": true }],
        "url": "{{baseUrl}}/api/sessions/s_demo1"
      }
    },
    {
      "name": "Leaderboard (carreras)",
      "request": {
        "method": "GET",
        "header": [{ "key": "x-api-key", "value": "{{apiKey}}", "disabled": true }],
        "url": "{{baseUrl}}/api/leaderboard?mode=carreras&limit=5"
      }
    },
    {
      "name": "Players",
      "request": {
        "method": "GET",
        "header": [{ "key": "x-api-key", "value": "{{apiKey}}", "disabled": true }],
        "url": "{{baseUrl}}/api/players?limit=50&search=Ma"
      }
    },
    {
      "name": "Modes",
      "request": {
        "method": "GET",
        "header": [{ "key": "x-api-key", "value": "{{apiKey}}", "disabled": true }],
        "url": "{{baseUrl}}/api/modes"
      }
    },
    {
      "name": "Stats",
      "request": {
        "method": "GET",
        "header": [{ "key": "x-api-key", "value": "{{apiKey}}", "disabled": true }],
        "url": "{{baseUrl}}/api/stats"
      }
    }
  ]
}

Cómo usar la colección

Abre Postman → Import → arrastra el JSON o selecciónalo.

En Variables de la colección, ajusta:

baseUrl = http://localhost:3000

apiKey = tu clave (si activaste API_KEY en la API).
Marca el header x-api-key como activo en cada request si usas clave.

Ejecuta las requests en orden: Health → Upsert → List → Get by ID → Leaderboard → Stats.
