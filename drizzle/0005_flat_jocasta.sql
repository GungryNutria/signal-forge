CREATE TABLE "contextos_decisor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"token_huella" char(16) NOT NULL,
	"version" text NOT NULL,
	"contenido" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisiones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recibida_en" timestamp with time zone DEFAULT now() NOT NULL,
	"ranura" timestamp with time zone NOT NULL,
	"estado" text NOT NULL,
	"motivo" text,
	"motivos" jsonb,
	"valida" boolean NOT NULL,
	"es_original" boolean NOT NULL,
	"clave_idempotencia" text,
	"huella_contenido" char(64),
	"ejecucion_decisor" text,
	"version_instrucciones" text,
	"contexto_id" uuid,
	"activo" text,
	"decision" text,
	"confianza" numeric(4, 3),
	"razonamiento" text,
	"cuerpo_crudo" text,
	"modo_configurado" text,
	"modo_efectivo" text,
	"motivo_modo" text,
	CONSTRAINT "decisiones_estado_ck" CHECK ("decisiones"."estado" IN ('aceptada','rechazada')),
	CONSTRAINT "decisiones_valida_ck" CHECK (NOT "decisiones"."valida" OR (
        "decisiones"."activo" IN ('BTC/USD','SOL/USD')
        AND "decisiones"."decision" IN ('comprar','no_comprar')
        AND "decisiones"."confianza" BETWEEN 0 AND 1
        AND char_length("decisiones"."razonamiento") BETWEEN 1 AND 2000
        AND "decisiones"."contexto_id" IS NOT NULL
        AND "decisiones"."version_instrucciones" IS NOT NULL
        AND "decisiones"."modo_efectivo" IN ('ejecuta','solo_registra')
      ))
);
--> statement-breakpoint
ALTER TABLE "propuestas" ADD COLUMN "decision_id" uuid;--> statement-breakpoint
ALTER TABLE "decisiones" ADD CONSTRAINT "decisiones_contexto_id_contextos_decisor_id_fk" FOREIGN KEY ("contexto_id") REFERENCES "public"."contextos_decisor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contextos_decisor_creado_idx" ON "contextos_decisor" USING btree ("creado_en");--> statement-breakpoint
CREATE UNIQUE INDEX "decisiones_clave_original_uq" ON "decisiones" USING btree ("clave_idempotencia") WHERE "decisiones"."es_original";--> statement-breakpoint
CREATE UNIQUE INDEX "decisiones_ranura_activo_valida_uq" ON "decisiones" USING btree ("ranura","activo") WHERE "decisiones"."valida";--> statement-breakpoint
CREATE INDEX "decisiones_recibida_idx" ON "decisiones" USING btree ("recibida_en" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "decisiones_ranura_activo_idx" ON "decisiones" USING btree ("ranura","activo");--> statement-breakpoint
CREATE INDEX "decisiones_activo_valida_idx" ON "decisiones" USING btree ("activo","recibida_en" DESC NULLS LAST) WHERE "decisiones"."valida";--> statement-breakpoint
ALTER TABLE "propuestas" ADD CONSTRAINT "propuestas_decision_id_decisiones_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisiones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "propuestas_decision_id_idx" ON "propuestas" USING btree ("decision_id");