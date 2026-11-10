-- Random share token for the public passport page (/verificar/<shareToken>), replacing the
-- enumerable /verificar/<documento>/<numeroPasaporte> link in new QR codes and share links.
--
-- 32 bytes from two gen_random_uuid() values (core Postgres >= 13, CSPRNG, no extension
-- needed; 244 random bits), base64url without padding: 43 characters, URL-safe.
--
-- The default is volatile, so ADD COLUMN rewrites the table and evaluates it once per
-- existing row: every current holder gets their own token in this statement (the backfill).
-- Rows inserted later (registration, the Mongo copy script) get one from the same default.

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "shareToken" TEXT NOT NULL DEFAULT rtrim(translate(encode((uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid())), 'base64'::text), '+/'::text, '-_'::text), '='::text);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_shareToken_key" ON "usuarios"("shareToken");
