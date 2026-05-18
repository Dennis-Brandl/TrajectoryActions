import random
import time


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('label_type', '')).strip():
        print('WARN: PrintLabel IN_PROGRESS: label_type is empty')
    if not str(inputs.get('content', '')).strip():
        print('WARN: PrintLabel IN_PROGRESS: content is empty')

    # {{sim_dice_roll: opaque, msg='printer offline'}}

    # Clean path: simulate brief print job.
    time.sleep(random.uniform(0.5, 1.5))
    outputs['status'] = '0'
