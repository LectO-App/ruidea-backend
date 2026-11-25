-- Sign-in by emailed link: the SHA-256 of the latest link's nonce and when it stops working.
-- Both are NULL when no link is waiting to be used. Nullable columns without a default make
-- this a metadata-only change in Postgres (no table rewrite).

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "magicLinkHash" TEXT,
ADD COLUMN     "magicLinkExpira" TIMESTAMPTZ(3);
