import random


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('shelf_location', '')).strip():
        print('WARN: PutawayItem STARTING: shelf_location is empty')
    if not str(inputs.get('item_sku', '')).strip():
        print('WARN: PutawayItem STARTING: item_sku is empty')

    # {{sim_dice_roll: observable}}
