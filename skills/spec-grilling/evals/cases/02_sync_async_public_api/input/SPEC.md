# Report API

External clients call `POST /reports`.

A report can take from 2 seconds to 20 minutes to produce.

The specification does not say whether the request waits for the report or returns an asynchronous job.
External clients will integrate with this API before launch.
