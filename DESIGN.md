---
name: SignalForge
description: Tablero de solo lectura del paper trading de SignalForge (modo Operate)
type: design
tags: [signalforge, ux, design-system]
project: signalforge
status: active
updated: 2026-11-12
owner: ux-lead
colors:
  bg: "#161513"
  surface: "#1F1E1B"
  sunken: "#2A2925"
  border: "#3A3833"
  border-strong: "#8A867C"
  text: "#ECE9E2"
  text-muted: "#ADA99F"
  accent: "#8DADF5"
  pos: "#6DC093"
  pos-bg: "#1A2B21"
  neg: "#F2877B"
  neg-bg: "#361C1A"
  warn: "#E2A65A"
  warn-bg: "#33261A"
  info: "#A9B4F2"
  info-bg: "#212539"
typography:
  kpi-lg:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.15
  kpi:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.3
  caption:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  mono:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: "4px"
  md: "8px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
  "8": "32px"
components:
  chip:
    rounded: "{rounded.sm}"
    padding: "2px 8px"
    height: "24px"
    typography: "{typography.label}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "16px"
  alert-neg:
    backgroundColor: "{colors.neg-bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  alert-warn:
    backgroundColor: "{colors.warn-bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  table-row:
    height: "40px"
    typography: "{typography.body-sm}"
  tab-bar-mobile:
    backgroundColor: "{colors.surface}"
    height: "56px"
---

# Design System: SignalForge

> Dirección del `ux-lead` para la [[workspaces/signalforge/specs/001-paper-trading-con-agente-programado/spec|spec 001]]. Contexto de producto: [[workspaces/signalforge/PRODUCT|PRODUCT.md]]. Es **propuesta de dirección** hasta la Puerta de diseño (Edgardo); lo que se descubra en FigCraft se corrige aquí, no en silencio.
> Ampliado el 2026-11-10 con el vocabulario de la [[workspaces/signalforge/specs/003-limite-de-entradas-abiertas-por-activo/spec|spec 003]] (R11, T-5) y de la [[workspaces/signalforge/specs/004-decisor-agente-programado/spec|spec 004]] (decisor, T-6): ver [[#Vocabulario fijo de las specs 003 y 004]]. El layout de la banda con el grupo Decisor y de S4 "Decisor frente a regla" lo fija T-7 de la 004 en FigCraft: aquí van solo textos, severidades y reglas.

## Overview

**Modo Operate.** Un tablero de consulta, no una terminal de trading. Mundo visual: **bitácora de laboratorio de noche**: carbón cálido (no negro puro), tinta clara color papel, cifras tabulares alineadas, bordes finos y casi sin decoración. Se aleja a propósito del cliché "fondo negro con verde neón": aquí nada invita a operar; todo invita a leer y verificar.

Jerarquía fija en todas las superficies: **1) salud del sistema** (banda) → **2) dinero** (saldo y PnL) → **3) detalle** (posiciones, propuestas) → **4) investigación** (informativa, al final o a un lado, con su rótulo). En S3 y en el detalle de una decisión del decisor, la investigación no va suelta: va dentro de "Contexto que vio el decisor", el último bloque.

Tema: **solo oscuro** en la etapa 1 (cambio de dirección de Edgardo, 2026-11-06: "pásalos a darkmode"; sustituye al tema claro). Mismos nombres semánticos, así que un tema claro sería un segundo modo después, sin rediseño. Valores del claro archivados al final de este archivo. Profundidad por luminosidad: `bg` < `surface` < `sunken` (el hundido es el más claro de los tres, solo para cabeceras de tabla y esqueletos).

## Colors

Todos los pares de texto cumplen 4.5:1 sobre `bg`, `surface` y `sunken` (calculado con script WCAG 2.2, 2026-11-06: `text` 12.0–15.1, `text-muted` 6.2–7.8, `accent` 6.5–8.2, `pos` 6.7–8.4, `neg` 5.9–7.4, `warn` 6.8–8.6, `info` 7.3–9.1; cada color semántico sobre su tinte `-bg` 6.4–7.6; `text` sobre los tintes 12.1–13.0 y `text-muted` 6.3–6.7; `accent` sobre los tintes 6.6–7.1). `border-strong` da 4.0–5.0 sobre los neutros y 4.0–4.3 sobre los tintes (apto para bordes de estado y foco). Relleno `accent` con texto `bg` (filtro activo): 8.2. Relleno `text` con texto `bg` (chip Ejecutada): 15.1. `border` (1.2–1.6) es solo decorativo: nunca porta significado. Sin verdes ni azules saturados tipo neón: los semánticos son tonos apagados de tinta.

