-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "nombre" TEXT,
    "apellidos" TEXT,
    "paisResidencia" TEXT,
    "localidadResidencia" TEXT,
    "lugarNacimiento" TEXT,
    "tipoDocumento" TEXT,
    "numeroDocumento" TEXT,
    "fechaNacimiento" TIMESTAMPTZ(3),
    "correoElectronico" TEXT NOT NULL,
    "numeroTelefono" TEXT,
    "dislexia" BOOLEAN DEFAULT false,
    "discalculia" BOOLEAN DEFAULT false,
    "disortografia" BOOLEAN DEFAULT false,
    "dispraxia" BOOLEAN DEFAULT false,
    "tdah" BOOLEAN DEFAULT false,
    "esTutor" BOOLEAN DEFAULT false,
    "tutorNombre" TEXT DEFAULT '',
    "tutorApellidos" TEXT DEFAULT '',
    "tutorParentesco" TEXT DEFAULT '',
    "password" TEXT NOT NULL,
    "emailVerificado" BOOLEAN DEFAULT false,
    "fechaCreacion" TIMESTAMPTZ(3),
    "estado" TEXT DEFAULT 'borrador',
    "mensajeMedico" TEXT DEFAULT '',
    "numeroPasaporte" INTEGER DEFAULT -1,
    "aceptoRecibirInfo" BOOLEAN DEFAULT false,
    "aceptoSolicitud" BOOLEAN DEFAULT false,
    "fechaConsentimiento" TIMESTAMPTZ(3),
    "fechaEnvio" TIMESTAMPTZ(3),
    "archivoBlob" TEXT DEFAULT '',
    "extra" JSONB,
    "orden" SERIAL NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counters" (
    "id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 1000,

    CONSTRAINT "counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditlogs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorType" TEXT DEFAULT 'anonymous',
    "actorId" TEXT,
    "target" TEXT,
    "ip" TEXT,
    "outcome" TEXT,
    "meta" JSONB DEFAULT '{}',
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditlogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifiers" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "activo" BOOLEAN DEFAULT true,
    "fechaCreacion" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP,
    "ultimoUso" TIMESTAMPTZ(3),

    CONSTRAINT "verifiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_correoElectronico_key" ON "usuarios"("correoElectronico");

-- CreateIndex
CREATE INDEX "usuarios_numeroPasaporte_idx" ON "usuarios"("numeroPasaporte");

-- CreateIndex
CREATE INDEX "usuarios_estado_idx" ON "usuarios"("estado");

-- CreateIndex
CREATE INDEX "usuarios_fechaCreacion_idx" ON "usuarios"("fechaCreacion" DESC);

-- CreateIndex
CREATE INDEX "auditlogs_at_idx" ON "auditlogs"("at" DESC);

-- CreateIndex
CREATE INDEX "auditlogs_action_at_idx" ON "auditlogs"("action", "at" DESC);

-- CreateIndex
CREATE INDEX "verifiers_keyHash_idx" ON "verifiers"("keyHash");

-- Issued passport numbers (>= 1000) are unique; the -1 placeholder is not. Same rule as the
-- partial unique index MongoDB had. (Prisma's schema language can't express it.)
CREATE UNIQUE INDEX "usuarios_numeroPasaporte_issued_key" ON "usuarios"("numeroPasaporte") WHERE "numeroPasaporte" >= 1000;

-- Ids stay MongoDB ObjectId strings (24 lowercase hex characters).
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_id_objectid" CHECK ("id" ~ '^[0-9a-f]{24}$');
ALTER TABLE "auditlogs" ADD CONSTRAINT "auditlogs_id_objectid" CHECK ("id" ~ '^[0-9a-f]{24}$');
ALTER TABLE "verifiers" ADD CONSTRAINT "verifiers_id_objectid" CHECK ("id" ~ '^[0-9a-f]{24}$');
