import random
import time


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('ingredient', '')).strip():
        print('WARN: PrepStation IN_PROGRESS: ingredient is empty')
    if not str(inputs.get('quantity_grams', '')).strip():
        print('WARN: PrepStation IN_PROGRESS: quantity_grams is empty')

    # {{sim_dice_roll: opaque, msg='ingredient spoilage detected'}}

    # Clean path: portion the ingredient.
    time.sleep(random.uniform(0.05, 0.15))
    ingredient = str(inputs.get('ingredient', ''))
    cut_style = str(inputs.get('cut_style', ''))
    quantity_str = str(inputs.get('quantity_grams', '0'))
    try:
        portions = max(1, int(quantity_str) // 30)
    except ValueError:
        portions = 1
    outputs['portions_ready'] = str(portions)
    outputs['prep_notes'] = f'{cut_style} on {ingredient}' if cut_style else ingredient
    outputs['status'] = '0'
