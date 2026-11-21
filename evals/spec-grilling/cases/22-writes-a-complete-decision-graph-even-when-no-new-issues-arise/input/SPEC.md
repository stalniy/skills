# Token refresh

This specification covers token refresh for active sessions. The Client sends a refresh token to the Auth Service.

The Auth Service is the sole authority for refresh-token state.

On success, the Auth Service invalidates the old refresh token and issues a new access token and refresh token for the same session in one rotation. Rotation preserves the session's expiration. The Auth Service returns the new tokens after the rotation commits.

A failed attempt before the rotation commits leaves the old refresh token unchanged.

Concurrent requests with the same refresh token produce at most one successful refresh.

The Auth Service sets each refresh token's expiration at issuance using the configurable lifetime from deployment policy.

The public API returns `INVALID_REFRESH_TOKEN` for an unrecognized or expired refresh token. For an unexpired refresh token consumed by a committed rotation, the public API returns `TOKEN_ALREADY_USED`. This includes concurrent requests that lose the race and retries after a lost response while the old token is still within its lifetime.

Both rejections leave token and session state unchanged. Any replacement tokens issued by an earlier rotation retain their existing validity.

This contract is stable and external clients can depend on it.

Session lifetime policy, client recovery after a rejected refresh, and implementation details such as database schema and locking are out of scope.
