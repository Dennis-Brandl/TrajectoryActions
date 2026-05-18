import random
import time


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('ticket_id', '')).strip():
        print('WARN: PrintKitchenTicket IN_PROGRESS: ticket_id is empty')
    if not str(inputs.get('order_summary', '')).strip():
        print('WARN: PrintKitchenTicket IN_PROGRESS: order_summary is empty')

    # {{sim_dice_roll: opaque, msg='printer offline'}}

    # Clean path: brief print job.
    time.sleep(random.uniform(0.05, 0.15))
    outputs['status'] = '0'
