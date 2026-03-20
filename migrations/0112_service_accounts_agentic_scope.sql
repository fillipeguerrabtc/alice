CREATE TABLE "service_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "namespace_id" uuid REFERENCES "namespaces"("id"),
  "agent_id" uuid REFERENCES "agents"("id"),
  "name" varchar(120) NOT NULL,
  "slug" varchar(120) NOT NULL,
  "description" text,
  "scope_type" "resource_scope_type" DEFAULT 'tenant' NOT NULL,
  "allowed_action_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "namespace_scope" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "agent_scope" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_by" uuid REFERENCES "users"("id"),
  "updated_by" uuid REFERENCES "users"("id"),
  "last_used_at" timestamp,
  "criado_em" timestamp DEFAULT now() NOT NULL,
  "atualizado_em" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "idx_service_accounts_tenant" ON "service_accounts" ("tenant_id");
CREATE INDEX "idx_service_accounts_scope" ON "service_accounts" ("tenant_id", "namespace_id", "agent_id");
CREATE INDEX "idx_service_accounts_enabled" ON "service_accounts" ("tenant_id", "enabled");
CREATE UNIQUE INDEX "uniq_service_accounts_tenant_slug" ON "service_accounts" ("tenant_id", "slug");
