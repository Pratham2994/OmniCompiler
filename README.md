# OmniCompiler

A full-stack, language-agnostic platform for running, debugging, translating, and analyzing code across Python, JavaScript, Java, C++, and Go. The system pairs a React/Tailwind frontend with a FastAPI backend, Dockerized runtimes, ML breakpoint models, and Gemini-powered translation/analysis.

## What it does
- Detects language from arbitrary snippets (chunked, ambiguity-aware, prefers plain/unknown over wrong guesses).
- Runs code inside per-language Docker sandboxes; streams stdout/stderr and stdin.
- Debugs Python, C++, Java, and JavaScript via custom shims that speak a lightweight, DAP-style JSON protocol to the backend and WebSocket clients.
- Builds intra-procedural control-flow graphs (nodes, branch/loop/back edges, per-function cyclomatic complexity) and visual execution timelines with cross-file import annotations.
- Anchors Gemini translation and analysis prompts with the extracted CFG summary, so the model receives explicit control-flow structure alongside the source text.
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
  - **scripts/**: Training and candidate extraction for breakpoint models per language; feature builders/labelers; the evaluation and benchmark scripts that regenerate every reported number.
  - **data/features/**: Training feature CSVs (the released line-level annotations).
  - **data/results/**: Committed outputs of the evaluation scripts.
  - **test/**: Detector regression harness.

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

## Reproducing the evaluation
Every reported figure is regenerated by a committed script writing to `server/data/results/`. Run from `server/` with the virtualenv active.

```bash
python -m server.test.eval_detector
python scripts/evaluate_detector.py
python scripts/evaluate_breakpoint_heuristic.py
python scripts/benchmark_runtime.py
```

- `eval_detector.py` — regression harness for the detector (hand-written cases including adversarial non-code negatives).
- `evaluate_detector.py` — ablation of regex-only vs Pygments-only vs the hybrid pipeline, on curated, truncation-augmented, and length-scaled corpora. Reports correct / abstained / misidentified separately, because declining to guess is the intended behaviour on fragments that no longer carry language evidence.
- `evaluate_breakpoint_heuristic.py` — breakpoint component under leave-file-out grouped cross-validation. Note that `label_multilang_candidates.py` derives the label from the same `reasons` field that most features encode, so the script reports the shipped feature set alongside a leak-free lexical subset, and states the labelling rule's own reproduction rate. It also measures cross-language consistency over the parallel corpus (the same 15 problems in all five languages).
- `benchmark_runtime.py` — cold container provisioning, end-to-end execution per language, and debugger event serialization cost. **Requires a running Docker daemon and the `omni-runner:*` images.**

## Status
Active development. The scripts above are the automated checks wired into this repo; there is no unit-test suite. Use the sample programs in `server/oc_docker/test_code/` to sanity-check language pipelines.

Notes for a fresh clone:
- `server/.env` is not committed. Supply `GOOGLE_GENAI_API_KEY` (or `GEMINI_API_KEY`) for Translate and Insights. Model IDs default to `gemini-2.5-flash` and are overridable via `GOOGLE_GENAI_MODEL` and `GOOGLE_GENAI_INSIGHT_MODEL`; `gemini-2.5-pro` gives stronger analysis but has substantially tighter free-tier quota.
- Breakpoint models under `server/data/model/` were trained with an earlier scikit-learn and may emit a version warning on load. Regenerate them with `python scripts/train_multilang_breakpoint_models.py` to silence it.
