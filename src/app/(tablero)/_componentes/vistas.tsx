import Link from "next/link";

/**
 * Las dos vistas de S4 (Cartera · Decisor frente a regla) y de S5 (Ciclo · Decisor): pestañas de texto con la activa en
 * 600 y subrayada 3 px `accent`. Son enlaces, así que la vista queda en la dirección (AC-UX-10, AC-UX-15).
 */
export function Vistas({ nombre, base, actual, opciones }: { nombre: string; base: string; actual: string; opciones: { valor: string; texto: string }[] }) {
  return (
    <nav aria-label={nombre} className="border-b border-line">
      <ul className="flex gap-6">
        {opciones.map((o) => {
          const on = o.valor === actual;
          return (
            <li key={o.valor} className="flex">
              <Link
                href={o.valor === opciones[0].valor ? base : `${base}?vista=${o.valor}`}
                aria-current={on ? "page" : undefined}
                className={`-mb-px inline-flex min-h-11 items-center border-b-[3px] text-[15px] ${
                  on ? "border-accent font-semibold text-ink" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {o.texto}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
