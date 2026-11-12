ALTER TABLE "evaluaciones" DROP CONSTRAINT "evaluaciones_resultado_ck";--> statement-breakpoint
ALTER TABLE "eventos" DROP CONSTRAINT "eventos_tipo_ck";--> statement-breakpoint
ALTER TABLE "evaluaciones" ADD COLUMN "modo" text;--> statement-breakpoint
ALTER TABLE "evaluaciones" ADD COLUMN "motivo_modo" text;--> statement-breakpoint
ALTER TABLE "evaluaciones" ADD CONSTRAINT "evaluaciones_resultado_ck" CHECK ("evaluaciones"."resultado" IN ('sin_senal','propuesta','senal_registrada','datos_no_disponibles','error'));--> statement-breakpoint
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_tipo_ck" CHECK ("eventos"."tipo" IN ('auth_fallida','pausa_automatica','entorno_no_paper','error_ciclo','error_vigilante','modo_proponentes'));