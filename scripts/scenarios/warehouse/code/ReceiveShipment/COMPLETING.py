def execute(inputs, outputs, props, action_props):
    expected_count = str(inputs.get('expected_count', '0'))
    outputs['received_count'] = expected_count
    outputs['status'] = '0'
