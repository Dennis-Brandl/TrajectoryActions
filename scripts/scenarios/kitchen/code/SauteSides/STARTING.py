import random


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('pan_id', '')).strip():
        print('WARN: SauteSides STARTING: pan_id is empty')
    if not str(inputs.get('vegetable', '')).strip():
        print('WARN: SauteSides STARTING: vegetable is empty')

    # {{sim_dice_roll: observable}}
