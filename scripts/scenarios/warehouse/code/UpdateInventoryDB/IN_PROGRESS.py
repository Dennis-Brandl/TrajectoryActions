import random
import time


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('sku', '')).strip():
        print('WARN: UpdateInventoryDB IN_PROGRESS: sku is empty')
    if not str(inputs.get('delta', '')).strip():
        print('WARN: UpdateInventoryDB IN_PROGRESS: delta is empty')

    # Opaque actions: dice roll happens here (no STARTING). 'timeout' raises
    # immediately after setting status='2' — see plan for rationale.
    # {{sim_dice_roll: opaque, msg='db connection lost'}}

    # Clean path: simulate brief DB write.
    time.sleep(random.uniform(0.5, 1.5))
    outputs['status'] = '0'
