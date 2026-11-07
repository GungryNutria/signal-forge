import Link from "next/link";
import { Tarjeta } from "./_componentes/tarjeta";

// Una propuesta o una evaluación que no existe (o un id mal escrito).
export default function NoEncontrada() {
  return (
    <Tarjeta>
      <h1 className="mb-2 text-xl leading-[1.3] font-semibold">No se encontró esta página</h1>
      <p className="text-sm text-muted">La propuesta o la evaluación que buscas no existe, o la dirección está mal escrita.</p>
      <Link href="/" className="mt-3 inline-flex min-h-11 items-center font-semibold text-accent underline underline-offset-2">
        Volver al Resumen
      </Link>
    </Tarjeta>
  );
}
