# Token refresh

The Client sends a refresh token to the Auth Service.

The Auth Service is the sole authority for refresh-token state.

On success, the Auth Service invalidates the old refresh token and returns a new access token and refresh token.

A refresh token can be used only once.

Concurrent requests with the same refresh token produce at most one successful refresh.

The public API returns `TOKEN_ALREADY_USED` for later requests.

This contract is stable and external clients can depend on it.

Token lifetime is configurable and comes from deployment policy.

Implementation details such as database schema and locking mechanism are out of scope.
