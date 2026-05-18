import random
import time


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('grill_id', '')).strip():
        print('WARN: PreheatGrill IN_PROGRESS: grill_id is empty')

    # {{sim_dice_roll: opaque, msg='igniter failed'}}

    time.sleep(random.uniform(0.05, 0.15))
    outputs['status'] = '0'
