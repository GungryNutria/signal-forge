-- Append-only (RNF-6, REQ-20, REQ-22): las tablas de registro no admiten UPDATE, DELETE ni TRUNCATE.
-- lecturas_mercado (caché que se reescribe) queda fuera.
CREATE FUNCTION sf_prohibir_cambios() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'sf_prohibir_cambios: % en % no permitido, la tabla es de solo inserción', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ejecuciones', 'ejecuciones_cierre', 'evaluaciones', 'propuestas', 'ordenes',
    'eventos_orden', 'lotes', 'cierres_lote', 'investigaciones', 'eventos'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER sf_solo_insercion_fila BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION sf_prohibir_cambios()', t);
    EXECUTE format(
      'CREATE TRIGGER sf_solo_insercion_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION sf_prohibir_cambios()', t);
  END LOOP;
END;
$$;
--> statement-breakpoint
-- Ejecución con su estado; sin cierre es "en_curso", y "error" si lleva más de 10 min (murió).
CREATE VIEW v_ejecuciones AS
SELECT e.id, e.ranura, e.inicio, e.version_regla, c.fin, c.error,
  COALESCE(c.estado, CASE WHEN e.inicio < now() - interval '10 minutes' THEN 'error' ELSE 'en_curso' END) AS estado
FROM ejecuciones e
LEFT JOIN ejecuciones_cierre c ON c.ejecucion_id = e.id;
--> statement-breakpoint
-- Orden con su último evento.
CREATE VIEW v_ordenes AS
SELECT o.id, o.propuesta_id, o.lote_id, o.tramo, o.client_order_id, o.activo, o.lado,
  o.nocional_usd, o.cantidad, o.creada_en,
  u.estado, u.cantidad_llenada, u.precio_medio, u.broker_order_id, u.momento AS estado_en
FROM ordenes o
LEFT JOIN LATERAL (
  SELECT ev.estado, ev.cantidad_llenada, ev.precio_medio, ev.broker_order_id, ev.momento
  FROM eventos_orden ev
  WHERE ev.orden_id = o.id
  ORDER BY ev.momento DESC, ev.id DESC
  LIMIT 1
) u ON true;
--> statement-breakpoint
-- Lote con su cierre. Los lotes nacen al llenarse la entrada, así que aquí solo hay
-- "abierto" y "cerrado"; una entrada sin llenar se ve en v_ordenes (tramo = 'entrada', sin lote).
CREATE VIEW v_lotes AS
SELECT l.id, l.propuesta_id, l.orden_entrada_id, l.activo, l.abierto_en, l.precio_entrada,
  l.cantidad_llenada, l.cantidad_neta, l.nocional_entrada_usd, l.comision_bps, l.stop_loss, l.take_profit,
  CASE WHEN c.lote_id IS NULL THEN 'abierto' ELSE 'cerrado' END AS estado,
  c.orden_salida_id, c.cerrado_en, c.precio_salida, c.motivo_cierre, c.pnl_neto_usd, c.pnl_neto_pct,
  c.duracion_s, c.etiqueta_exito
FROM lotes l
LEFT JOIN cierres_lote c ON c.lote_id = l.id;
--> statement-breakpoint
-- Dataset (REQ-26, REQ-35): una fila por evaluación.
CREATE VIEW v_dataset AS
SELECT ev.id AS evaluacion_id, ev.ejecucion_id, ej.ranura, ev.evaluada_en, ev.activo, ev.version_regla,
  ev.resultado, ev.foto, p.id AS propuesta_id, p.decision, p.motivo, l.id AS lote_id,
  CASE
    WHEN p.id IS NULL OR p.decision <> 'ejecutada' THEN 'no_aplica'
    WHEN c.lote_id IS NOT NULL THEN 'cerrada'
    WHEN l.id IS NULL AND oe.estado IN ('rechazada', 'cancelada', 'no_enviada') THEN 'no_aplica'
    ELSE 'pendiente'
  END AS etiqueta_estado,
  c.motivo_cierre, c.etiqueta_exito, c.pnl_neto_usd, c.pnl_neto_pct,
  round(c.duracion_s / 60.0, 2) AS duracion_min
FROM evaluaciones ev
JOIN ejecuciones ej ON ej.id = ev.ejecucion_id
LEFT JOIN propuestas p ON p.evaluacion_id = ev.id AND p.es_original
LEFT JOIN lotes l ON l.propuesta_id = p.id
LEFT JOIN cierres_lote c ON c.lote_id = l.id
LEFT JOIN v_ordenes oe ON oe.propuesta_id = p.id AND oe.tramo = 'entrada';
