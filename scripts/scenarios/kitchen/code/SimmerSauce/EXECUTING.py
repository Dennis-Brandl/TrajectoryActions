import random
import time


def execute(inputs, outputs, props, action_props):
    status = outputs.get('status', '0')
    if status == '1':
        raise RuntimeError('SimmerSauce: sauce broke / curdled')
    if status == '2':
        time.sleep(60)
        return
    # Long-running clean path: ~2 seconds (stays under 3s timeout, leaves room
    # for pause/resume demos from the tester UI).
    time.sleep(random.uniform(1.8, 2.4))
