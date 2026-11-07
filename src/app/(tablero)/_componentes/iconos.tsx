import type { ReactNode } from "react";

// Iconos en línea (el proyecto no tiene librería de iconos). Siempre decorativos: el texto va al lado.
function Base({ children, tamano = 12 }: { children: ReactNode; tamano?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={tamano}
      height={tamano}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

export const IconoPunto = () => (
  <Base>
    <circle cx="8" cy="8" r="4" fill="currentColor" stroke="none" />
  </Base>
);
export const IconoCirculo = () => (
  <Base>
    <circle cx="8" cy="8" r="5.5" />
  </Base>
);
export const IconoCheck = () => (
  <Base>
    <circle cx="8" cy="8" r="6" fill="currentColor" stroke="none" />
    <path d="M5.2 8.2l2 2 3.6-4" stroke="var(--color-surface)" />
  </Base>
);
export const IconoTriangulo = () => (
  <Base>
    <path d="M8 2.2l6.2 11H1.8L8 2.2z" />
    <path d="M8 6.6v3.2M8 11.8v.1" />
  </Base>
);
export const IconoExclamacion = () => (
  <Base>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M8 4.8v3.8M8 11v.1" />
  </Base>
);
export const IconoEnlaceExterno = () => (
  <Base>
    <path d="M9.5 2.5h4v4M13.5 2.5L7.5 8.5M12 9v3.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1H7" />
  </Base>
);
export const IconoChevron = () => (
  <Base tamano={16}>
    <path d="M6 3.5L10.5 8 6 12.5" />
  </Base>
);

const nav = (hijos: ReactNode) => <Base tamano={24}>{hijos}</Base>;
export const IconoResumen = () =>
  nav(
    <>
      <rect x="2.5" y="2.5" width="4.6" height="4.6" rx="1" />
      <rect x="8.9" y="2.5" width="4.6" height="4.6" rx="1" />
      <rect x="2.5" y="8.9" width="4.6" height="4.6" rx="1" />
      <rect x="8.9" y="8.9" width="4.6" height="4.6" rx="1" />
    </>,
  );
export const IconoPropuestas = () =>
  nav(
    <>
      <path d="M5.5 4h8M5.5 8h8M5.5 12h8" />
      <path d="M2.5 4h.1M2.5 8h.1M2.5 12h.1" />
    </>,
  );
export const IconoMetricas = () =>
  nav(
    <>
      <path d="M3 13.5h10.5" />
      <rect x="3.8" y="7.5" width="2.2" height="6" />
      <rect x="7" y="3.5" width="2.2" height="10" />
      <rect x="10.2" y="9" width="2.2" height="4.5" />
    </>,
  );
export const IconoEjecuciones = () =>
  nav(
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.6V8l2.4 1.6" />
    </>,
  );
export const IconoPrecio = () =>
  nav(
    <>
      <path d="M2.5 2.5v11h11" />
      <path d="M4.8 10.2l2.6-3.2 2.2 1.8 3.2-4" />
    </>,
  );
/** Línea de precio de 18 px, para el enlace "Ver en la gráfica" de S3. */
export const IconoGrafica = () => (
  <Base tamano={18}>
    <path d="M2.5 2.5v11h11" />
    <path d="M4.8 10.2l2.6-3.2 2.2 1.8 3.2-4" />
  </Base>
);
