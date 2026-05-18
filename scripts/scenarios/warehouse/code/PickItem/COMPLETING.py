def execute(inputs, outputs, props, action_props):
    quantity = str(inputs.get('quantity', '0'))
    outputs['picked_quantity'] = quantity
    outputs['pick_status'] = 'success'
    outputs['status'] = '0'
