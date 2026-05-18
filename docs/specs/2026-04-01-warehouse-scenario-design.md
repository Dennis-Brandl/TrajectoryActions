# Automated Warehouse Test Scenario — Design Spec

**Status**: Approved
**Date**: 2026-04-01
**Phase**: v2 Phase 3 (Environment 1 of 3)

---

## Goal

Create a self-contained "Automated Warehouse" environment with 10 actions (7 observable, 3 opaque) that simulate warehouse operations. The scenario exercises the full ISA-88 state machine, demonstrates property-based state, and includes a `SIMULATION_MODE` toggle for failure injection.

## Architecture

The environment is delivered as a `.WFenvir` file defining the environment, all 10 actions, and their property specifications. Each action has Python code for the relevant states. Actions use property specifications as their state context (reading `SIMULATION_MODE` to decide whether to inject failures). Observable actions implement `STARTING`, `EXECUTING`, `COMPLETING`, and `ABORTING` states. Opaque actions implement `IN_PROGRESS` and `ABORTING` states.

When `SIMULATION_MODE` is `true`, each action has a ~10% chance per execution of triggering a failure mode: random abort, HOLD (observable only), or simulated timeout.

## Environment Definition

```
Environment: Automated Warehouse
OID: env-warehouse-001
Version: 1.0.0
```

### Value Property Specifications

| Property          | Entries                                                                            | Purpose                                       |
| ----------------- | ---------------------------------------------------------------------------------- | --------------------------------------------- |
| `SIMULATION_MODE` | `Value`: `"false"`, `Description`: `"Enable random failures, holds, and timeouts"` | Controls failure injection across all actions |

### Action Property Specifications

None.

### Resource Property Specifications

None.

## Actions

### Observable Actions (7) — Full ISA-88 State Machine

Each observable action implements code for these states:

- **STARTING** — validate inputs, read properties
- **EXECUTING** — perform the simulated operation (with delay)
- **COMPLETING** — set output parameters, finalize
- **ABORTING** — cleanup on abort, set error outputs

#### 1. PickItem

**Purpose**: AS/RS crane retrieves an item from a shelf location.

| Field       | Value                                            |
| ----------- | ------------------------------------------------ |
| OID         | `act-wh-pick-001`                                |
| Local ID    | `PickItem`                                       |
| Visibility  | observable                                       |
| Description | Retrieve an item from a warehouse shelf location |

**Input Parameters:**

| ID               | Type   | Default      | Description                     |
| ---------------- | ------ | ------------ | ------------------------------- |
| `shelf_location` | string | `"BIN-A1"`   | Shelf/bin location to pick from |
| `item_sku`       | string | `"SKU-1001"` | Item SKU to pick                |
| `quantity`       | number | `"1"`        | Number of units to pick         |

**Output Parameters:**

| ID                | Type   | Default | Description                            |
| ----------------- | ------ | ------- | -------------------------------------- |
| `picked_quantity` | number | `"0"`   | Actual quantity picked                 |
| `pick_status`     | string | `""`    | Status: "success" or error description |

**Simulation Logic:**

- STARTING: Validate `shelf_location` and `item_sku` are non-empty
- EXECUTING: Sleep 0.5-1.5s (simulated crane movement). If `SIMULATION_MODE=true`, 10% chance of abort ("Crane obstruction detected")
- COMPLETING: Set `picked_quantity` = requested `quantity`, `pick_status` = "success"
- ABORTING: Set `pick_status` = "aborted", `picked_quantity` = "0"

#### 2. PutawayItem

**Purpose**: Place a received item onto a shelf location.

| Field       | Value                                       |
| ----------- | ------------------------------------------- |
| OID         | `act-wh-putaway-001`                        |
| Local ID    | `PutawayItem`                               |
| Visibility  | observable                                  |
| Description | Store an item at a warehouse shelf location |

**Input Parameters:**

| ID               | Type   | Default      | Description               |
| ---------------- | ------ | ------------ | ------------------------- |
| `shelf_location` | string | `"BIN-A1"`   | Target shelf/bin location |
| `item_sku`       | string | `"SKU-1001"` | Item SKU to store         |
| `quantity`       | number | `"1"`        | Number of units to store  |

**Output Parameters:**

