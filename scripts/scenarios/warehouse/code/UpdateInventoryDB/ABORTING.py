def execute(inputs, outputs, props, action_props):
    # Preserve status set by IN_PROGRESS:
    #   0 → manual abort (user sent ABORT command during a clean run)
    #   1 → simulated random abort
    #   2 → simulated "timeout" (immediate raise; real SIGKILL not exercised
    #       in opaque flow because there's no STARTING-flush window)
    pass
