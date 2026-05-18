import random
import time


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('order_id', '')).strip():
        print('WARN: LogService IN_PROGRESS: order_id is empty')

    # {{sim_dice_roll: opaque, msg='POS sync timeout'}}

    time.sleep(random.uniform(0.05, 0.15))
    outputs['status'] = '0'
