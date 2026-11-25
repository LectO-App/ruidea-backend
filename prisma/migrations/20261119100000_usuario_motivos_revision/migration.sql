-- Guided revision: the reasons a specialist gave and the groups the applicant changed since.
-- Nullable with a constant default: a metadata-only change in Postgres (no table rewrite).

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "cambiosDesdeRevision" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "motivosRevision" TEXT[] DEFAULT ARRAY[]::TEXT[];
