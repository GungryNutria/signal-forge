import { connection } from "next/server";
import { cache } from "react";
import { resumenCartera } from "@/server/consultas/cartera";
import { estadoSistema } from "@/server/consultas/estado";
import { ultimasInvestigaciones } from "@/server/consultas/investigaciones";
import { listarPropuestas } from "@/server/consultas/propuestas";

// Con `cacheComponents`, leer la hora o la base exige esperar a la petición (`connection`). Cada consulta se
// memoriza por petición (`cache`) para que dos bloques con la misma fuente no la lean dos veces y vean la misma hora.
// Una consulta que falla guarda su rechazo: los bloques que comparten fuente fallan juntos, los demás no.

const conHora = <T>(consulta: (ahora: Date) => Promise<T>) =>
  cache(async () => {
    await connection();
    const ahora = new Date();
    return { ahora, datos: await consulta(ahora) };
  });

export const estado = conHora(estadoSistema);
export const cartera = conHora(resumenCartera);
export const investigaciones = conHora(ultimasInvestigaciones);
// `limite: 5` del plan: la consulta pagina de 50 en 50 (tipo `limite?: 50`), así que S1 toma las 5 primeras.
export const ultimasPropuestas = conHora(async () => (await listarPropuestas()).filas.slice(0, 5));
