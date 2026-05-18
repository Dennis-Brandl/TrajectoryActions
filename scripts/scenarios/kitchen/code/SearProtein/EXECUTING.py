import random
import time


def execute(inputs, outputs, props, action_props):
    status = outputs.get('status', '0')
    if status == '1':
        raise RuntimeError('SearProtein: pan overheated')
    if status == '2':
        # Sleep past the 3s action timeout. Engine SIGKILLs the worker; status='2'
        # is already persisted from STARTING.
        time.sleep(60)
        return
    # Clean path: simulate the active sear.
    time.sleep(random.uniform(0.05, 0.15))
