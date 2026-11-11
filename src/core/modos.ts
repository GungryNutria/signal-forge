export const MODOS = ["ejecuta", "solo_registra", "apagado"] as const;
export type Modo = (typeof MODOS)[number];
export type MotivoModo = "dos_proponentes_en_ejecuta" | "r11_no_vigente";
export type ModoProponente = { configurado: Modo; efectivo: Modo; motivo: MotivoModo | null };
export type Modos = { ciclo: ModoProponente; decisor: ModoProponente };

/**
 * Modo efectivo de cada proponente (REQ-16, REQ-17). Pura. Reglas en orden:
 * 1. Los dos configurados en `ejecuta`: ninguno ejecuta, aunque R11 no estuviera en vigor (se mira la configuración).
 * 2. Decisor en `ejecuta` sin R11 en vigor: opera en `solo_registra`.
 * 3. Si no, el efectivo es el configurado.
 */
export function resolverModos(c: { ciclo: Modo; decisor: Modo }, r11Vigente: boolean): Modos {
  const igual = (m: Modo): ModoProponente => ({ configurado: m, efectivo: m, motivo: null });
  if (c.ciclo === "ejecuta" && c.decisor === "ejecuta") {
    const degradado = (m: Modo): ModoProponente => ({ configurado: m, efectivo: "solo_registra", motivo: "dos_proponentes_en_ejecuta" });
    return { ciclo: degradado(c.ciclo), decisor: degradado(c.decisor) };
  }
  if (c.decisor === "ejecuta" && !r11Vigente) {
    return { ciclo: igual(c.ciclo), decisor: { configurado: c.decisor, efectivo: "solo_registra", motivo: "r11_no_vigente" } };
  }
  return { ciclo: igual(c.ciclo), decisor: igual(c.decisor) };
}