- **Neutros:** `bg` página, `surface` tarjetas, `sunken` esqueletos de carga y fondos de tabla de cabecera, `border` divisores decorativos (no portan significado), `border-strong` bordes que sí lo portan.
- **`accent`** azul tinta: **solo** enlaces, navegación activa y anillo de foco. Nunca para estado ni dinero.
- **`pos` / `neg`:** **solo dinero real** (PnL, drawdown) y los cierres "Cerrada por take profit" / "Cerrada por stop loss". `neg` además es la severidad de alerta. Lo hipotético (resultados "Habría cerrado por…", PnL hipotético) y el PnL a nivel van con signo pero en `text`, nunca en `pos`/`neg` (AC-UX-14 de 004); el deslizamiento también va en `text` (AC-UX-9 de 003).
- **`warn`:** anomalías que requieren atención pero no son pérdida (Conflicto, Datos no disponibles, Rechazada por el broker, Estado desconocido, valores desactualizados, Pausa manual; de la spec 004: ranuras Parcial, Inválida y Sin llegar, y el decisor degradado a Solo registra).
- **`info`:** únicamente la identidad del bloque Investigación y "Abierta".

### Named Rules

- **Signo antes que color.** Todo importe o porcentaje con signo explícito: `+` y el signo menos tipográfico `−` (U+2212). El cero va sin signo y en `text`. Ejemplos: `+128.40 USD`, `−312.40 USD (−3.12 %)`.
- **Tinte nunca solo.** Los tintes `-bg` contrastan 1.06–1.14 con `surface` en oscuro: toda caja tintada lleva además un borde izquierdo de 3 px del color semántico, icono y texto.
- **Neutral es normal.** "Sin señal", "Omitida por solapamiento", "Pendiente", "No aplica" y "Rechazada" (por riesgo: el sistema funcionó, también con su regla: "Rechazada (R11 entradas abiertas)") van en neutro, nunca en `neg` ni `warn`. Igual: "No evaluada", un activo en su tope de R11, "No comprar", "Comprar (solo registro)", "Señal (solo registro)", la ranura Completa o Apagado, todo resultado hipotético y "Sin precio de entrada".
- **La severidad sigue al modo.** Una alerta de un proponente que **Ejecuta** es `neg`; la misma alerta con el proponente en **Solo registra** es `warn`; con el proponente **Apagado** no hay alerta (AC-UX-3 de 004).

## Typography

**IBM Plex Sans** (texto y cifras, siempre con `font-variant-numeric: tabular-nums` en números) e **IBM Plex Mono** solo para identificadores (id de ejecución, versión de regla y de instrucciones, id de orden). Ambas en Google Fonts. Si FigCraft no las tiene: usar la sans disponible más cercana con cifras tabulares y anotarlo en la entrega (TODO: Verify en FigCraft).

### Hierarchy

- `kpi-lg` 32/600: saldo virtual en escritorio. En móvil (KPI en 2×2, hasta 360 px) todos los KPI van a 20/600 con el sufijo "USD" a 13 px, para que quepa "10,184.20 USD" sin cortar (ajuste aceptado en la revisión de T-11, 2026-11-06).
- `kpi` 24/600: valor de cartera, PnL del día y acumulado; métricas de S4.
- `title` 20/600: título de bloque ("Posiciones abiertas", "Investigación").
- `body` 16: texto corrido y resumen de investigación.
- `body-sm` 14: tablas, listas y la banda de estado.
- `label` 13/600: chips, cabeceras de tabla y etiquetas de campo.
- `caption` 12: horas secundarias, zona, "hace N min". **Mínimo absoluto 12 px.**

### Formatos (AC-UX-22, AC-UX-23)

- Importes: `10,000.00 USD` (es-MX, 2 decimales, sufijo USD).
- Porcentajes: espacio fino antes de `%`. PnL, drawdown y límites con 2 decimales (`−3.00 %`); tasa de aciertos con 1 (`57.1 %`).
- Cripto: hasta 8 decimales sin ceros sobrantes, nunca redondeada a 0 (`0.00012345 BTC`).
- Hora: `14:42 (UTC−6)`; relativa en `caption`: `hace 12 min`. En detalle, además `20:42 UTC`. Día: `6 nov`; agrupaciones: "día UTC".
- Escalas: `+0.42 en escala −1 a 1`, `0.80 en escala 0 a 1`.

