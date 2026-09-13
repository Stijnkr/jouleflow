# AGENTS.md

Guidance for AI coding agents (and humans) working on Jouleflow.

## Project

Jouleflow is an open-source home energy management system (EMS). It:

- connects multiple energy devices (P1 smart meter, solar inverters, batteries, heat pumps, EV chargers)
- stores their data locally and shows live + historical charts in a web app
- learns the home's usage patterns and forecasts consumption and solar production
- steers devices based on **fixed or dynamic** tariffs, forecasts and user-defined **time windows**

**Current focus (Phase 1):** read the P1 meter (DSMR), store the data well, and show live and historical charts in the web app. Don't build later-phase features (tariffs, control, forecasting) unless asked. Do keep the design open for them.

**Target hardware:** Raspberry Pi now, dedicated Jouleflow hardware with built-in I/O later. Everything must run well on low-power ARM devices, fully local, without cloud dependencies.

## Stack

### Backend: Python
| Concern | Choice |
|---|---|
| Language | Python 3.12+ |
| API & realtime | FastAPI (REST + WebSockets for live data) |
| Validation & config | Pydantic |
| P1 / DSMR parsing | `dsmr-parser` |
| Modbus / MQTT | `pymodbus`, `aiomqtt` |
| Data & math | numpy, pandas |
| Optimisation (later) | HiGHS via `highspy` or PuLP |
| Storage | SQLite to start (raw readings + aggregated rollups) |
| Tooling | `uv` (deps/venv), `ruff` (lint + format), `pytest` |

### Frontend: TypeScript
| Concern | Choice |
|---|---|
| Framework | React + Vite, built as a static SPA served by the backend (no SSR / Next.js) |
| Styling | Tailwind CSS |
| Components | shadcn/ui |
| Charts | Apache ECharts (uPlot as a lightweight fallback if needed) |
| Data fetching | TanStack Query |
| Animation | Motion (subtle only) |

## Planned repository layout

```
jouleflow/
├── backend/     # Python: API, device drivers, storage, optimiser
├── frontend/    # React + Vite web app
├── hardware/    # later: open hardware designs (CERN-OHL)
├── docs/
└── docker-compose.yml
```

## Architecture principles

- **Driver architecture:** every device type implements a clear interface, so contributors can add support for new hardware without touching the core.
- **Data model:** keep raw readings for a limited period and aggregate into rollups (e.g. 1 min / 15 min / 1 h / 1 day) for long-term history. Chart queries should read the right resolution for the selected range.
- **Local-first:** no required cloud services; the user's data stays on their device.
- **Resource-conscious:** mind CPU, memory and SD-card writes (batch inserts, avoid write amplification).
- **Safety:** anything that controls hardware must have a simulation / dry-run mode and sane limits. Never send control commands without explicit configuration.
- **Explainability:** when the system makes a decision (later phases), store and show *why*.

## UX principles

The web app must feel **super clean**:
- One main screen with live energy flow (grid ↔ home, later solar and battery)
- Mobile-first and responsive; also works as a wall-mounted tablet dashboard
- Dark mode from day one
- Simple by default, advanced settings tucked away
- Charts are smooth, readable, and consistent in units and colours

## Conventions

- Code, comments, commits and docs in **English**
- Keep dependencies minimal; justify new ones
- Write tests for parsers, storage and aggregation logic
- License: Apache-2.0. Don't add code with incompatible licenses. The "Jouleflow" name is a trademark and is not covered by the license.
