export type StrategyKernelMigration = {
  readonly id: string;
  readonly description: string;
  readonly sql: readonly string[];
};

export const strategyKernelMigrations = [
  {
    id: "001_strategy_kernel",
    description: "Create portable relational strategy kernel and evidence graph tables.",
    sql: [
      `create table if not exists organization (
        id text primary key,
        name text not null,
        created_at text not null,
        updated_at text not null
      )`,
      `create table if not exists workspace (
        id text primary key,
        organization_id text not null references organization(id),
        key text not null,
        name text not null,
        kind text not null,
        default_sensitivity text not null,
        created_at text not null,
        updated_at text not null,
        unique (organization_id, key)
      )`,
      `create table if not exists workspace_relation (
        id text primary key,
        organization_id text not null references organization(id),
        from_workspace_id text not null references workspace(id),
        to_workspace_id text not null references workspace(id),
        relation_type text not null,
        description text,
        created_at text not null
      )`,
      `create table if not exists actor (
        id text primary key,
        organization_id text not null references organization(id),
        kind text not null,
        display_name text not null,
        external_principal_id text,
        created_at text not null,
        updated_at text not null
      )`,
      `create table if not exists workspace_actor_role (
        id text primary key,
        workspace_id text not null references workspace(id),
        actor_id text not null references actor(id),
        role text not null,
        can_ratify_intent integer not null,
        can_approve_sensitivity_downgrade integer not null,
        created_at text not null,
        unique (workspace_id, actor_id, role)
      )`,
      `create table if not exists external_system (
        id text primary key,
        organization_id text not null references organization(id),
        kind text not null,
        name text not null,
        base_url text,
        created_at text not null
      )`,
      `create table if not exists external_resource_mapping (
        id text primary key,
        workspace_id text not null references workspace(id),
        external_system_id text not null references external_system(id),
        resource_type text not null,
        external_id text not null,
        external_url text,
        purpose text not null,
        sensitivity text not null,
        created_at text not null
      )`,
      `create table if not exists intent_node (
        id text primary key,
        workspace_id text not null references workspace(id),
        kind text not null,
        title text not null,
        body text not null,
        owner_actor_id text references actor(id),
        state text not null,
        horizon_start text,
        horizon_end text,
        due_at text,
        success_signal text,
        sensitivity text not null,
        origin_evidence_id text,
        created_by text not null,
        created_at text not null,
        updated_at text not null
      )`,
      `create table if not exists intent_edge (
        id text primary key,
        from_node_id text not null references intent_node(id),
        to_node_id text not null references intent_node(id),
        type text not null,
        confidence real not null,
        created_at text not null,
        created_by text not null
      )`,
      `create table if not exists evidence_item (
        id text primary key,
        workspace_id text not null references workspace(id),
        source_system text not null,
        source_type text not null,
        external_id text not null,
        external_url text,
        actor_id text references actor(id),
        occurred_at text not null,
        title text not null,
        body_excerpt text not null,
        content_hash text not null,
        sensitivity text not null,
        ingested_at text not null,
        unique (workspace_id, source_system, external_id)
      )`,
      `create table if not exists extracted_claim (
        id text primary key,
        evidence_item_id text not null references evidence_item(id),
        workspace_id text not null references workspace(id),
        claim_type text not null,
        text text not null,
        suggested_owner_id text references actor(id),
        suggested_due_at text,
        confidence real not null,
        state text not null,
        sensitivity text not null,
        ratified_node_id text references intent_node(id),
        created_at text not null,
        updated_at text not null
      )`,
      `create table if not exists projection (
        id text primary key,
        workspace_id text not null references workspace(id),
        intent_node_id text not null references intent_node(id),
        target_system text not null,
        target_type text not null,
        target_id text,
        target_url text,
        last_published_hash text,
        last_verified_at text,
        drift_status text not null,
        sensitivity text not null
      )`,
      `create table if not exists accountability_action (
        id text primary key,
        workspace_id text not null references workspace(id),
        intent_node_id text not null references intent_node(id),
        actor_id text not null references actor(id),
        channel text not null,
        state text not null,
        due_at text,
        last_nudged_at text,
        escalation_level integer not null,
        evidence_required integer not null,
        completion_evidence_id text references evidence_item(id),
        sensitivity text not null
      )`,
      `create table if not exists kernel_event (
        id text primary key,
        workspace_id text not null references workspace(id),
        actor_id text references actor(id),
        entity_type text not null,
        entity_id text not null,
        action text not null,
        payload_json text not null,
        occurred_at text not null,
        sensitivity text not null
      )`,
      `create table if not exists drift_finding (
        id text primary key,
        workspace_id text not null references workspace(id),
        finding_type text not null,
        title text not null,
        body text not null,
        state text not null,
        related_entity_type text,
        related_entity_id text,
        sensitivity text not null,
        created_at text not null,
        resolved_at text
      )`,
    ],
  },
  {
    id: "002_workspace_pack_runtime",
    description: "Persist workspace pack policy and template runtime state.",
    sql: [
      `create table if not exists workspace_pack_policy (
        id text primary key,
        workspace_id text not null references workspace(id),
        policy_key text not null,
        payload_json text not null,
        updated_at text not null,
        unique (workspace_id, policy_key)
      )`,
      `create table if not exists workspace_pack_template (
        id text primary key,
        workspace_id text not null references workspace(id),
        name text not null,
        path text not null,
        sensitivity text not null,
        updated_at text not null,
        unique (workspace_id, path)
      )`,
    ],
  },
] as const satisfies readonly [StrategyKernelMigration, ...StrategyKernelMigration[]];

export const strategyKernelTableNames: readonly string[] = [
  "organization",
  "workspace",
  "workspace_relation",
  "workspace_pack_policy",
  "workspace_pack_template",
  "actor",
  "workspace_actor_role",
  "external_system",
  "external_resource_mapping",
  "intent_node",
  "intent_edge",
  "evidence_item",
  "extracted_claim",
  "projection",
  "accountability_action",
  "kernel_event",
  "drift_finding",
];
