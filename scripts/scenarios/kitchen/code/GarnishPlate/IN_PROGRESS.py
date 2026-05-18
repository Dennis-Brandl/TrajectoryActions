import random
import time


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('plate_id', '')).strip():
        print('WARN: GarnishPlate IN_PROGRESS: plate_id is empty')

    # {{sim_dice_roll: opaque, msg='garnish out of stock'}}

    time.sleep(random.uniform(0.05, 0.15))
    outputs['status'] = '0'
