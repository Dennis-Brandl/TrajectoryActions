import random


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('from_location', '')).strip():
        print('WARN: MoveItem STARTING: from_location is empty')
    if not str(inputs.get('to_location', '')).strip():
        print('WARN: MoveItem STARTING: to_location is empty')
    if not str(inputs.get('item_sku', '')).strip():
        print('WARN: MoveItem STARTING: item_sku is empty')

    # {{sim_dice_roll: observable}}
