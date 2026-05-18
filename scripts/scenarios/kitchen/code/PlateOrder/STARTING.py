import random


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('order_id', '')).strip():
        print('WARN: PlateOrder STARTING: order_id is empty')
    if not str(inputs.get('plate_id', '')).strip():
        print('WARN: PlateOrder STARTING: plate_id is empty')

    # {{sim_dice_roll: observable}}