| ID                | Type   | Default | Description                            |
| ----------------- | ------ | ------- | -------------------------------------- |
| `stored_quantity` | number | `"0"`   | Actual quantity stored                 |
| `putaway_status`  | string | `""`    | Status: "success" or error description |

**Simulation Logic:**

- STARTING: Validate inputs
- EXECUTING: Sleep 0.5-1.5s. If `SIMULATION_MODE=true`, 10% chance of HOLD ("Shelf sensor misalignment — waiting for clearance"), auto-resume after 2s
- COMPLETING: Set `stored_quantity` = `quantity`, `putaway_status` = "success"
- ABORTING: Set `putaway_status` = "aborted"

#### 3. MoveConveyor

**Purpose**: Advance conveyor belt to transport a pallet between zones.

| Field       | Value                                                   |
| ----------- | ------------------------------------------------------- |
| OID         | `act-wh-conveyor-001`                                   |
| Local ID    | `MoveConveyor`                                          |
| Visibility  | observable                                              |
| Description | Transport a pallet between warehouse zones via conveyor |

**Input Parameters:**

| ID          | Type   | Default       | Description       |
| ----------- | ------ | ------------- | ----------------- |
| `from_zone` | string | `"RECEIVING"` | Origin zone       |
| `to_zone`   | string | `"STORAGE"`   | Destination zone  |
| `pallet_id` | string | `"PLT-001"`   | Pallet identifier |

**Output Parameters:**

| ID                  | Type   | Default   | Description                           |
| ------------------- | ------ | --------- | ------------------------------------- |
| `arrival_confirmed` | string | `"false"` | Whether pallet arrived at destination |
| `transit_time_ms`   | number | `"0"`     | Simulated transit time                |

**Simulation Logic:**

- STARTING: Validate zones are not the same
- EXECUTING: Sleep 1-3s (simulated conveyor travel). If `SIMULATION_MODE=true`, 10% chance of abort ("Conveyor belt jam at zone STORAGE")
- COMPLETING: Set `arrival_confirmed` = "true", `transit_time_ms` = actual elapsed time
- ABORTING: Set `arrival_confirmed` = "false"

#### 4. CranePickup

**Purpose**: AS/RS crane picks a pallet from a storage lane.

| Field       | Value                                   |
| ----------- | --------------------------------------- |
| OID         | `act-wh-crane-pickup-001`               |
| Local ID    | `CranePickup`                           |
| Visibility  | observable                              |
| Description | AS/RS crane picks a pallet from storage |

**Input Parameters:**

| ID             | Type   | Default     | Description             |
| -------------- | ------ | ----------- | ----------------------- |
| `storage_lane` | string | `"LANE-01"` | Storage lane identifier |
| `pallet_id`    | string | `"PLT-001"` | Pallet to pick up       |

**Output Parameters:**

| ID                 | Type   | Default | Description             |
| ------------------ | ------ | ------- | ----------------------- |
| `crane_status`     | string | `""`    | Crane operation result  |
| `pallet_weight_kg` | number | `"0"`   | Simulated pallet weight |

**Simulation Logic:**

- STARTING: Validate `storage_lane` is non-empty
- EXECUTING: Sleep 1-2s. If `SIMULATION_MODE=true`, 10% chance of HOLD ("Crane weight overload warning"), auto-resume after 3s
- COMPLETING: Set `crane_status` = "picked", `pallet_weight_kg` = random 50-500
- ABORTING: Set `crane_status` = "pickup_failed"

#### 5. CraneDrop

**Purpose**: AS/RS crane drops a pallet at a destination lane.

| Field       | Value                                     |
| ----------- | ----------------------------------------- |
| OID         | `act-wh-crane-drop-001`                   |
| Local ID    | `CraneDrop`                               |
| Visibility  | observable                                |
| Description | AS/RS crane drops a pallet at destination |

**Input Parameters:**

| ID                 | Type   | Default     | Description          |
| ------------------ | ------ | ----------- | -------------------- |
| `destination_lane` | string | `"LANE-05"` | Target lane for drop |
| `pallet_id`        | string | `"PLT-001"` | Pallet to drop       |

**Output Parameters:**

