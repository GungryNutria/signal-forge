"use client";

// <select> nativo (decisión D2): al cambiar, envía su formulario GET. Sin JS queda el botón "Aplicar".
export function SelectEnvio({
  id,
  nombre,
  actual,
  opciones,
}: {
  id: string;
  nombre: string;
  actual: string;
  opciones: { valor: string; texto: string }[];
}) {
  return (
    <select
      id={id}
      name={nombre}
      defaultValue={actual}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      className="min-h-11 w-full rounded-sm border border-strong bg-surface px-3 text-sm text-ink md:min-h-8 md:w-auto md:text-[13px]"
    >
      {opciones.map((o) => (
        <option key={o.valor} value={o.valor}>
          {o.texto}
        </option>
      ))}
    </select>
  );
}
