import random
import time


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('barcode', '')).strip():
        print('WARN: ScanBarcode IN_PROGRESS: barcode is empty')

    # {{sim_dice_roll: opaque, msg='scanner offline'}}

    # Clean path: simulate brief scan + resolve.
    time.sleep(random.uniform(0.5, 1.5))
    barcode = str(inputs.get('barcode', ''))
    # Deterministic mapping: SKU = "SKU-" + last 4 digits of barcode (or empty).
    outputs['sku'] = f'SKU-{barcode[-4:]}' if len(barcode) >= 4 else ''
    outputs['status'] = '0'
