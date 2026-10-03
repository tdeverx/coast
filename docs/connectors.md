# Future external connector contract

This is a design for the versioned HTTP/webhook boundary requested in the brief, not a shipped connector runtime. First-party adapters remain explicit in-process TypeScript. The browser `/api/v1` routes use Coast sessions. The shipped [public API](public-api.md) uses separate personal tokens; it does not implement this provider connector protocol.

A future connector is an external process registered by an administrator for a particular service instance. It receives a revocable, server-held credential with explicit capability grants and selected Coast user connections. A provider identity never implicitly grants access to another user. Coast owns canonical media IDs and decides whether imported tracking changes apply.

## Proposed version 1 boundary

| Endpoint | Purpose | Required grant |
| --- | --- | --- |
| `GET /api/connectors/v1/capabilities` | Negotiate supported protocol version and the connector's granted capabilities | Registered connector |
| `POST /api/connectors/v1/events` | Submit validated availability, metadata or tracking observations | Corresponding import capability |
| `GET /api/connectors/v1/actions` | Claim a bounded batch of outbound work scoped to the connector | Corresponding export capability |
| `POST /api/connectors/v1/actions/{id}/result` | Acknowledge success or a structured retryable/permanent failure | Claimed action and connection |

These routes are deliberately not implemented for 1.0. Their authentication must be independent of browser cookies. Polling is sufficient; no WebSocket or embedded JavaScript plugin is needed.

Each inbound event has an immutable `eventId`, `instanceId`, `connectionId`, `occurredAt`, an allowlisted `type`, and a typed payload. Example:

```json
{
  "eventId": "provider-event-9842",
  "instanceId": "coast-instance-uuid",
  "connectionId": "coast-connection-uuid",
  "occurredAt": "2026-09-27T12:00:00Z",
  "type": "tracking.progress",
  "payload": {
    "providerItemId": "external-item-42",
    "positionSeconds": 900,
    "durationSeconds": 5400
  }
}
```

The registered connector/instance/connection/event identity is the idempotency key. The payload schema depends on the negotiated capability and event type; arbitrary database columns and executable code are forbidden. The connection scope is checked against the credential before provider IDs resolve to Coast IDs. A duplicate returns its existing acknowledgement, while changed content under the same event ID returns a conflict. Contradictory tracking observations use Coast's existing evidence/review flow.

Webhooks use a timestamp and HMAC over the exact bounded request body, with constant-time signature comparison, a short clock-skew window, and stored event IDs for durable replay prevention. HTTPS is required outside a trusted explicitly configured LAN. Responses distinguish validation/permission errors from transient failures; accepted events return an acknowledgement only after their database transaction commits. Outbound claims and results reuse the existing ordered, retryable PostgreSQL outbox. Credentials can be revoked without removing imported data.

Any implementation of this design requires its own compatibility and threat review. Version changes must be explicit; this document does not introduce a private 0.x compatibility layer.
