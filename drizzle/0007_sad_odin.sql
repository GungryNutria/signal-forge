CREATE TABLE "muestras_precio" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"activo" text NOT NULL,
	"fuente_ts" timestamp with time zone NOT NULL,
	"bid" numeric(28, 10) NOT NULL,
	"ask" numeric(28, 10) NOT NULL,
	"leido_en" timestamp with time zone NOT NULL,
	CONSTRAINT "muestras_precio_activo_ck" CHECK ("muestras_precio"."activo" IN ('BTC/USD','SOL/USD'))
);
--> statement-breakpoint
CREATE TABLE "ranuras_decisor" (
	"ranura" timestamp with time zone PRIMARY KEY NOT NULL,
	"cerrada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"estado" text NOT NULL,
	"detalle" jsonb NOT NULL,
	CONSTRAINT "ranuras_decisor_estado_ck" CHECK ("ranuras_decisor"."estado" IN ('completa','parcial','invalida','sin_llegar','apagado'))
);
--> statement-breakpoint
CREATE TABLE "resultados_hipoteticos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origen" text NOT NULL,
	"evaluacion_id" uuid,
	"decision_id" uuid,
	"activo" text NOT NULL,
	"t0" timestamp with time zone NOT NULL,
	"precio_entrada" numeric(28, 10),
	"nocional_usd" numeric(18, 2) NOT NULL,
	"stop_loss" numeric(28, 10),
	"take_profit" numeric(28, 10),
	"comision_bps" integer NOT NULL,
	"resultado" text NOT NULL,
	"tocado_en" timestamp with time zone,
	"precio_toque" numeric(28, 10),
	"pnl_a_nivel_usd" numeric(18, 2),
	"pnl_a_nivel_pct" numeric(10, 6),
	"etiqueta_exito" smallint,
	"huecos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" text NOT NULL,
	"calculado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resultados_hipoteticos_evaluacion_id_unique" UNIQUE("evaluacion_id"),
	CONSTRAINT "resultados_hipoteticos_decision_id_unique" UNIQUE("decision_id"),
	CONSTRAINT "resultados_hipoteticos_origen_ck" CHECK ("resultados_hipoteticos"."origen" IN ('senal_registrada','entrada_evitada')),
	CONSTRAINT "resultados_hipoteticos_uno_ck" CHECK (("resultados_hipoteticos"."evaluacion_id" IS NOT NULL) <> ("resultados_hipoteticos"."decision_id" IS NOT NULL)),
	CONSTRAINT "resultados_hipoteticos_resultado_ck" CHECK ("resultados_hipoteticos"."resultado" IN ('take_profit','stop_loss','sin_precio_entrada')),
	CONSTRAINT "resultados_hipoteticos_activo_ck" CHECK ("resultados_hipoteticos"."activo" IN ('BTC/USD','SOL/USD'))
);
--> statement-breakpoint
ALTER TABLE "resultados_hipoteticos" ADD CONSTRAINT "resultados_hipoteticos_evaluacion_id_evaluaciones_id_fk" FOREIGN KEY ("evaluacion_id") REFERENCES "public"."evaluaciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resultados_hipoteticos" ADD CONSTRAINT "resultados_hipoteticos_decision_id_decisiones_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisiones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "muestras_precio_activo_fuente_uq" ON "muestras_precio" USING btree ("activo","fuente_ts");