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
