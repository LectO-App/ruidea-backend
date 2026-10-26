-- Every existing row starts at 0, the version that sessions and reset links issued before
-- this column existed are treated as having, so the deploy logs nobody out. A constant
-- default makes this a metadata-only change in Postgres (no table rewrite).

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;
