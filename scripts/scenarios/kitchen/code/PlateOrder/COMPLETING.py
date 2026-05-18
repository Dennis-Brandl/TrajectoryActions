from datetime import datetime, timezone


def execute(inputs, outputs, props, action_props):
    outputs['plated_at'] = datetime.now(timezone.utc).isoformat()
    outputs['status'] = '0'
