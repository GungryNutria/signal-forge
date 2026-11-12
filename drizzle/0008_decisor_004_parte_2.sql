-- Spec 004, parte 2 (T-3): solo inserción para las tres tablas nuevas y las vistas del dataset y los cierres.
-- Todas las columnas nuevas de las vistas van al final (lo exige CREATE OR REPLACE VIEW, RK-11).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['muestras_precio', 'resultados_hipoteticos', 'ranuras_decisor'] LOOP
    EXECUTE format(
      'CREATE TRIGGER sf_solo_insercion_fila BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION sf_prohibir_cambios()', t);
    EXECUTE format(
      'CREATE TRIGGER sf_solo_insercion_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION sf_prohibir_cambios()', t);
  END LOOP;
END;
$$;
--> statement-breakpoint
-- REQ-21: PnL a nivel = lo que habría dado vender exactamente en el nivel tocado, con la comisión modelada.
-- pnl_a_nivel_usd = round(cantidad_neta x nivel x (1 - comision) - nocional de entrada, 2): el mismo cálculo del PnL neto
-- pero con el precio del nivel en vez del llenado; sin deslizamiento da el PnL neto.
CREATE OR REPLACE VIEW v_cierres AS
SELECT x.*, x.pnl_neto_usd - x.movimiento_usd - x.deslizamiento_usd AS comision_usd,
  a.usd AS pnl_a_nivel_usd, round(a.usd / x.nocional_entrada_usd, 6) AS pnl_a_nivel_pct
FROM (
  SELECT c.lote_id, l.activo, c.motivo_cierre, c.cerrado_en, l.precio_entrada, c.precio_salida,
    l.nocional_entrada_usd, l.comision_bps, c.pnl_neto_usd, c.pnl_neto_pct,
    CASE WHEN c.motivo_cierre = 'stop_loss' THEN 'stop_loss' ELSE 'take_profit' END AS nivel,
    os.precio_disparo, os.precio_disparo_ts,
    round(l.cantidad_neta * (n.s - l.precio_entrada), 2) AS movimiento_usd,
    round(l.cantidad_neta * (c.precio_salida - n.s), 2) AS deslizamiento_usd,
    round(c.precio_salida / n.s - 1, 6) AS deslizamiento_pct
  FROM cierres_lote c
  JOIN lotes l ON l.id = c.lote_id
  JOIN ordenes os ON os.id = c.orden_salida_id
  CROSS JOIN LATERAL (SELECT CASE WHEN c.motivo_cierre = 'stop_loss' THEN l.stop_loss ELSE l.take_profit END AS s) n
) x
JOIN lotes lq ON lq.id = x.lote_id
CROSS JOIN LATERAL (
  SELECT round(lq.cantidad_neta * CASE WHEN x.nivel = 'stop_loss' THEN lq.stop_loss ELSE lq.take_profit END
    * (1 - x.comision_bps / 10000.0) - x.nocional_entrada_usd, 2) AS usd
) a;
--> statement-breakpoint
-- v_dataset (REQ-31): las columnas de la 003 intactas y en su orden; al final, proponente, modo, PnL a nivel y el resultado
-- hipotético de la señal registrada. hip_resultado es 'pendiente' si la señal aún no tiene fila y NULL en las demás evaluaciones.
CREATE OR REPLACE VIEW v_dataset AS
SELECT ev.id AS evaluacion_id, ev.ejecucion_id, ej.ranura, ev.evaluada_en, ev.activo, ev.version_regla,
  ev.resultado, ev.foto, p.id AS propuesta_id, p.decision, p.motivo, l.id AS lote_id,
  CASE
    WHEN p.id IS NULL OR p.decision <> 'ejecutada' THEN 'no_aplica'
    WHEN c.lote_id IS NOT NULL THEN 'cerrada'
    WHEN l.id IS NULL AND oe.estado IN ('rechazada', 'cancelada', 'no_enviada') THEN 'no_aplica'
    ELSE 'pendiente'
  END AS etiqueta_estado,
  c.motivo_cierre, c.etiqueta_exito, c.pnl_neto_usd, c.pnl_neto_pct,
  round(c.duracion_s / 60.0, 2) AS duracion_min,
  CASE
    WHEN p.reglas IS NULL OR jsonb_typeof(p.reglas) <> 'array' THEN NULL
    WHEN p.reglas @> '[{"regla":"R11"}]'::jsonb THEN 'R1-R11'
    ELSE 'R1-R10'
  END AS reglas_aplicadas,
  CASE
    WHEN p.id IS NULL OR p.reglas IS NULL OR jsonb_typeof(p.reglas) <> 'array' THEN NULL
    WHEN NOT p.reglas @> '[{"regla":"R11"}]'::jsonb THEN 'no_evaluada'
    ELSE (
      SELECT CASE WHEN NOT (r->>'aplica')::boolean THEN 'no_aplica' WHEN (r->>'cumple')::boolean THEN 'cumple' ELSE 'incumple' END
      FROM jsonb_array_elements(p.reglas) r WHERE r->>'regla' = 'R11' LIMIT 1
    )
  END AS r11,
  vc.nivel AS nivel_cierre, vc.precio_disparo, vc.deslizamiento_usd, vc.deslizamiento_pct, vc.comision_usd,
  'ciclo'::text AS proponente, ev.modo, ev.motivo_modo, vc.pnl_a_nivel_usd, vc.pnl_a_nivel_pct,
  CASE WHEN ev.resultado = 'senal_registrada' THEN coalesce(h.resultado, 'pendiente') END AS hip_resultado,
  h.tocado_en AS hip_tocado_en, h.pnl_a_nivel_usd AS hip_pnl_a_nivel_usd, h.pnl_a_nivel_pct AS hip_pnl_a_nivel_pct,
  h.etiqueta_exito AS hip_etiqueta_exito, h.huecos AS hip_huecos
