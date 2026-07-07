# Workspace Overlay

This document explains how Sarathi models team design, communication structure, sensitivity, and scope by combining source-system evidence with YAML overlays.

## Model

Sarathi starts with a source snapshot:

- installed organization,
- operating teams,
- source references,
- communication surfaces.

Then it applies a YAML overlay:

```yaml
version: 1
organizationId: acme
teams:
  - teamId: engineering
    displayName: Engineering
    sensitivity: confidential
    minimumTrustTier: trusted
    allowedDelegationStages:
      - answer
      - assist
      - coordinate
    modelEgress: approval-required
    requiresHumanApproval: true
```

## Inference And Override

Teams, Linear, GitHub, and Jira can suggest a structure, but they do not prove the intended boundary. YAML can override sensitivity upward, tighten model egress, or narrow delegation stages. It should not silently loosen a source-derived boundary without an explicit review path.

## Release Path

The Teams release should start with:

- Microsoft Teams bot and messaging extension entry points,
- Microsoft Graph ingestion for teams/channels/chats where consent allows,
- Linear issue/cycle/project ingestion,
- GitHub App repository, PR, and code-owner ingestion,
- YAML overlay loading from a repo or admin-configured storage path.

The core policy compiler should remain independent of those adapters.

Sarathi assumes one installed organization per deployment. Do not add cross-customer tenancy fields to the overlay model unless the deployment model changes.
