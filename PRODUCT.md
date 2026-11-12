---
type: product
tags: [signalforge, ux, product]
project: signalforge
status: active
updated: 2026-11-10
owner: ux-lead
---

# Product

<!-- impeccable:product-schema 1 -->

> Contexto de producto para el dashboard de SignalForge. Fuente: [[workspaces/signalforge/specs/001-paper-trading-con-agente-programado/spec|spec 001]] (approved 2026-11-06). Dirección visual: [[workspaces/signalforge/DESIGN|DESIGN.md]].
> Ubicación: la bóveda, mientras el repo `signal-forge` está en `feat/001-base` con otro agente. Propuesta: en T-14 el `frontend` lo copia a la raíz del repo y esta nota queda enlazando ahí (TODO: Verify con Alicia).

## Platform

web

## Users

Un solo usuario: **Edgardo** (dueño). Lo consulta en escritorio (1280×800) y en el teléfono (390×844, mínimo 360 px), varias veces al día y a ratos cortos. Su trabajo con la herramienta: saber de un vistazo si el sistema está sano y, cuando algo llama la atención, auditar una decisión hasta su origen.

## Product Purpose

Tablero **de solo lectura** del paper trading de SignalForge (etapa 1): un ciclo determinista evalúa BTC/USD y SOL/USD cada 30 min y propone entradas; una tarea programada de Claude envía investigación cada hora, que solo se guarda como dato. Desde la [[workspaces/signalforge/specs/004-decisor-agente-programado/spec|spec 004]] hay un segundo proponente, el **decisor** (otra tarea programada de Claude, cada hora en el minuto 45), que lee un contexto con mercado, investigación y cartera y decide Comprar o No comprar por activo. Solo uno de los dos ejecuta; el otro solo registra o está apagado (modos en la configuración del despliegue). El éxito del tablero: responder sin tocar nada "¿opera o está en pausa?, ¿corrió el ciclo?, ¿llegó la investigación?, ¿cómo va el saldo?" y explicar cada propuesta (ejecutada o rechazada) con su regla, sus reglas de riesgo y la respuesta del broker.

## Operating Context

- Cuenta **paper** (simulada) de Alpaca; saldo virtual inicial 10,000.00 USD.
- Horas en hora de Torreón (America/Monterrey, UTC−6, sin horario de verano) con zona visible; UTC en el detalle. Agrupaciones por día UTC, y lo dicen.
- La pausa manual se activa en la configuración del despliegue (Coolify), nunca desde el tablero.
- Superficies: S1 Resumen, S2 Propuestas, S3 Detalle, S4 Métricas, S5 Ejecuciones, más la banda de estado global.

## Capabilities and Constraints

- **Solo lectura** (REQ-29, AC-UX-21): los únicos controles son navegación, filtros y enlaces a fuentes. Nada que parezca "Pausar", "Cerrar posición", "Reintentar", "Ejecutar ciclo" o "Pedir investigación".
- Vocabulario de estados **fijo** (spec, Criterios de UX): no se parafrasea.
- **Ciclo:** la investigación **nunca** es motivo de su decisión: rotulada "Informativa: no interviene en la decisión de entrada" y después de la regla y del riesgo (AC-UX-25 de 001).
- **Decisor** (spec 004, AC-UX-9): la investigación forma parte del contexto que lee, rotulada "Leída por el decisor: forma parte del contexto con el que decidió" y dentro de "Contexto que vio el decisor". El motivo que se muestra es su razonamiento literal, nunca "por la investigación", y la decisión final es siempre de las reglas de riesgo.
- Ningún control cambia modos ni activa, apaga o reintenta el decisor: se cambia en la configuración del despliegue (AC-UX-19 de 004).
- Texto de terceros (resúmenes y fuentes de investigación) se muestra como texto literal.
- Idioma: español de México (es-MX), números con formato es-MX.

## Brand Commitments

Nombre: **SignalForge**. Sin logotipo, paleta ni voz previas. Voz del tablero: factual, breve, sin entusiasmo comercial ni lenguaje de casino.

## Evidence on Hand

Sin contenido real todavía: el tablero arranca con la base vacía. Los datos de diseño son de ejemplo (ver DESIGN.md, "Datos de ejemplo") y se presentan como tales; no se inventan rendimientos.

## Product Principles

1. **Salud antes que rendimiento.** Lo primero que se lee es si el sistema corre; el dinero va después.
2. **Nada parece dato si no lo es.** Ni ceros mientras carga, ni valores del broker viejos como actuales.
3. **El riesgo decide al final; cada proponente muestra con qué decidió.** En el ciclo, la regla decide y la investigación acompaña como dato informativo. En el decisor, la investigación es parte del contexto que leyó y su razonamiento literal es el motivo, pero ninguno de los dos se salta las reglas de riesgo. Jerarquía y rótulo lo hacen evidente en cada pantalla, y nada dice que una entrada se hizo "por" la investigación (spec 004, O-UX-9; sustituye a "La regla decide; la investigación acompaña", 2026-11-10).
4. **Todo es auditable.** Cada número lleva su periodo, su base o su denominador; cada decisión, su motivo.
5. **Sin regla, sin señal no es error.** "Sin señal" es un resultado normal y se ve neutral.

## Accessibility & Inclusion

WCAG 2.2 AA (AC-UX-16): 4.5:1 en texto, 3:1 en texto grande, bordes de estado, líneas de gráfica y foco. Nada se distingue solo por color (AC-UX-15): signo +/− y etiqueta de texto siempre. Teclado completo con foco visible (AC-UX-20). Objetivos táctiles de 44×44 px y sin scroll horizontal a 360 px (AC-UX-19). Respeta `prefers-reduced-motion`.
