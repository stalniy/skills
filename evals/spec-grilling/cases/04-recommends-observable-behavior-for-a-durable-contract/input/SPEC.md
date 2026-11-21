# Order creation

Clients provide a stable request key when they create an Order.

The API scopes each key to the authenticated client and serializes requests from that client with the same key.
A successful creation reserves the key for 24 hours. After that window, the key can be used for a new Order.
During the window, reusing the key with different creation input returns HTTP 409. Reusing it with the same creation input is a duplicate and cannot create another Order.

The public API does not yet define what response a duplicate receives. Client workflows will depend on that response.