## Layout

- **Escritorio 1280×800:** contenido máx. 1216 px, márgenes 32 px, rejilla de 12 columnas con canal de 24 px. Cabecera de 56 px (marca, navegación, insignia "Paper") seguida de la **banda de estado**, ambas fijas arriba.
- **Móvil 390×844 (mín. 360):** márgenes 16 px, una columna, banda arriba (no fija tras el primer scroll; la cabecera sí), **barra de pestañas inferior** de 56 px con 4 destinos: Resumen, Propuestas, Métricas, Ejecuciones. S3 y la evaluación de S5 son páginas de detalle con "← Volver" arriba.
- **Densidad:** alta en escritorio (filas de 40 px, separación entre bloques 24 px); en móvil, filas de lista de 56 px mín. y todos los objetivos táctiles de 44×44 px.
- **Tablas → listas** por debajo de 768 px: cada fila es una tarjeta de 2–3 líneas con lo mismo que la tabla (AC-UX-19).
- **S1 escritorio:** banda → fila de 4 KPI (saldo virtual, valor de cartera, PnL del día, PnL acumulado) → dos columnas: 7/12 Posiciones abiertas + Últimas 5 propuestas; 5/12 Investigación. **S1 móvil:** banda → KPI en 2×2 → Posiciones → Investigación → Últimas propuestas.

## Elevation & Depth

Plano. Sin sombras: separación por `surface` sobre `bg` y bordes de 1 px `border`. La cabecera fija usa solo un borde inferior.

## Shapes

`rounded.md` 8 px en tarjetas y bloques; `rounded.sm` 4 px en chips, alertas y campos. Sin pastillas redondas completas. Foco: anillo de 2 px `accent` con separación de 2 px, en todo lo interactivo.

## Components

### Banda de estado (componente insignia)

Una franja `surface` de ancho completo con 4 grupos en línea (escritorio) o apilados en 2 filas compactas (móvil), y debajo las alertas. Con la spec 004 se agrega un quinto grupo (Decisor) y el grupo 1 nombra a los proponentes; su acomodo, sobre todo a 390×844 sin scroll, lo define T-7 de la 004 (O-UX-8):

1. **Modo de trading:** chip con icono. Operando (punto `pos` + texto), Pausa manual (`warn`), Pausa automática por pérdida diaria (`neg`). Junto al chip, en neutro, quién ejecuta y el modo del otro: "Ejecuta: Decisor · Ciclo: Solo registra"; si ninguno ejecuta, "Ejecuta: ninguno" seguido de los dos modos efectivos ("Ejecuta: ninguno · Ciclo: Solo registra · Decisor: Solo registra", p. ej. con el decisor degradado por R11); con la configuración inválida, solo "Ejecuta: ninguno" y la alerta (spec 004, T-8).
2. **Última ejecución:** `14:30 (UTC−6) · hace 12 min` y resultado por activo: `BTC/USD Sin señal · SOL/USD Propuesta: Ejecutada`. Todo el grupo es un enlace a S5 (AC-UX-28).
3. **Investigación:** por activo, `BTC/USD 14:15 · Vigente` / `SOL/USD 13:15 · Vencida`.
4. **Datos de las** `14:42:05 (UTC−6)`.
5. **Decisor** (spec 004): última ranura con hora absoluta y relativa, estado y resultado por activo: `12:45 a 13:45 (UTC−6) · terminó hace 57 min · Completa · BTC/USD No comprar · SOL/USD Comprar: Ejecutada`. Todo el grupo es un enlace a S5 en la vista Decisor. Sin decisor: "Decisor: Apagado". Activado sin ranuras: "Decisor: Ejecuta · sin ranuras todavía. Corre cada hora en el minuto 45; la próxima ranura empieza a las HH:45 (UTC−6)".

**Alertas** (debajo, una por fila, `alert-neg` o `alert-warn` con borde izquierdo de 3 px, icono y texto; solo las que apliquen):

