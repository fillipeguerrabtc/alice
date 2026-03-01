ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "preferred_name" varchar(120);

UPDATE "agents"
SET "preferred_name" = "nome"
WHERE "preferred_name" IS NULL;
