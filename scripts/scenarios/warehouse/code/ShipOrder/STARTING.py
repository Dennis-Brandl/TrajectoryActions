import random


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('order_id', '')).strip():
        print('WARN: ShipOrder STARTING: order_id is empty')
    if not str(inputs.get('carrier', '')).strip():
        print('WARN: ShipOrder STARTING: carrier is empty')

    # {{sim_dice_roll: observable}}
