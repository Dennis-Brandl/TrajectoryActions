import random


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('protein', '')).strip():
        print('WARN: SearProtein STARTING: protein is empty')
    if not str(inputs.get('target_internal_c', '')).strip():
        print('WARN: SearProtein STARTING: target_internal_c is empty')

    # Simulation outcome dice roll. Decision flushes to the engine when this
    # function returns, so EXECUTING (and ABORTING after a kill) see the final value.
    # {{sim_dice_roll: observable}}
