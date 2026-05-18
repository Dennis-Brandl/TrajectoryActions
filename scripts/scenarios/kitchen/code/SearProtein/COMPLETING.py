def execute(inputs, outputs, props, action_props):
    target = str(inputs.get('target_internal_c', '0'))
    outputs['internal_temp_c'] = target
    outputs['sear_score'] = 'good'
    outputs['status'] = '0'
