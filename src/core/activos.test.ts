import { describe, expect, it } from "vitest";
import { ACTIVOS, esActivo } from "./activos";

describe("activos", () => {
  it("solo BTC/USD y SOL/USD", () => {
    expect(ACTIVOS).toEqual(["BTC/USD", "SOL/USD"]);
    expect(esActivo("BTC/USD")).toBe(true);
    expect(esActivo("ETH/USD")).toBe(false);
    expect(esActivo(null)).toBe(false);
  });
});
