def execute(inputs, outputs, props, action_props):
    order_id = str(inputs.get('order_id', ''))
    carrier = str(inputs.get('carrier', ''))
    outputs['tracking_number'] = f'TRACK-{order_id}-{carrier}'
    outputs['status'] = '0'
