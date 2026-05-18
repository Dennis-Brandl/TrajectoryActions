def execute(inputs, outputs, props, action_props):
    # Preserve status set by STARTING:
    #   0 → manual abort (user sent ABORT command during a clean run)
    #   1 → simulated random abort
    #   2 → simulated timeout
    pass
