# Workflow

The Workflow uses `redo` when execution must resume from an earlier Step.

The HTTP client fetches Workflow configuration with a read-only GET request.
It retries the same HTTP request only if the connection fails before the client sends any request data.
The configured transport retry count limits the number of additional attempts.
The client reports the transport failure if the retries are exhausted.
