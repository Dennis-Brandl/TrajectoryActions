def execute(inputs, outputs, props, action_props):
    quantity = str(inputs.get('quantity', '0'))
    outputs['stored_quantity'] = quantity
    outputs['status'] = '0'
