# Notification delivery

The application sends Notifications through a `DeliveryProvider` boundary.

The in-scope guarantee is:
- the application submits a Notification once to `DeliveryProvider`;
- the provider returns an accepted or rejected result.

Provider-internal regional failover is not defined.
The application does not depend on provider-internal topology.
