import random
import time


def execute(inputs, outputs, props, action_props):
    status = outputs.get('status', '0')
    if status == '1':
        raise RuntimeError('SauteSides: vegetables burned')
    if status == '2':
        time.sleep(60)
        return
    time.sleep(random.uniform(0.05, 0.15))
