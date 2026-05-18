import random
import time


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('ticket_id', '')).strip():
        print('WARN: ExpoCheck IN_PROGRESS: ticket_id is empty')

    # {{sim_dice_roll: opaque, msg='plate rejected by expediter'}}

    # Clean path: plate passes inspection.
    time.sleep(random.uniform(0.05, 0.15))
    outputs['verdict'] = 'pass'
    outputs['status'] = '0'
