-- Guided revision: the specialist's own text for each "Otro" reason, keyed by reason id.
-- Nullable with no default: a metadata-only change in Postgres (no table rewrite).

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "textosOtro" JSONB;
