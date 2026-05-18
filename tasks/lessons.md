# Lessons

Patterns to remember from past corrections. Reviewed at session start.

## Dev server ports — coexistence with sibling Trajectory apps (2026-05-06)

The user runs Master Data (Editor), Runtime, and Action Container on the same machine for end-to-end testing.

**Rule:** Never kill processes belonging to other Trajectory apps. When the Action Container's preferred port is occupied by a sibling app, pick the next free port and update the Action Container's config — don't free the port by killing.

**How to detect ownership:**

- `netstat -ano | findstr ":<port>"` to find the PID
- `Get-CimInstance Win32_Process -Filter "ProcessId=<pid>" | Select CommandLine` — anything pathed outside `C:\TrajectoryActions` is off-limits
- Trajectory Master Data lives at `C:\TrajectoryEditor` and squats on 3001 by default

**Action Container's current durable defaults (after coexistence shuffle on 2026-05-06):**

- Express server: 3002 (set via `.env` at repo root, loaded by `tsx watch --env-file=.env`)
- Vite dev server: 5176 (`apps/console/vite.config.ts`, proxy target `http://localhost:3002`)

If those become occupied later, repeat the coexistence shuffle: pick next free port, update both config locations.

## PowerShell working directory drift

PowerShell sessions in this harness can land in `apps/console` instead of the project root, despite the system claim that shell state doesn't persist. If npm scripts fail with "Missing script", run `Set-Location C:\TrajectoryActions` first or use `npm --prefix C:\TrajectoryActions run <script>`.

## Bash on Windows can't `cd` to MSYS-translated paths

`cd apps/console && ...` from the Bash tool may fail with "No such file or directory" on Windows. Prefer absolute paths or use the PowerShell tool with `Set-Location`.
