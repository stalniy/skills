# Event storage

The required external behavior, consistency guarantees, data ownership, and API are fully defined.

The implementation team must choose a physical partitioning layout.
Changing the layout after large data growth can be expensive.

The partitioning layout is not exposed to clients and does not constrain accepted product or architecture contracts.
