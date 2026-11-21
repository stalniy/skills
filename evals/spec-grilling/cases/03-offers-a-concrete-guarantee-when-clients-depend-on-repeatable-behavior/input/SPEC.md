# Payment creation

Clients call `POST /payments`.

Network timeouts can make a client retry the same request.
The specification does not define whether duplicate requests can create multiple Payments.

Client integrations will depend on the behavior.
