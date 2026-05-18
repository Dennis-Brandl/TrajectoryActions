---
phase: 03-state-machine-python-sidecar
plan: '02'
subsystem: execution-engine
tags: [python, subprocess, json-protocol, sandbox, compile, exec, unittest, io-capture]

# Dependency graph
requires:
  - phase: 03-state-machine-python-sidecar
    provides: Phase CONTEXT.md defining sandbox boundaries, stdout/stderr cap limit, and error type taxonomy

provides:
  - sandbox_runner.py — long-lived Python subprocess worker that executes user code via compile()+exec() and returns JSON responses
  - test_sandbox_runner.py — 14-case unittest suite verifying the full JSON protocol end-to-end via subprocess

affects:
  - 03-03 (Python worker pool in Node.js engine) — depends on this JSON protocol
  - 04-protocol (REST layer) — depends on engine which depends on this sidecar

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'compile() before exec() — SyntaxError vs RuntimeError distinction for structured error_type'
    - 'contextlib.redirect_stdout/redirect_stderr — stdout/stderr capture without corrupting JSON protocol'
    - 'Newline-delimited JSON on stdin/stdout — long-lived worker loop without process restart'
    - 'subprocess.Popen(text=True) in unittest — integration tests that exercise the actual JSON wire protocol'

key-files:
  created:
    - packages/python-sidecar/sandbox_runner.py
    - packages/python-sidecar/test_sandbox_runner.py
  modified:
    - packages/python-sidecar/requirements.txt

key-decisions:
  - 'compile() before exec() is the sole mechanism for SYNTAX_ERROR classification; all other exceptions are RUNTIME_ERROR'
  - "outputs dict is pre-populated from request.get('outputs', {}) so engine can pass accumulated prior-state outputs"
  - 'stdout/stderr capture uses contextlib.redirect_stdout/redirect_stderr applied over both exec() and execute() calls'
  - "MAX_OUTPUT_BYTES = 64 * 1024 (64KB) cap uses .encode('utf-8') byte length, appends '[stdout/stderr truncated]' marker"
  - 'flush=True on every print(json.dumps(response)) is mandatory for Node.js parent to receive output immediately'
  - 'Worker loop is a plain for line in sys.stdin: — EOF closes naturally when Node.js closes the worker pipe'
  - 'Tests use a single shared subprocess per TestCase class (setUpClass/tearDownClass) — proves sequential request handling'

patterns-established:
  - 'JSON protocol test pattern: subprocess.Popen + send_request() helper + unittest assertions against parsed response'
  - "Error response shape is uniform: success, error_type, error, traceback, outputs:{}, return_value:null, captures:''"

# Metrics
duration: 2min
completed: 2026-02-25
---

# Phase 3 Plan 02: Sandbox Runner Summary

**Python sidecar worker (sandbox_runner.py) with compile()+exec() JSON protocol, contextlib stdout/stderr capture capped at 64KB, and 14-case unittest suite exercising the full wire protocol end-to-end**

## Performance

- **Duration:** 2min
- **Started:** 2026-02-26T03:09:19Z
- **Completed:** 2026-02-26T03:11:25Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Implemented `sandbox_runner.py` — a production-ready long-lived worker that reads newline-delimited JSON from stdin, compiles then executes user Python code, captures stdout/stderr without corrupting the JSON protocol, and writes structured JSON responses to stdout with `flush=True`
- Established the SYNTAX_ERROR / RUNTIME_ERROR distinction via `compile()` before `exec()` — callers receive typed error codes, not just exception messages
- Wrote 14 test cases in `test_sandbox_runner.py` using `subprocess.Popen` against the live worker, covering every protocol path: happy path, hold (False return), syntax error, runtime error, missing execute(), stdout capture, stderr capture, outputs mutation, outputs accumulation, sequential requests, timing, request_id passthrough, props passthrough, and invalid JSON

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement sandbox_runner.py** - `118a76d` (feat)
2. **Task 2: Python tests for sandbox_runner** - `092b754` (test)

## Files Created/Modified

- `packages/python-sidecar/sandbox_runner.py` — Full worker implementation: `run_user_code()` + `main()` loop
- `packages/python-sidecar/test_sandbox_runner.py` — 14 unittest cases via subprocess Popen
- `packages/python-sidecar/requirements.txt` — Updated with stdlib-only documentation comment

## Decisions Made

- `compile()` before `exec()` is the sole classification mechanism — SyntaxError from compile() maps to SYNTAX_ERROR; all other exceptions from exec/execute map to RUNTIME_ERROR
- `outputs` is pre-populated from `request.get('outputs', {})` so the engine can pass accumulated prior-state outputs; user code reads and extends them
- stdout/stderr capture wraps both the `exec(code_obj, namespace)` call (code definition) and the `execute_fn(...)` call (execution) — captures print() in either phase
- 64KB cap (`MAX_OUTPUT_BYTES = 64 * 1024`) checks `.encode('utf-8')` byte length and appends a `'[stdout/stderr truncated]'` marker after truncation
- `flush=True` on every `print(json.dumps(response))` is mandatory for the Node.js parent process to receive output without buffering delay
- Worker loop uses `for line in sys.stdin:` — natural EOF termination when Node.js closes the pipe, no signal handling needed
- Tests share one subprocess process per class (setUpClass/tearDownClass) to verify the worker loop handles multiple sequential requests

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `sandbox_runner.py` is ready for wiring into the Node.js worker pool (Plan 03-03)
- The JSON protocol is fully specified and tested: request fields (`request_id`, `source_code`, `inputs`, `outputs`, `environment_action_properties`, `action_properties`) and response shape for both success and error cases
- All 14 tests pass with `python -m unittest test_sandbox_runner -v`
- No blockers

---

_Phase: 03-state-machine-python-sidecar_
_Completed: 2026-02-25_
