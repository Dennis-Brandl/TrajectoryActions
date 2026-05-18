import random


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('order_id', '')).strip():
        print('WARN: ConsolidateOrder STARTING: order_id is empty')
    if not str(inputs.get('item_count', '')).strip():
        print('WARN: ConsolidateOrder STARTING: item_count is empty')

    # {{sim_dice_roll: observable}}
