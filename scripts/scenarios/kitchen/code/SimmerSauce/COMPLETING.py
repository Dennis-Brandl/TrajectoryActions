def execute(inputs, outputs, props, action_props):
    target = str(inputs.get('reduction_target_pct', '0'))
    outputs['final_reduction_pct'] = target
    outputs['status'] = '0'
