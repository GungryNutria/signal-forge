import { beforeAll } from "vitest";
import { reiniciarBase } from "./arnes";

// Se ejecuta antes de cada archivo de test: base limpia y migrada.
beforeAll(reiniciarBase);
