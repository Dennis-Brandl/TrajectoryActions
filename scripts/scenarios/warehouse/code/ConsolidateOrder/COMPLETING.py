def execute(inputs, outputs, props, action_props):
    order_id = str(inputs.get('order_id', ''))
    outputs['pallet_id'] = f'PALLET-{order_id}'
    outputs['status'] = '0'