| ID                      | Type   | Default   | Description                        |
| ----------------------- | ------ | --------- | ---------------------------------- |
| `drop_status`           | string | `""`      | Drop operation result              |
| `destination_confirmed` | string | `"false"` | Whether pallet reached destination |

**Simulation Logic:**

- STARTING: Validate inputs
- EXECUTING: Sleep 0.5-1.5s. If `SIMULATION_MODE=true`, 10% chance of abort ("Destination lane occupied")
- COMPLETING: Set `drop_status` = "dropped", `destination_confirmed` = "true"
- ABORTING: Set `drop_status` = "drop_failed", `destination_confirmed` = "false"

#### 6. PackOrder

**Purpose**: Pack picked items into a shipping container.

| Field       | Value                                       |
| ----------- | ------------------------------------------- |
| OID         | `act-wh-pack-001`                           |
| Local ID    | `PackOrder`                                 |
| Visibility  | observable                                  |
| Description | Pack picked items into a shipping container |

**Input Parameters:**

| ID          | Type   | Default                   | Description                        |
| ----------- | ------ | ------------------------- | ---------------------------------- |
| `order_id`  | string | `"ORD-001"`               | Order identifier                   |
| `item_list` | string | `"SKU-1001:2,SKU-1002:1"` | Comma-separated SKU:quantity pairs |

**Output Parameters:**

| ID                | Type   | Default | Description                    |
| ----------------- | ------ | ------- | ------------------------------ |
| `package_id`      | string | `""`    | Generated package identifier   |
| `total_weight_kg` | number | `"0"`   | Simulated total package weight |

**Simulation Logic:**

- STARTING: Parse `item_list`, validate format
- EXECUTING: Sleep 1-2s (simulated packing). If `SIMULATION_MODE=true`, 10% chance of HOLD ("Packing material low — refilling"), auto-resume after 2s
- COMPLETING: Set `package_id` = "PKG-" + random suffix, `total_weight_kg` = random 1-25
- ABORTING: Set `package_id` = "", `total_weight_kg` = "0"

#### 7. ShipOrder

**Purpose**: Move a packed order to a shipping dock.

| Field       | Value                                    |
| ----------- | ---------------------------------------- |
| OID         | `act-wh-ship-001`                        |
| Local ID    | `ShipOrder`                              |
| Visibility  | observable                               |
| Description | Move a packed order to the shipping dock |

**Input Parameters:**

| ID            | Type   | Default     | Description          |
| ------------- | ------ | ----------- | -------------------- |
| `package_id`  | string | `"PKG-001"` | Package identifier   |
| `dock_number` | string | `"DOCK-1"`  | Target shipping dock |

**Output Parameters:**

| ID            | Type   | Default | Description                    |
| ------------- | ------ | ------- | ------------------------------ |
| `shipment_id` | string | `""`    | Generated shipment tracking ID |
| `shipped_at`  | string | `""`    | ISO timestamp of shipment      |

**Simulation Logic:**

- STARTING: Validate `package_id` and `dock_number`
- EXECUTING: Sleep 0.5-1s. If `SIMULATION_MODE=true`, 10% chance of abort ("Dock unavailable — truck departed")
- COMPLETING: Set `shipment_id` = "SHP-" + random suffix, `shipped_at` = current ISO timestamp
- ABORTING: Set `shipment_id` = "", `shipped_at` = ""

### Opaque Actions (3) — Simplified Lifecycle

Each opaque action implements code for these states:

- **IN_PROGRESS** — perform the operation
- **ABORTING** — cleanup on abort

#### 8. CheckInventory

**Purpose**: Look up current stock level for an SKU.

| Field       | Value                               |
| ----------- | ----------------------------------- |
| OID         | `act-wh-check-inv-001`              |
| Local ID    | `CheckInventory`                    |
| Visibility  | opaque                              |
| Description | Look up stock level for an item SKU |

**Input Parameters:**

| ID         | Type   | Default      | Description         |
| ---------- | ------ | ------------ | ------------------- |
| `item_sku` | string | `"SKU-1001"` | Item SKU to look up |

**Output Parameters:**

| ID                 | Type   | Default | Description              |
| ------------------ | ------ | ------- | ------------------------ |
| `quantity_on_hand` | number | `"0"`   | Current stock count      |
| `shelf_location`   | string | `""`    | Where the item is stored |

