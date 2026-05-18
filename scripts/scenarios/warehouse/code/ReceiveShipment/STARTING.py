import random


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('shipment_id', '')).strip():
        print('WARN: ReceiveShipment STARTING: shipment_id is empty')
    if not str(inputs.get('expected_count', '')).strip():
        print('WARN: ReceiveShipment STARTING: expected_count is empty')

    # {{sim_dice_roll: observable}}
