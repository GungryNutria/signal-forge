import { obtenerDb } from "@/server/db/cliente";
import { AlpacaBroker } from "@/server/broker/alpaca";
import { AlpacaDatos } from "@/server/broker/datos";
import type { Broker } from "@/server/broker/tipos";
import { cargarEnv } from "@/server/env";
import { URL_PAPER } from "@/server/propuestas/procesar";
import type { DependenciasDecisor } from "./recibir";

/** Broker de relleno cuando la URL no es la de paper: `procesarPropuesta` ya rechaza antes de usarlo (REQ-15 de 001). */
const brokerProhibido: Broker = {
  enviarOrden: () => Promise.reject(new Error("broker no disponible: APCA_API_BASE_URL no es la de paper")),
  consultarOrden: () => Promise.reject(new Error("broker no disponible: APCA_API_BASE_URL no es la de paper")),
  cantidadDisponible: () => Promise.reject(new Error("broker no disponible: APCA_API_BASE_URL no es la de paper")),
};

/**
 * Dependencias de las rutas del decisor tomadas del entorno. `DECISOR_TOKEN_SHA256` se lee aquí y no en `esquemaEnv` (D-4):
 * ausente o inválido, ningún token es del decisor y todo da 401.
 */
export function dependenciasDelEntorno(): DependenciasDecisor {
  const env = cargarEnv();
  const llaves = { keyId: env.APCA_API_KEY_ID, secretKey: env.APCA_API_SECRET_KEY };
  return {
    db: obtenerDb(),
    hashes: { investigador: env.INVESTIGADOR_TOKEN_SHA256, decisor: process.env.DECISOR_TOKEN_SHA256 },
    ahora: () => new Date(),
    datos: new AlpacaDatos(llaves),
    broker: env.APCA_API_BASE_URL === URL_PAPER ? new AlpacaBroker({ ...llaves, baseUrl: env.APCA_API_BASE_URL }) : brokerProhibido,
    env,
  };
}
