-- Spec 004, parte 1: solo inserción (RNF-6, REQ-29) para las tablas del decisor, con el mismo trigger de 0001.
-- Las tablas de la parte 2 (muestras, resultados hipotéticos, ranuras) y las vistas llegan en T-3.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contextos_decisor', 'decisiones'] LOOP
    EXECUTE format(
      'CREATE TRIGGER sf_solo_insercion_fila BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION sf_prohibir_cambios()', t);
    EXECUTE format(
      'CREATE TRIGGER sf_solo_insercion_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION sf_prohibir_cambios()', t);
  END LOOP;
END;
$$;