- Ciclo detenido (`neg` si el ciclo Ejecuta, `warn` si Solo registra, sin alerta si está Apagado): "El ciclo no corre desde 13:30 (UTC−6) · hace 52 min".
- Decisor sin decisión válida de un activo por más de 2 h (`neg` si el decisor Ejecuta, `warn` si Solo registra, sin alerta si está Apagado; una por activo): "SOL/USD: sin decisión válida del decisor desde HH:MM (UTC−6) · hace 2 h 1 min"; sin ninguna desde la activación: "… desde su activación (DD nov HH:MM)".
- Configuración inválida (`neg`): "Configuración inválida: el ciclo y el decisor están en Ejecuta. No se ejecuta ninguna propuesta hasta corregir la configuración del despliegue".
- Decisor degradado (`warn`): "El decisor está configurado en Ejecuta, pero opera en Solo registra porque R11 no está en vigor".
- Investigación sin llegar (`warn`): "SOL/USD: sin investigación aceptada desde 12:15 (UTC−6)".
- Broker sin respuesta (`neg`): "El broker no responde desde 14:02 (UTC−6). Los valores que dependen de él no están actualizados".
- Estado desconocido (`warn`): "BTC/USD: nuevas propuestas bloqueadas hasta reconciliar la orden" + enlace "Ver orden".
- Pausa manual (texto de explicación del chip, `warn`): "El ciclo sigue corriendo y registrándose, pero sus propuestas se rechazan. Se levanta en la configuración del despliegue".
- Pausa automática (`neg`): "PnL del día −312.40 USD (−3.12 %) / límite −300.00 USD (−3.00 %). Se levanta sola a las 18:00 (UTC−6), 00:00 UTC. El stop loss y el take profit siguen activos".

Sin botones de cierre ni de acción en ninguna alerta.

### Chips de estado

Texto siempre visible; color e icono solo refuerzan. Estilo: borde 1 px + texto del color; los de severidad `neg`/`warn` además con tinte.

| Grupo | Neutro | `info` | `pos` | `neg` | `warn` |
|---|---|---|---|---|---|
| Decisión | Ejecutada (relleno `text`, texto `bg`), Rechazada | | | Error | Conflicto |
| Estado de operación | Pendiente de llenado | Abierta | Cerrada por take profit | Cerrada por stop loss | Estado desconocido, Rechazada por el broker |
| Resultado de ejecución | Sin señal, Propuesta, Omitida por solapamiento | | | Error | Datos no disponibles |
| Investigación | Sin investigación | Vigente | | | Vencida |
| Etiqueta | Pendiente, No aplica | | Éxito (1) | Sin éxito (0) | |
| Regla de riesgo (003) | Cumple, Incumple, No aplica, No evaluada | | | | |
| Decisión del decisor (004) | Comprar, No comprar | | | | |
| Resultado de ranura por activo (004) | Comprar: {decisión}, Comprar (solo registro), No comprar, Sin decisión | | | | Inválida ({motivo}) |
| Estado de ranura (004) | Completa, Apagado, en curso | | | | Parcial, Inválida, Sin llegar |
| Resultado del ciclo (004) | Señal (solo registro) | | | | |
| Resultado hipotético (004) | Habría cerrado por take profit, Habría cerrado por stop loss, Pendiente (hipotético), Sin precio de entrada | | | | |
| Proponente y modo (004) | Ciclo, Decisor; Ejecuta, Solo registra, Apagado | | | | |

"Incumple" va en neutro: es el motivo de un rechazo por riesgo, no una falla. "Comprar: {decisión}" toma el estilo de la decisión de la propuesta (Ejecutada con relleno `text`, Rechazada neutra, Error `neg`). "Inválida ({motivo})" es `warn` como texto en S5 y en la banda, pero no genera alerta: la alerta es la de 2 h sin decisión válida.

### Tarjeta KPI

Etiqueta (`label`, `text-muted`) → valor (`kpi`/`kpi-lg`, con signo y color si es dinero de PnL) → línea de contexto (`caption`: "día UTC", "desde el inicio", "sobre saldo realizado"). Si depende del broker y no hay respuesta: valor "No disponible" en `text-muted` + chip `warn` "Última lectura 14:02 (UTC−6), desactualizada".

### Bloque Investigación

Tarjeta con **borde discontinuo** de 1 px `border-strong` (la única superficie discontinua del sistema: significa "dato adjunto, no decisión") y cabecera `info`: "Investigación" + rótulo según dónde aparece (AC-UX-9 de 004; sustituye al rótulo único de 001):

