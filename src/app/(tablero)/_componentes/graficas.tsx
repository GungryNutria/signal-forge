"use client";

import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Gráficas de S4 (AC-UX-16 a 18). Reciben los datos ya agregados y con su texto listo: aquí solo se dibujan. Son
// navegables con el teclado (la capa de accesibilidad de Recharts mueve el foco entre puntos con las flechas) y su
// consulta se abre con puntero, toque y foco. Colores: `pos`/`neg` solo para dinero; la curva va en `text`.
const MUTED = "var(--color-muted)";
const LINE = "var(--color-line)";
const EJE = { fill: MUTED, fontSize: 12 };

// `eje`: rótulo corto del eje; `titulo` y `detalle`: lo que dice la consulta de cada punto o barra.
export type PuntoCurva = { eje: string; titulo: string; saldo: number; detalle: string };
export type BarraDia = { eje: string; titulo: string; pnl: number; texto: string; detalle: string };

type PropsTooltip = { active?: boolean; payload?: { payload: { titulo: string; detalle: string } }[] };

function Consulta({ active, payload }: PropsTooltip) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div role="status" className="rounded-sm border border-strong bg-sunken px-3 py-2 text-xs leading-[1.35] text-ink">
      <p className="font-semibold">{p.titulo}</p>
      <p>{p.detalle}</p>
    </div>
  );
}

const miles = (n: number) => new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(n);
const conSigno = (n: number) => (n > 0 ? `+${miles(n)}` : n < 0 ? `−${miles(Math.abs(n))}` : "0");

function Marco({ nombre, children }: { nombre: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={nombre} className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 260 }}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}

export function CurvaSaldo({ puntos, nombre }: { puntos: PuntoCurva[]; nombre: string }) {
  return (
    <Marco nombre={nombre}>
      <LineChart data={puntos} margin={{ top: 12, right: 16, bottom: 4, left: 0 }} accessibilityLayer>
        <CartesianGrid stroke={LINE} vertical={false} />
        <XAxis dataKey="eje" tick={EJE} stroke={LINE} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
        <YAxis tick={EJE} stroke={LINE} tickLine={false} width={64} domain={["auto", "auto"]} tickFormatter={miles} />
        <Tooltip content={<Consulta />} cursor={{ stroke: "var(--color-strong)" }} isAnimationActive={false} />
        <Line
          type="linear"
          dataKey="saldo"
          stroke="var(--color-ink)"
          strokeWidth={2}
          dot={{ r: 3.5, fill: "var(--color-bg)", stroke: "var(--color-ink)", strokeWidth: 2 }}
          activeDot={{ r: 6, fill: "var(--color-bg)", stroke: "var(--color-accent)", strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </LineChart>
    </Marco>
  );
}

type PropsEtiqueta = { x?: number | string; y?: number | string; width?: number | string; height?: number | string; index?: number };

export function PnlDiario({ barras, nombre }: { barras: BarraDia[]; nombre: string }) {
  // Etiqueta con signo sobre cada barra (debajo si es negativa); el cero va sin signo y en `muted`.
  const etiqueta = ({ x = 0, y = 0, width = 0, height = 0, index = 0 }: PropsEtiqueta) => {
    const b = barras[index];
    if (!b) return null;
    const [px, py, ancho, alto] = [Number(x), Number(y), Number(width), Number(height)];
    const arriba = Math.min(py, py + alto);
    const abajo = Math.max(py, py + alto);
    const color = b.pnl > 0 ? "var(--color-pos)" : b.pnl < 0 ? "var(--color-neg)" : MUTED;
    return (
      <text x={px + ancho / 2} y={b.pnl < 0 ? abajo + 14 : arriba - 6} textAnchor="middle" fontSize={12} fontWeight={600} fill={color}>
        {b.texto}
      </text>
    );
  };
  return (
    <Marco nombre={nombre}>
      <BarChart data={barras} margin={{ top: 24, right: 8, bottom: 20, left: 0 }} accessibilityLayer>
        <CartesianGrid stroke={LINE} vertical={false} />
        <XAxis dataKey="eje" tick={EJE} stroke={LINE} tickLine={false} />
        <YAxis tick={EJE} stroke={LINE} tickLine={false} width={56} tickFormatter={conSigno} />
        <ReferenceLine y={0} stroke="var(--color-strong)" />
        <Tooltip content={<Consulta />} cursor={{ fill: "var(--color-sunken)" }} isAnimationActive={false} />
        <Bar dataKey="pnl" maxBarSize={44} isAnimationActive={false} label={etiqueta}>
          {barras.map((b) => (
            <Cell key={b.titulo} fill={b.pnl >= 0 ? "var(--color-pos)" : "var(--color-neg)"} />
          ))}
        </Bar>
      </BarChart>
    </Marco>
  );
}
