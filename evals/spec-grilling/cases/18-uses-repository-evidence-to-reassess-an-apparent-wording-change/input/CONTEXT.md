# Context

Task status values are persisted in the event log and exposed to third-party consumers.
Consumers branch on the literal status string.
Changing a status value requires event migration, compatibility support, and coordinated client rollout.
