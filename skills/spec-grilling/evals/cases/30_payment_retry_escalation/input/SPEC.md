# Payment retry
The service retries payment submissions after a network timeout. Retry count is configurable. The provider may charge before a timeout reaches us. The spec does not define how retry submissions relate to the original payment or how duplicate charges are prevented. This is a public payment service with durable transaction history.
