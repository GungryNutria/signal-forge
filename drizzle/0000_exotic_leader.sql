CREATE TABLE "cierres_lote" (
	"lote_id" uuid PRIMARY KEY NOT NULL,
	"orden_salida_id" uuid NOT NULL,
	"cerrado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"precio_salida" numeric(28, 10) NOT NULL,
	"motivo_cierre" text NOT NULL,
	"pnl_neto_usd" numeric(18, 2) NOT NULL,
	"pnl_neto_pct" numeric(10, 6) NOT NULL,
	"duracion_s" integer NOT NULL,
	"etiqueta_exito" smallint NOT NULL,
	CONSTRAINT "cierres_lote_orden_salida_id_unique" UNIQUE("orden_salida_id"),
	CONSTRAINT "cierres_lote_motivo_ck" CHECK ("cierres_lote"."motivo_cierre" IN ('take_profit','stop_loss')),
	CONSTRAINT "cierres_lote_etiqueta_ck" CHECK ("cierres_lote"."etiqueta_exito" IN (0,1))
);
--> statement-breakpoint
CREATE TABLE "ejecuciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ranura" timestamp with time zone NOT NULL,
	"inicio" timestamp with time zone DEFAULT now() NOT NULL,
	"version_regla" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ejecuciones_cierre" (
	"ejecucion_id" uuid PRIMARY KEY NOT NULL,
	"fin" timestamp with time zone DEFAULT now() NOT NULL,
	"estado" text NOT NULL,
	"error" text,
	CONSTRAINT "ejecuciones_cierre_estado_ck" CHECK ("ejecuciones_cierre"."estado" IN ('completada','error','omitida_solapamiento'))
);
--> statement-breakpoint
CREATE TABLE "evaluaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ejecucion_id" uuid NOT NULL,
	"activo" text NOT NULL,
	"evaluada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"resultado" text NOT NULL,
	"version_regla" text NOT NULL,
	"foto" jsonb NOT NULL,
	"investigacion_id" uuid,
	"error_detalle" text,
	CONSTRAINT "evaluaciones_activo_ck" CHECK ("evaluaciones"."activo" IN ('BTC/USD','SOL/USD')),
	CONSTRAINT "evaluaciones_resultado_ck" CHECK ("evaluaciones"."resultado" IN ('sin_senal','propuesta','datos_no_disponibles','error'))
);
--> statement-breakpoint
CREATE TABLE "eventos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"momento" timestamp with time zone DEFAULT now() NOT NULL,
	"tipo" text NOT NULL,
	"activo" text,
	"dia_utc" date,
	"detalle" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "eventos_tipo_ck" CHECK ("eventos"."tipo" IN ('auth_fallida','pausa_automatica','entorno_no_paper','error_ciclo','error_vigilante'))
);
--> statement-breakpoint
CREATE TABLE "eventos_orden" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"orden_id" uuid NOT NULL,
	"momento" timestamp with time zone DEFAULT now() NOT NULL,
	"estado" text NOT NULL,
	"cantidad_llenada" numeric(28, 10),
	"precio_medio" numeric(28, 10),
	"broker_order_id" text,
	"respuesta" jsonb,
	"detalle" text,
	CONSTRAINT "eventos_orden_estado_ck" CHECK ("eventos_orden"."estado" IN ('pendiente_envio','enviada','aceptada','parcial','llenada','cancelada','rechazada','desconocido','no_enviada'))
);
--> statement-breakpoint
CREATE TABLE "investigaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recibida_en" timestamp with time zone DEFAULT now() NOT NULL,
	"estado" text NOT NULL,
	"motivo" text,
	"motivos" jsonb,
	"clave_idempotencia" text,
	"huella_contenido" char(64),
	"ejecucion_investigador" text,
	"version_instrucciones" text,
	"activo" text,
	"sentimiento" numeric(4, 3),
	"noticia_fuerte" boolean,
	"confianza" numeric(4, 3),
	"resumen" text,
	"fuentes" text[],
	"cuerpo_crudo" text,
	CONSTRAINT "investigaciones_estado_ck" CHECK ("investigaciones"."estado" IN ('aceptada','rechazada')),
	CONSTRAINT "investigaciones_aceptada_ck" CHECK ("investigaciones"."estado" <> 'aceptada' OR (
        "investigaciones"."clave_idempotencia" IS NOT NULL AND "investigaciones"."huella_contenido" IS NOT NULL
        AND "investigaciones"."ejecucion_investigador" IS NOT NULL AND "investigaciones"."version_instrucciones" IS NOT NULL
        AND "investigaciones"."activo" IN ('BTC/USD','SOL/USD')
        AND "investigaciones"."sentimiento" BETWEEN -1 AND 1
        AND "investigaciones"."noticia_fuerte" IS NOT NULL
        AND "investigaciones"."confianza" BETWEEN 0 AND 1
        AND char_length("investigaciones"."resumen") BETWEEN 1 AND 600
        AND cardinality("investigaciones"."fuentes") BETWEEN 0 AND 10
      ))
);
--> statement-breakpoint
CREATE TABLE "lecturas_mercado" (
	"activo" text PRIMARY KEY NOT NULL,
	"bid" numeric(28, 10),
	"ask" numeric(28, 10),
	"ultimo" numeric(28, 10),
	"fuente_ts" timestamp with time zone,
	"leido_en" timestamp with time zone,
	"ultimo_error_en" timestamp with time zone,
	"ultimo_error" text
);
--> statement-breakpoint
CREATE TABLE "lotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"propuesta_id" uuid NOT NULL,
	"orden_entrada_id" uuid NOT NULL,
	"activo" text NOT NULL,
	"abierto_en" timestamp with time zone DEFAULT now() NOT NULL,
	"precio_entrada" numeric(28, 10) NOT NULL,
	"cantidad_llenada" numeric(28, 10) NOT NULL,
	"cantidad_neta" numeric(28, 10) NOT NULL,
	"nocional_entrada_usd" numeric(18, 2) NOT NULL,
	"comision_bps" integer NOT NULL,
	"stop_loss" numeric(28, 10) NOT NULL,
	"take_profit" numeric(28, 10) NOT NULL,
	CONSTRAINT "lotes_propuesta_id_unique" UNIQUE("propuesta_id"),
	CONSTRAINT "lotes_orden_entrada_id_unique" UNIQUE("orden_entrada_id")
);
--> statement-breakpoint
CREATE TABLE "ordenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"propuesta_id" uuid,
	"lote_id" uuid,
	"tramo" text NOT NULL,
	"client_order_id" text NOT NULL,
	"activo" text NOT NULL,
	"lado" text NOT NULL,
	"nocional_usd" numeric(18, 2),
	"cantidad" numeric(28, 10),
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ordenes_client_order_id_unique" UNIQUE("client_order_id"),
	CONSTRAINT "ordenes_tramo_ck" CHECK ("ordenes"."tramo" IN ('entrada','salida')),
	CONSTRAINT "ordenes_client_order_id_len_ck" CHECK (length("ordenes"."client_order_id") <= 128)
);
--> statement-breakpoint
CREATE TABLE "propuestas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clave_idempotencia" text,
	"huella_contenido" char(64),
	"es_original" boolean NOT NULL,
	"proponente" text,
	"ejecucion_id" uuid,
	"evaluacion_id" uuid,
	"version_regla" text,
	"activo" text,
	"lado" text,
	"nocional_usd" numeric(18, 2),
	"cantidad" numeric(28, 10),
	"tipo_orden" text,
	"justificacion" jsonb,
	"entrada_cruda" jsonb NOT NULL,
	"recibida_en" timestamp with time zone DEFAULT now() NOT NULL,
	"reglas" jsonb,
	"reglas_incumplidas" text[] DEFAULT '{}' NOT NULL,
	"decision" text NOT NULL,
	"motivo" text NOT NULL,
	CONSTRAINT "propuestas_decision_ck" CHECK ("propuestas"."decision" IN ('ejecutada','rechazada','conflicto','error'))
);
--> statement-breakpoint
ALTER TABLE "cierres_lote" ADD CONSTRAINT "cierres_lote_lote_id_lotes_id_fk" FOREIGN KEY ("lote_id") REFERENCES "public"."lotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cierres_lote" ADD CONSTRAINT "cierres_lote_orden_salida_id_ordenes_id_fk" FOREIGN KEY ("orden_salida_id") REFERENCES "public"."ordenes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ejecuciones_cierre" ADD CONSTRAINT "ejecuciones_cierre_ejecucion_id_ejecuciones_id_fk" FOREIGN KEY ("ejecucion_id") REFERENCES "public"."ejecuciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluaciones" ADD CONSTRAINT "evaluaciones_ejecucion_id_ejecuciones_id_fk" FOREIGN KEY ("ejecucion_id") REFERENCES "public"."ejecuciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluaciones" ADD CONSTRAINT "evaluaciones_investigacion_id_investigaciones_id_fk" FOREIGN KEY ("investigacion_id") REFERENCES "public"."investigaciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eventos_orden" ADD CONSTRAINT "eventos_orden_orden_id_ordenes_id_fk" FOREIGN KEY ("orden_id") REFERENCES "public"."ordenes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_propuesta_id_propuestas_id_fk" FOREIGN KEY ("propuesta_id") REFERENCES "public"."propuestas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_orden_entrada_id_ordenes_id_fk" FOREIGN KEY ("orden_entrada_id") REFERENCES "public"."ordenes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordenes" ADD CONSTRAINT "ordenes_propuesta_id_propuestas_id_fk" FOREIGN KEY ("propuesta_id") REFERENCES "public"."propuestas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordenes" ADD CONSTRAINT "ordenes_lote_id_lotes_id_fk" FOREIGN KEY ("lote_id") REFERENCES "public"."lotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propuestas" ADD CONSTRAINT "propuestas_evaluacion_id_evaluaciones_id_fk" FOREIGN KEY ("evaluacion_id") REFERENCES "public"."evaluaciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cierres_lote_cerrado_idx" ON "cierres_lote" USING btree ("cerrado_en");--> statement-breakpoint
CREATE INDEX "ejecuciones_inicio_idx" ON "ejecuciones" USING btree ("inicio" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "evaluaciones_ejecucion_activo_uq" ON "evaluaciones" USING btree ("ejecucion_id","activo");--> statement-breakpoint
CREATE INDEX "evaluaciones_activo_evaluada_idx" ON "evaluaciones" USING btree ("activo","evaluada_en" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "evaluaciones_resultado_idx" ON "evaluaciones" USING btree ("resultado");--> statement-breakpoint
CREATE UNIQUE INDEX "eventos_pausa_dia_uq" ON "eventos" USING btree ("dia_utc") WHERE "eventos"."tipo" = 'pausa_automatica';--> statement-breakpoint
CREATE INDEX "eventos_orden_orden_momento_idx" ON "eventos_orden" USING btree ("orden_id","momento" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "investigaciones_clave_aceptada_uq" ON "investigaciones" USING btree ("clave_idempotencia") WHERE "investigaciones"."estado" = 'aceptada';--> statement-breakpoint
CREATE INDEX "investigaciones_activo_aceptada_idx" ON "investigaciones" USING btree ("activo","recibida_en" DESC NULLS LAST) WHERE "investigaciones"."estado" = 'aceptada';--> statement-breakpoint
CREATE INDEX "investigaciones_recibida_idx" ON "investigaciones" USING btree ("recibida_en");--> statement-breakpoint
CREATE INDEX "lotes_activo_idx" ON "lotes" USING btree ("activo");--> statement-breakpoint
CREATE UNIQUE INDEX "propuestas_clave_original_uq" ON "propuestas" USING btree ("clave_idempotencia") WHERE "propuestas"."es_original";--> statement-breakpoint
CREATE INDEX "propuestas_recibida_idx" ON "propuestas" USING btree ("recibida_en" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "propuestas_activo_recibida_idx" ON "propuestas" USING btree ("activo","recibida_en" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "propuestas_decision_idx" ON "propuestas" USING btree ("decision");--> statement-breakpoint
CREATE INDEX "propuestas_ejecucion_activo_idx" ON "propuestas" USING btree ("ejecucion_id","activo");