| Dónde | Rótulo |
|---|---|
| S3 y evaluaciones del ciclo | "Informativa: no interviene en la decisión de entrada" |
| S1, con el decisor Apagado | "Informativa: no interviene en la decisión de entrada" |
| S1, con el decisor en Ejecuta o Solo registra | "La lee el decisor al decidir. La regla fija no la usa" |
| Dentro de "Contexto que vio el decisor" (S3 y detalle de decisión) | "Leída por el decisor: forma parte del contexto con el que decidió" |

Ningún texto dice que una entrada se hizo "por" la investigación. Contenido del bloque: Por activo: hora y antigüedad, chip Vigente/Vencida con su texto completo ("Vigente: se adjunta a las evaluaciones" / "Vencida: las evaluaciones van sin investigación"), sentimiento con signo y escala, noticia fuerte Sí/No, confianza con escala, **resumen completo** en `body` como texto literal, fuentes como lista: **dominio** en `label` + título + icono de enlace externo.

### Estados de bloque

- **Carga:** esqueleto `sunken` con la forma del contenido (barras de la altura de cada línea); nunca "0", "USD 0.00" ni "0 %".
- **Vacío:** texto `body-sm` `text-muted` dentro del bloque con el mensaje exacto de la spec; el saldo inicial sí se muestra como dato real.
- **Error:** dentro del bloque, icono + "No se pudo cargar {nombre del bloque}. Estos datos no se muestran; recarga la página para intentar de nuevo." Sin botón.

### Navegación

Escritorio: pestañas de texto en la cabecera; la activa con subrayado de 2 px `accent` y `text`. Móvil: barra inferior con icono + texto en las 4 pestañas.

### Tablas y listas

Cabecera `label` sobre `sunken`; cifras alineadas a la derecha; fila entera clicable hacia el detalle, con foco visible en la fila.

## Vocabulario fijo de las specs 003 y 004

Texto exacto, palabra por palabra; `_lib/formato.ts` lo replica. Fuente: los apartados "Vocabulario que se agrega" y los AC-UX de cada spec.

### Spec 003: R11 (T-5, O-UX-4)

- **Nombre de la regla:** "R11 entradas abiertas por activo" (S3, S4). **Nombre corto** (banda y S5): "R11 entradas abiertas". Igual para cualquier proponente (AC-UX-7 de 003).
- **Resultado de una regla de riesgo:** Cumple · Incumple · No aplica · **No evaluada**. "No evaluada": la propuesta se evaluó con un conjunto de reglas que no incluía esa regla. Neutro, con texto propio y distinguible en escala de grises (AC-UX-3 de 003).
- **Valor y límite:** en S2, "R11 entradas abiertas de BTC/USD: 2 > límite 1". En S3, el desglose "1 abierta + esta propuesta = 2 · límite 1". En una propuesta anterior a R11: "No evaluada" con "Esta propuesta se evaluó con R1 a R10".
- **Título de la tabla en S3:** "Reglas de riesgo" (ya no "Reglas de riesgo R1 a R10"), con "Conjunto aplicado: R1 a R11" o "Conjunto aplicado: R1 a R10" (AC-UX-2 de 003).
- **Rechazo con su regla principal** (banda y S5, todas las reglas): patrón "Rechazada (<nombre corto de la regla>)", p. ej. "Rechazada (R11 entradas abiertas)" y "Rechazada (R8 pausa manual)". La regla principal es la incumplida de número menor.
- **Nombres de las reglas de riesgo en el tablero** (fuente única; decidido por el `ux-lead` en T-7 de 003, 2026-11-10). Valen los que ya entregó el código (`NOMBRE_REGLA` de `_lib/formato.ts`, en producción desde 001 y cubiertos por sus E2E), no los de la tabla de reglas de la spec 001, que queda como definición de cada regla y no como texto de pantalla:

  | Regla | Nombre (S2, S3, S4) | Nombre corto (banda y S5) | Nombre en la tabla de 001 |
  |---|---|---|---|
  | R1 | R1 activo | R1 activo | activo permitido |
  | R2 | R2 venta | R2 venta | solo largo |
  | R3 | R3 tamaño | R3 tamaño | tamaño por operación |
  | R4 | R4 exposición | R4 exposición | exposición total |
  | R5 | R5 entradas del día | R5 entradas del día | operaciones por día |
  | R6 | R6 pausa automática | R6 pausa automática | pérdida diaria |
  | R7 | R7 saldo libre | R7 saldo libre | saldo suficiente |
  | R8 | R8 pausa manual | R8 pausa manual | pausa manual |
  | R9 | R9 orden desconocida | R9 orden desconocida | estado limpio |
  | R10 | R10 tipo de orden | R10 tipo de orden | tipo de orden |
  | R11 | R11 entradas abiertas por activo | R11 entradas abiertas | (spec 003) |

  Por qué: nombran lo que la regla revisa en el momento del rechazo ("pausa automática", "saldo libre", "orden desconocida"), que es lo que Edgardo necesita leer en "Rechazada (…)"; el nombre de la tabla de 001 nombra la política. Una regla nueva o un cambio de nombre se decide aquí primero.
