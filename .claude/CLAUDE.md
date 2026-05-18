# Workflow Orchestration

## Dev Server Management section near the top of CLAUDE.md

When starting dev servers, first check for running processes on target ports and use alternate ports if occupied. NEVER kill all node/process instances broadly — only kill the specific process on the needed port.

## Project Overview section at the top of CLAUDE.md

- This is a TypeScript project. The codebase includes a web UI (React), workflow engine, and cross-platform components.
- Always check existing patterns in the codebase before implementing new features.
- Ensure all imports are compatible with the target runtime (browser vs Node.js).
- Do not use Node-only imports in browser code or CoreFoundation-dependent libraries on Windows.
- When implementing UI changes, place new elements inline within existing component hierarchies unless explicitly told otherwise.
- Do not create separate sections or containers for items that belong in existing layouts.

## 1. Plan Mode Default

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately – don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

## 2. Subagent Strategy

- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

## 3. Self-Improvement Loop

- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

## 4. Verification Before Done

- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

## 5. Demand Elegance (Balanced)

- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes – don't over-engineer
- Challenge your own work before presenting it

## Bug Fixing Protocol section

1. Before making changes, confirm the correct file/component with the user if there's any ambiguity. When the user provides a bug report, ask which component or screen is affected rather than assuming.
2. After implementing fixes, verify each fix actually works before moving on.
3. Do not stack multiple fixes without intermediate verification.
4. When a fix doesn't work on the first attempt, add debug logging to understand root cause before trying alternative approaches.

## Code Quality section

After implementing multi-file changes, run a self-verification pass checking: 1) no regressions in related features, 2) edge cases like grandchild nodes, empty values, coordinate system differences, 3) variable scoping across functions.

## Before Making Changes section

1. Before making changes, explain what changes are to be made and ask for confirmation of the changes.
2. BEfore making proposed changes, confirm you are modifying the correct file/component.
3. When the user reports a UI issue, ask which component or provide your assumption for confirmation before editing.

## Debugging Guidelines section

- When fixing bugs, identify the root cause before attempting fixes. Do not try multiple parameter combinations or surface-level patches.
- Add debug logging first if the cause is unclear.
- Limit fix attempts to 2 before stepping back to add instrumentation.

# Task Management

1. **Plan First:** Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan:** Check in before starting implementation
3. **Track Progress:** Mark items complete as you go
4. **Explain Changes:** High-level summary at each step
5. **Document Results:** Add review section to `tasks/todo.md`
6. **Capture Lessons:** Update `tasks/lessons.md` after corrections

# Core Principles

- **Simplicity First:** Make every change as simple as possible. Impact minimal code.
- **No Laziness:** Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact:** Changes should only touch what's necessary. Avoid introducing bugs.
