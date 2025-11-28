# OmniCompiler

A full-stack, language-agnostic platform for running, debugging, translating, and analyzing code across Python, JavaScript, Java, C++, and Go. The system pairs a React/Tailwind frontend with a FastAPI backend, Dockerized runtimes, ML breakpoint models, and Gemini-powered translation/analysis.

## What it does
- Detects language from arbitrary snippets (chunked, ambiguity-aware, prefers plain/unknown over wrong guesses).
- Runs code inside per-language Docker sandboxes; streams stdout/stderr and stdin.
- Debugs Python, C++, Java, and JavaScript via custom shims that speak a lightweight, DAP-style JSON protocol to the backend and WebSocket clients.
- Builds structural control-flow graphs (CFG) and visual execution timelines with cross-file import annotations.
- Translates code between languages (and to annotated assembly) using Gemini with strict structure/behavior-preserving prompts.
- Suggests breakpoints via per-language Random Forest models.
- AI Analysis mode for summaries, complexity, bug hints, and fix suggestions (intentionally decoupled from live debugging).

## Architecture at a glance
- **client/**: Vite/React UI (Run, Debug, Translate, Insights). Monaco-based editor, execution trace UI, breakpoint controls, theme management.
- **server/**: FastAPI app exposing REST + WebSocket routes for run/debug/translate/insights/CFG/breakpoints.
  - **routes/**: Run + debug orchestration, CFG extraction, detection, translation, insights, breakpoints, WS bridge.
  - **controller/detector.py**: Hybrid detector (regex fingerprints, ambiguity resolution, pygments fallback, chunked AUTO/VERIFY paths).
  - **llm/**: Gemini client + insights wrappers.
  - **oc_docker/**: Dockerfiles and debugger shims (Python bdb, C++ gdb, Java jdb, JS Inspector) implementing the mini–DAP-style protocol over stdin/stdout.
  - **scripts/**: Training and candidate extraction for breakpoint models per language; feature builders/labelers.
  - **data/features/**: Training feature CSVs.
  - **test/**: Detector evaluation harness.

## How core subsystems work
- **Language Detection Layer**
  - Regex fingerprints per language + conflict/ambiguity handling.
  - Chunked first/last/middle ingestion; AUTO vs VERIFY; pygments fallback; returns “plain/unknown” when unsure.
  - Feeds user badges, Docker image selection, translation prompts, and tooling defaults.

- **Execution & Debugging Layer**
  - Per-language Docker images mount `/work`, inject a debugger shim, and run entrypoints.
  - Custom JSON-over-stdio protocol (continue/step/set_breakpoints/evaluate/stdin/stop; stopped/exception/breakpoints_set/await_input/evaluate_result/output/terminated).
  - Backend holds the container process, bridges to WebSocket `/ws/debug/{session}`, streams events to the frontend.

- **CFG + Execution Trace**
  - Server: regex/indent/brace parsing to produce language-agnostic CFG nodes (type, file, start/end, label, children).
  - Client: rehydrates CFG, flattens into per-file timelines with depth, import/jump annotations, and semantic step badges; aligns with debugger stop locations.

- **LLM Translation**
  - FastAPI route builds strict Gemini prompts to preserve semantics/structure; optional comment/layout preservation; multi-target (Python/JS/Java/C++/Go/others/annotated x86-64).

- **Breakpoint Recommendation**
  - Offline candidate extraction + Random Forest training per language.
  - Runtime scoring returns `{file, line, score}`; UI can pre-highlight or set via debugger env.

- **AI Analysis Mode**
  - Separate UX flow: user triggers analysis → backend reuses detection/CFG/LLM to return summaries, complexity hints, bug/potential-bug notes, and fix suggestions. Not coupled to live debug sessions.

## Quickstart
Prereqs: Node 18+, Python 3.11+, Docker (for execution/debugging), make sure ports 5173 (client) and 8000 (server) are open.

```bash
# Backend
cd server
python -m venv .venv && .venv/Scripts/activate
pip install -r requirements.txt
python run_server.py

# Frontend
cd ../client
npm install
npm run dev -- --host --port 5173
```

Docker images are defined under `server/oc_docker/` (python/cpp/java/javascript/go). Build them as needed, e.g.:
```bash
cd server/oc_docker/python
docker build -t omni-runner:python .
```

## Development notes
- Frontend: Monaco editor, framer-motion animations, React Router pages. Debug UI opens a WS to `/ws/debug/{session_id}` and sends JSON commands matching the mini–DAP-style protocol.
- Backend: If Docker is unavailable, some routes can fall back to local execution where coded; production expects Docker on PATH.
- Models: Breakpoint training scripts live in `server/scripts/`; feature CSVs in `server/data/features/`.
- Env: `.env` next to `server/main.py` for API keys (e.g., Gemini) and CORS (`ALLOW_ORIGINS`).

## Status
Active development; no automated tests are wired in this repo snapshot. Use the sample programs in `server/oc_docker/test_code/` to sanity-check language pipelines, and the detector harness in `server/test/eval_detector.py` for detection regression checks.