- **S1, Posiciones abiertas:** "SOL/USD · 1 entrada abierta · tope 2"; en el tope o por encima, "BTC/USD · 3 entradas abiertas · tope 1: las entradas nuevas se rechazan por R11". Neutro, sin alerta. Si el tope configurado no es válido: "BTC/USD · 3 entradas abiertas · tope no disponible", sin la frase de rechazo y también neutro.
- **S4:** "R11 entradas abiertas por activo" con su conteo; sin propuestas evaluadas con R11 en el periodo, "No evaluada en este periodo" (nunca 0).
- **Salida en S3:** "No registrado: el cierre es anterior a esta medición"; el deslizamiento de precio "(sin comisiones)" va con signo y en `text`.

### Spec 004: decisor (T-6, O-UX-9)

- **Proponente:** Ciclo · Decisor. En la consulta de S6: "Proponente: Ciclo" / "Proponente: Decisor".
- **Modo:** Ejecuta · Solo registra · Apagado. Banda: "Ejecuta: Decisor · Ciclo: Solo registra"; si ninguno ejecuta, "Ejecuta: ninguno · Ciclo: {modo} · Decisor: {modo}" (con la configuración inválida, solo "Ejecuta: ninguno"). Donde se nombra un modo, el texto dice que se cambia en la configuración del despliegue.
- **Decisión del decisor:** Comprar · No comprar. Confianza: "0.72 en escala 0 a 1".
- **Resultado por activo de una ranura:** "Comprar: {decisión de la propuesta}" ("Comprar: Ejecutada", "Comprar: Rechazada (R11 entradas abiertas)") · "Comprar (solo registro)" · "No comprar" · "Inválida ({motivo})" ("Inválida (Contexto vencido)") · "Sin decisión". Un `comprar` válido sin propuesta porque el activo estaba en Datos no disponibles: "Comprar: Rechazada (Datos no disponibles)"; la opción del filtro de S5 usa el mismo texto. Un envío inválido sin activo se muestra en su ranura como "Envío inválido sin activo" con su chip "Inválida (Decisión inválida)" y enlace al detalle; nunca se esconde tras "Sin decisión" (T-12).
- **Motivos del sistema para una decisión sin propuesta:** Decisión inválida · Contexto vencido · Decisor apagado · Datos no disponibles · Conflicto. En el detalle, con su dato registrado: "Contexto vencido: contexto de hace 16 min, máximo 15".
- **Estado de una ranura:** Completa · Parcial · Inválida · Sin llegar · Apagado (fuera de los porcentajes) · "en curso" (solo si ya tiene envíos). Rango: "13:45 a 14:45 (UTC−6)". Porcentaje: "92 %, 22 de 24 ranuras". Sin llegar: "La ranura terminó sin envíos del decisor. Puede ser que la tarea no corrió o que se rechazó por el límite de uso de la suscripción; el historial de la tarea programada lo dice". S5 Decisor apagado: "El decisor está apagado. Se activa en la configuración del despliegue".
- **Ciclo en Solo registra:** "Señal (solo registro)", nunca "Propuesta".
- **Bloques de S3 y del detalle de decisión:** "Decisión del decisor" (sustituye a "Regla de entrada evaluada"), "Contexto que vio el decisor" (con "contexto de hace 6 min") y el contenedor "Razonamiento del decisor (texto del agente, literal)", visualmente distinto de los campos del sistema (AC-UX-8). Dato faltante: "No disponible".
- **Resultado hipotético** (con la palabra "hipotético" junto a toda cifra hipotética, en `text`): "Habría cerrado por take profit" · "Habría cerrado por stop loss" · "Pendiente (hipotético)" · "Sin precio de entrada". Hueco de muestras dentro de un resultado: "Sin datos de precio de 14:00 a 15:30 (UTC−6)".
- **"Sin precio de entrada"** (`sin_precio_entrada`, O-2 del plan de 004): entrada evitada o señal registrada cuyo activo estaba en "Datos no disponibles" al decidir, así que no hay precio para calcular el hipotético. Detalle: "Sin precio de entrada: el activo no tenía datos de mercado al decidir, así que no se calcula un resultado hipotético". En la comparación se cuenta aparte ("Sin precio de entrada: N"), fuera de stop loss, take profit y pendientes, y fuera de la tasa de aciertos; es una opción más del filtro por resultado hipotético. Neutro. "Sin datos de precio" **no** se usa para este caso: queda solo para los huecos de muestras.
- **Comparación (S4 "Decisor frente a regla"):** "PnL a nivel (comparable)" · "PnL neto real" · "Bloqueadas por el tope (hipotético)" · "Entradas evitadas" (todas las `no comprar` del decisor; ese nombre no se usa para ninguna otra cifra). Celdas de la tabla 2×2: "coinciden: ambos entran" · "la regla entra, el decisor no" · "el decisor entra, la regla no" · "coinciden: ninguno entra" (T-12). Rechazadas por regla con el nombre corto de la regla, igual que en la tabla de reglas de S3 ("R4 exposición: 1"). Vistas de S4: Cartera · Decisor frente a regla; de S5: Ciclo · Decisor. Periodo: "Desde la activación" (por defecto) · 7 días · 30 días. Tasa de aciertos "57.1 %, 4 de 7"; con 0 casos, "—" y "0 entradas cerradas", nunca "0 %". Sin decisor: "La comparación empieza cuando se activa el decisor". Ciclo apagado: "Sin serie de la regla: el ciclo está apagado desde DD nov HH:MM (UTC−6)".
- **Alertas y severidad:** ver [[#Banda de estado (componente insignia)]] y la regla "La severidad sigue al modo" en [[#Named Rules]].

## Do's and Don'ts

### Do:

- Escribir el estado con el vocabulario fijo de la spec, palabra por palabra.
- Mostrar la hora absoluta con zona y la relativa juntas en la banda.
- Poner la investigación después de la regla y del riesgo, siempre con su rótulo. En el decisor, dentro de "Contexto que vio el decisor", al final.
- Escribir "hipotético" junto a toda cifra hipotética.

### Don't:

- Negro puro (#000), estética de terminal (verde o ámbar neón, fuentes mono en todo, scanlines), gradientes, brillos o glows, sombras o animaciones decorativas.
- Botones o controles que parezcan acciones de escritura (AC-UX-21), incluidos "Reintentar" o "Cerrar" en alertas.
- Distinguir algo solo por color; usar `pos`/`neg` para estados que no son dinero.
- Truncar el resumen de investigación en S1 o S3, o renderizar su contenido como enlace o HTML.

## Datos de ejemplo (para FigCraft)

Ahora: **14:42 (UTC−6) del 6 nov**, 20:42 UTC. Última ejecución 14:30. Investigación BTC/USD 14:15 y SOL/USD 14:15 (Vigente). Saldo virtual 10,184.20 USD; valor de cartera 10,201.26 USD; PnL del día +17.06 USD (+0.17 %); acumulado +201.26 USD. Posición abierta: SOL/USD 3.412 SOL, entrada 146.52 USD, SL 143.59, TP 152.38, precio actual 151.52, PnL no realizado +17.06 USD. Son datos inventados de diseño: no se usan en ningún texto fuera de los mockups.

## Tema claro (archivado, 2026-11-06)

Sustituido por el oscuro por decisión de Edgardo. Se conserva solo como referencia si después se agrega como segundo modo: bg #F5F4F0, surface #FFFFFF, sunken #ECEAE4, border #DAD8D1, border-strong #86837B, text #1A1A18, text-muted #5A5852, accent #1D4ED8, pos #0A6B43 / #E4F2EA, neg #B42318 / #FBE9E7, warn #8A4B00 / #FCF0DC, info #3B4A9E / #E9ECF8.
