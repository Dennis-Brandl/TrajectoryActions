import random


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('pot_id', '')).strip():
        print('WARN: SimmerSauce STARTING: pot_id is empty')
    if not str(inputs.get('sauce_base', '')).strip():
        print('WARN: SimmerSauce STARTING: sauce_base is empty')

    # {{sim_dice_roll: observable}}