**Simulation Logic:**

- IN_PROGRESS: Return simulated stock: `quantity_on_hand` = random 0-100, `shelf_location` = random bin. If `SIMULATION_MODE=true`, 10% chance of abort ("Inventory database connection timeout")
- ABORTING: Set defaults

#### 9. ValidateOrder

**Purpose**: Verify an order can be fulfilled with current stock.

| Field       | Value                                            |
| ----------- | ------------------------------------------------ |
| OID         | `act-wh-validate-001`                            |
| Local ID    | `ValidateOrder`                                  |
| Visibility  | opaque                                           |
| Description | Verify order items are available for fulfillment |

**Input Parameters:**

| ID          | Type   | Default                   | Description                        |
| ----------- | ------ | ------------------------- | ---------------------------------- |
| `order_id`  | string | `"ORD-001"`               | Order identifier                   |
| `item_list` | string | `"SKU-1001:2,SKU-1002:1"` | Comma-separated SKU:quantity pairs |

**Output Parameters:**

| ID              | Type   | Default   | Description                              |
| --------------- | ------ | --------- | ---------------------------------------- |
| `is_valid`      | string | `"false"` | Whether order can be fulfilled           |
| `missing_items` | string | `""`      | Comma-separated list of unavailable SKUs |

**Simulation Logic:**

- IN_PROGRESS: Parse `item_list`. Normally return `is_valid` = "true", `missing_items` = "". If `SIMULATION_MODE=true`, 10% chance of returning `is_valid` = "false" with a random SKU in `missing_items`
- ABORTING: Set `is_valid` = "false"

#### 10. UpdateInventory

**Purpose**: Adjust inventory count after a pick or putaway operation.

| Field       | Value                              |
| ----------- | ---------------------------------- |
| OID         | `act-wh-update-inv-001`            |
| Local ID    | `UpdateInventory`                  |
| Visibility  | opaque                             |
| Description | Adjust inventory count for an item |

**Input Parameters:**

| ID               | Type   | Default      | Description                             |
| ---------------- | ------ | ------------ | --------------------------------------- |
| `item_sku`       | string | `"SKU-1001"` | Item SKU to update                      |
| `quantity_delta` | number | `"0"`        | Positive = add, negative = remove       |
| `reason`         | string | `"pick"`     | Reason: "pick", "putaway", "adjustment" |

**Output Parameters:**

| ID              | Type   | Default | Description                |
| --------------- | ------ | ------- | -------------------------- |
| `new_quantity`  | number | `"0"`   | Updated stock count        |
| `update_status` | string | `""`    | Status: "success" or error |

**Simulation Logic:**

- IN_PROGRESS: Simulate inventory update. Set `new_quantity` = random plausible value, `update_status` = "success". If `SIMULATION_MODE=true`, 10% chance of abort ("Inventory lock contention — retry required")
- ABORTING: Set `update_status` = "failed"

## Simulation Mode Behavior Summary

| Failure Type   | Observable Actions                        | Opaque Actions                    | Probability            |
| -------------- | ----------------------------------------- | --------------------------------- | ---------------------- |
| Random abort   | ABORTING state with error message         | ABORTING state with error message | ~10%                   |
| HOLD/UNHOLD    | HOLDING → 2-3s pause → UNHOLDING → resume | N/A (opaque has no HOLD)          | ~10% (observable only) |
| Slow execution | 2x normal sleep duration                  | 2x normal sleep duration          | ~10%                   |

When `SIMULATION_MODE=false`, all actions execute deterministically with success outcomes and normal timing.

## Delivery Format

The scenario is delivered as:

1. A `.WFenvir` JSON file defining the environment and all 10 actions
2. Python code files for each action's states, uploaded via the management API

The `.WFenvir` is imported first (creates environment + action definitions), then code is uploaded per action per state via `POST /code/:action_oid/:state`.

## Scope Boundaries

**In scope:**

- Environment definition with 10 actions
- Python code for all implemented states
- `SIMULATION_MODE` property-based failure injection
- Simulated delays and randomized outputs

**Out of scope:**

- Persistent state across action executions (each execution is independent)
- Inter-action dependencies (actions don't call each other)
- Real equipment integration
- UI changes (actions are visible through existing console)
