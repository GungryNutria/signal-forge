-- Spec 003 (REQ-14 a REQ-16): descompone todo cierre en movimiento hasta el nivel, deslizamiento y comisión
-- usando solo datos inmutables, así que da lo mismo para los cierres anteriores que para los nuevos (REQ-15).
-- Con q = cantidad_llenada, qn = cantidad_neta, P = precio_entrada, S = nivel tocado y F = precio_salida:
--   movimiento_usd   = qn x (S - P)         deslizamiento_usd = qn x (F - S)   (negativo = se llenó peor que el nivel)
--   comision_usd     = pnl_neto_usd - movimiento_usd - deslizamiento_usd  (residuo: los tres suman exacto el PnL neto)
-- precio_disparo y su hora los guarda el vigilante en la orden de salida; son NULL en los cierres anteriores.
CREATE VIEW v_cierres AS
SELECT x.*, x.pnl_neto_usd - x.movimiento_usd - x.deslizamiento_usd AS comision_usd
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
) x;
--> statement-breakpoint
-- v_dataset: las columnas actuales intactas y en su orden; las nuevas, solo al final (lo exige CREATE OR REPLACE).
-- reglas_aplicadas y r11 se derivan del jsonb `reglas` de la propuesta (D-4): sin R11 en el arreglo es una propuesta
-- anterior ('R1-R10', r11 = 'no_evaluada'); NULL si la propuesta no llegó al riesgo (reglas NULL) o no hay propuesta.
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
  vc.nivel AS nivel_cierre, vc.precio_disparo, vc.deslizamiento_usd, vc.deslizamiento_pct, vc.comision_usd
FROM evaluaciones ev
JOIN ejecuciones ej ON ej.id = ev.ejecucion_id
LEFT JOIN propuestas p ON p.evaluacion_id = ev.id AND p.es_original
LEFT JOIN lotes l ON l.propuesta_id = p.id
LEFT JOIN cierres_lote c ON c.lote_id = l.id
LEFT JOIN v_ordenes oe ON oe.propuesta_id = p.id AND oe.tramo = 'entrada'
LEFT JOIN v_cierres vc ON vc.lote_id = l.id;
