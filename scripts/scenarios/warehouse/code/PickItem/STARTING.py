import random


def execute(inputs, outputs, props, action_props):
    # Permissive validation: warn but don't abort on empty inputs.
    if not str(inputs.get('shelf_location', '')).strip():
        print('WARN: PickItem STARTING: shelf_location is empty')
    if not str(inputs.get('item_sku', '')).strip():
        print('WARN: PickItem STARTING: item_sku is empty')

    # Simulation outcome dice roll. Decision flushes to the engine when this
    # function returns, so EXECUTING (and ABORTING after a kill) see the final value.
    # {{sim_dice_roll: observable}}