FROM evaluaciones ev
JOIN ejecuciones ej ON ej.id = ev.ejecucion_id
LEFT JOIN propuestas p ON p.evaluacion_id = ev.id AND p.es_original
LEFT JOIN lotes l ON l.propuesta_id = p.id
LEFT JOIN cierres_lote c ON c.lote_id = l.id
LEFT JOIN v_ordenes oe ON oe.propuesta_id = p.id AND oe.tramo = 'entrada'
LEFT JOIN v_cierres vc ON vc.lote_id = l.id
LEFT JOIN resultados_hipoteticos h ON h.evaluacion_id = ev.id;
--> statement-breakpoint
-- v_dataset_decisor (REQ-31): una fila por decisión recibida (válida o no), con su contexto, la decisión del riesgo y la
-- etiqueta real si se ejecutó; el resultado hipotético solo en las `no_comprar` válidas (entradas evitadas).
CREATE VIEW v_dataset_decisor AS
SELECT d.id AS decision_id, d.recibida_en, d.ranura, d.activo, 'decisor'::text AS proponente,
  d.modo_efectivo AS modo, d.motivo_modo, d.valida, d.estado, d.motivo, d.decision, d.confianza, d.razonamiento,
  d.version_instrucciones, d.ejecucion_decisor, d.contexto_id, cx.contenido AS contexto,
  p.id AS propuesta_id, p.decision AS propuesta_decision, p.motivo AS propuesta_motivo, p.reglas_incumplidas,
  l.id AS lote_id,
  CASE
    WHEN p.id IS NULL OR p.decision <> 'ejecutada' THEN 'no_aplica'
    WHEN c.lote_id IS NOT NULL THEN 'cerrada'
    WHEN l.id IS NULL AND oe.estado IN ('rechazada', 'cancelada', 'no_enviada') THEN 'no_aplica'
    ELSE 'pendiente'
  END AS etiqueta_estado,
  c.motivo_cierre, c.etiqueta_exito, c.pnl_neto_usd, c.pnl_neto_pct, vc.pnl_a_nivel_usd, vc.pnl_a_nivel_pct,
  CASE WHEN d.valida AND d.decision = 'no_comprar' THEN coalesce(h.resultado, 'pendiente') END AS hip_resultado,
  h.tocado_en AS hip_tocado_en, h.pnl_a_nivel_usd AS hip_pnl_a_nivel_usd, h.pnl_a_nivel_pct AS hip_pnl_a_nivel_pct,
  h.etiqueta_exito AS hip_etiqueta_exito, h.huecos AS hip_huecos
FROM decisiones d
LEFT JOIN contextos_decisor cx ON cx.id = d.contexto_id
LEFT JOIN propuestas p ON p.decision_id = d.id AND p.es_original
LEFT JOIN lotes l ON l.propuesta_id = p.id
LEFT JOIN cierres_lote c ON c.lote_id = l.id
LEFT JOIN v_ordenes oe ON oe.propuesta_id = p.id AND oe.tramo = 'entrada'
LEFT JOIN v_cierres vc ON vc.lote_id = l.id
LEFT JOIN resultados_hipoteticos h ON h.decision_id = d.id;
