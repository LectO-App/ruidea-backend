-- "Hazles una foto con el móvil": phone links and the photos they stage before the
-- documents are joined into one PDF. Both tables are new and empty; no existing data changes.

-- CreateTable
CREATE TABLE "phone_tokens" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "codigo" TEXT,
    "caduca" TIMESTAMPTZ(3) NOT NULL,
    "conectadoEn" TIMESTAMPTZ(3),
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staged_files" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "blob" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "tamano" INTEGER NOT NULL,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staged_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "phone_tokens_codigo_key" ON "phone_tokens"("codigo");

-- CreateIndex
CREATE INDEX "phone_tokens_usuarioId_idx" ON "phone_tokens"("usuarioId");

-- CreateIndex
CREATE INDEX "phone_tokens_caduca_idx" ON "phone_tokens"("caduca");

-- CreateIndex
CREATE INDEX "staged_files_usuarioId_grupo_orden_idx" ON "staged_files"("usuarioId", "grupo", "orden");

-- CreateIndex
CREATE INDEX "staged_files_creadoEn_idx" ON "staged_files"("creadoEn");

-- AddForeignKey
ALTER TABLE "phone_tokens" ADD CONSTRAINT "phone_tokens_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staged_files" ADD CONSTRAINT "staged_files_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
