#!/bin/sh
# Database tests for the Postgres schema, meant to run INSIDE a throwaway container next to a
# throwaway Postgres (never a real database). Needs `npm ci` and `prisma generate` done, and
# PG_ADMIN_URL = a superuser URL of that Postgres *without* a database name, e.g.
#   postgres://postgres:postgres@pg:5432
# It creates (and drops first) the databases rw_backfill, rw_test and rw_shadow.
#
# 1. Backfill: applies the migrations from before share tokens, inserts holders, then applies
#    the rest with `prisma migrate deploy` (as the container start does) and checks that every
#    existing holder got a distinct, URL-safe 43-character token and that the index is unique.
# 2. Drift: prisma/schema.prisma matches the migrations (`prisma migrate diff --exit-code`).
# 3. `node --test` on a freshly migrated database (test/share-token.pg.test.js uses it).
set -eu

: "${PG_ADMIN_URL:?set PG_ADMIN_URL}"
PRISMA=./node_modules/.bin/prisma
SHARE_MIGRATION=20261110100000_usuario_share_token
export CHECKPOINT_DISABLE=1

sql_admin() { printf '%s\n' "$1" | $PRISMA db execute --url "$PG_ADMIN_URL/postgres" --stdin >/dev/null; }
for db in rw_backfill rw_test rw_shadow; do
	sql_admin "DROP DATABASE IF EXISTS $db WITH (FORCE);"
	sql_admin "CREATE DATABASE $db;"
done

echo '== 1. backfill of existing holders'
OLD=$(mktemp -d)
cp -R prisma "$OLD/"
rm -rf "$OLD/prisma/migrations/$SHARE_MIGRATION"
DATABASE_URL="$PG_ADMIN_URL/rw_backfill" $PRISMA migrate deploy --schema "$OLD/prisma/schema.prisma"
$PRISMA db execute --url "$PG_ADMIN_URL/rw_backfill" --stdin <<'SQL'
INSERT INTO "usuarios" ("id", "correoElectronico", "password", "estado", "numeroPasaporte")
SELECT lpad(to_hex(g), 24, '0'), 'old' || g || '@example.test', 'x',
       CASE WHEN g % 3 = 0 THEN 'pendiente' ELSE 'aceptado' END,
       CASE WHEN g % 3 = 0 THEN -1 ELSE 1000 + g END
FROM generate_series(1, 500) AS g;
SQL
DATABASE_URL="$PG_ADMIN_URL/rw_backfill" $PRISMA migrate deploy
$PRISMA db execute --url "$PG_ADMIN_URL/rw_backfill" --stdin <<'SQL'
DO $$
DECLARE total int; distinct_tokens int; bad int; uniq int;
BEGIN
  SELECT count(*), count(DISTINCT "shareToken"),
         count(*) FILTER (WHERE "shareToken" IS NULL OR "shareToken" !~ '^[A-Za-z0-9_-]{43}$')
    INTO total, distinct_tokens, bad FROM "usuarios";
  SELECT count(*) INTO uniq FROM pg_indexes
   WHERE tablename = 'usuarios' AND indexname = 'usuarios_shareToken_key' AND indexdef LIKE 'CREATE UNIQUE INDEX%';
  IF total <> 500 OR distinct_tokens <> total OR bad <> 0 OR uniq <> 1 THEN
    RAISE EXCEPTION 'backfill check failed: total=% distinct=% bad=% unique_index=%', total, distinct_tokens, bad, uniq;
  END IF;
  RAISE NOTICE 'backfill ok: % holders, % distinct tokens', total, distinct_tokens;
END $$;
SQL
echo 'backfill ok: 500 existing holders, 500 distinct 43-char base64url tokens, unique index present'
rm -rf "$OLD"

echo '== 2. schema.prisma matches the migrations'
$PRISMA migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma \
	--shadow-database-url "$PG_ADMIN_URL/rw_shadow" --exit-code
echo 'no drift'

echo '== 3. node --test against a migrated database'
DATABASE_URL="$PG_ADMIN_URL/rw_test" $PRISMA migrate deploy
TEST_DATABASE_URL="$PG_ADMIN_URL/rw_test" JWT_SECRET=ci-test-secret-not-used-in-prod node --test
