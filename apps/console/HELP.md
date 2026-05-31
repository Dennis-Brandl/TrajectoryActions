# Trajectory Action Container Help Guide

The Action Container stores and runs the **Actions** that Trajectory workflows call. Actions are written in **Python** and run in a sandbox. This console is the web UI for managing the container — importing environments, writing and testing action code, and monitoring executions.

> **PLEASE NOTE:** Trajectory is a demonstration system, not intended for production environments. The editor and runtime are single-user systems and do not have the security necessary for production use. We recommend loading the applications into a Docker container for your testing.

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Environments and Actions](#2-environments-and-actions)
3. [Writing Action Code](#3-writing-action-code)
4. [Testing Code](#4-testing-code)
5. [Instances](#5-instances)
6. [Execution Log](#6-execution-log)
7. [Settings](#7-settings)
8. [Connecting a Workflow to the Container](#8-connecting-a-workflow-to-the-container)

---

## 1. Getting Started

The console has a top navigation bar and a left activity bar:

- **Top bar** — **Dashboard** (system overview), **Log** (execution history), **Settings** (configuration).
- **Activity bar** (left icons) — **Explorer** (browse environments and actions), **Instances** (running executions), **Search**.

Start on the **Dashboard** for an at-a-glance view, then use the Explorer to drill into your environments and actions.

---

## 2. Environments and Actions

The container is organized into **Environments**, each bundling a set of **Actions**. These are the same environments a workflow links to in the Trajectory Workflow Editor.

- **Import:** on the **Environments** page click **Upload Package** and choose a `.WFenvirX` (zipped), `.WFenvir`, or `.WFaction` file. The import report lists what was created or updated.
- **Browse:** the **Explorer** panel shows a tree of environments and their actions.
- **Environment detail** lists each action with its visibility (**observable** or **opaque**) and input/output counts, plus a code-status badge for each state.

---

## 3. Writing Action Code

Open the **Code Editor** and choose an **Environment → Action → State**, then write Python in the editor.

An action's behavior is defined **per state** of its lifecycle: _observable_ actions expose many states (STARTING, EXECUTING, COMPLETING, …); _opaque_ actions expose a few (POSTED, RECEIVED, IN_PROGRESS, …). Code-status badges show which states already have code.

- **Save Version** stores a snapshot of the code, with an optional description.
- **Version History** lets you view earlier versions (read-only) and restore one to keep editing.
- On an action's detail page you can **Export Code** / **Import Code** (`.WFactionCode`) and **Clear Code** for a state (irreversible).

### Coordinating state transitions from code

The Python code in each state can do more than process inputs and write outputs — it can also signal the next state transition. Three signals are available without any imports:

- **Return `True`** (or any non-`False` value, or no return at all) — the state's work is done; the container advances to the next state in the lifecycle (the **SC** transition).
- **Return `False` from EXECUTING** — code-initiated **HOLD**: the container moves through HOLDING into HELD, and waits there until an **Unhold** signal arrives.
- **Raise any exception** — code-initiated **ABORT**: the error summary and traceback are recorded on the instance and the container moves through ABORTING into ABORTED.

In addition, code in any active state can call `trajectory.request_command("...")` to request one of these commands after the current execution returns:

| Command  | Effect                                                      | Valid from        |
| -------- | ----------------------------------------------------------- | ----------------- |
| `HOLD`   | Hold the action (same destination as returning `False`).    | Any active state. |
| `UNHOLD` | Release a held action — next state EXECUTING.               | HELD only.        |
| `PAUSE`  | Pause the action so an operator can resume it later.        | EXECUTING only.   |
| `STOP`   | Stop the action cleanly — next state COMPLETED.             | Any active state. |
| `ABORT`  | Abort the action without an exception — next state ABORTED. | Any active state. |

A requested command that isn't valid for the current state is reported as an execution error and the action transitions to ABORTING.

#### Example: holding for a downstream queue

A common reason to hold an action is throttling against a downstream resource. A packer station, for example, may need to stop feeding a downstream wrapper whose buffer is full, then resume once the wrapper has caught up. The action defines code in four states; the container drives the cycle **EXECUTING → HOLDING → HELD → UNHOLDING → EXECUTING** and repeats it every time EXECUTING returns `False`.

**EXECUTING** — runs the normal operation; if downstream is full, ask to hold:

```python
def execute(inputs, outputs, props, action_props):
    if downstream_queue_full(props):
        return False              # code-initiated HOLD
    feed_one_item(inputs, props)
    return True                    # SC -> COMPLETING when the batch is done
```

**HOLDING** — runs once on the way into HELD; bring the machine to a safe stopped state:

```python
def execute(inputs, outputs, props, action_props):
    stop_feed_motor(props)
    wait_until_machine_idle(props)
    return True                    # SC -> HELD
```

**HELD** — polls for the downstream queue to drain, then asks to unhold:

```python
def execute(inputs, outputs, props, action_props):
    wait_until_downstream_available(props)
    trajectory.request_command("UNHOLD")
    return True                    # container moves HELD -> UNHOLDING
```

**UNHOLDING** — runs once on the way back to EXECUTING; restart the machine:

```python
def execute(inputs, outputs, props, action_props):
    start_feed_motor(props)
    return True                    # SC -> EXECUTING; the EXECUTING code re-checks the queue
```

An operator can still take over from outside: the Instances page exposes **Unhold** (to release the hold manually), **Abort**, and **Stop**, all of which override what the action's own code is doing.

---

## 4. Testing Code

Click **Test Code** to open the test panel, fill in the action's input parameters, and click **Run Test**. The result shows a success/failure badge, execution time, the return value, an outputs table, and the captured **stdout / stderr** — a dry run without needing a workflow.

---

## 5. Instances

The **Instances** page lists executions in two tabs — **Active** (running) and **History** (finished). Open an instance to see:

- its **current state** with a color indicator,
- a **state timeline** of transitions and how long each took,
- the **input and output parameters**, and
- the **pinned code versions** the run used.

For observable actions, the detail view offers state-appropriate commands: **Pause**, **Resume**, **Abort**, **Stop**, **Unhold**.

---

## 6. Execution Log

The **Log** page records completed executions. Filter by action, environment, status (Completed / Aborted / Stopped), and date range; click a row to expand its inputs, outputs, and the states it executed.

---

## 7. Settings

The **Settings** page configures the container:

- **Max Log Entries** — how many execution records to keep.
- **Python Pool Size** — number of sandbox worker processes.
- **Execution Timeout** — per-state time limit in seconds (0 disables it).
- **Instance Retention** — hours to keep completed instance records.

Use **Save Changes** to apply, or **Reset to Defaults**. The page also shows read-only container info: version, uptime, and the current Python worker pool.

---

## 8. Connecting a Workflow to the Container

Workflow steps called **Environment Actions** run here, not in the runtime. To wire a workflow to this container, point it at the container's REST address — for example `http://localhost:3002`:

- In the **Trajectory Workflow Editor**, register the address as an action server on the workflow's environment, or
- in the **Trajectory runtime**, enter the address when prompted (the Action Server picker) as the workflow starts.

When a workflow reaches an Environment Action, the runtime calls this container, which runs the Python code you wrote and returns the outputs.
