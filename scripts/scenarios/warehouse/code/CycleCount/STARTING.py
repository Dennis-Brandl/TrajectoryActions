import random


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('zone', '')).strip():
        print('WARN: CycleCount STARTING: zone is empty')

    # {{sim_dice_roll: observable}}
