# Account balance

Two services can update Account balance state.

The specification requires correct balances but does not define whether both services are authoritative writers or whether one service owns writes.

Changing this after launch would require data migration and coordination between both services.
