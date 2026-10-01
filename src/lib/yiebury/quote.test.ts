import assert from "node:assert/strict";
import test from "node:test";
import { priceMicroFromQuote, priceMicroFromUsd } from "./quote.ts";

test("a Jupiter USDY to USDC fill is the price in micro-dollars", () => {
  assert.equal(priceMicroFromQuote("1000000", "1144639"), 1_144_639n);
  assert.equal(priceMicroFromQuote(1_000_000, 1_144_639), 1_144_639n);
  assert.equal(priceMicroFromQuote("2000000", "2289278"), 1_144_639n);
});

test("a listed Jupiter USD price becomes micro-dollars", () => {
  assert.equal(priceMicroFromUsd(1.1444304195783792), 1_144_430n);
  assert.equal(priceMicroFromUsd(0), null);
  assert.equal(priceMicroFromUsd("1.14"), null);
});
test("a quote with no fill is not a price", () => {
  assert.equal(priceMicroFromQuote("0", "1"), null);
  assert.equal(priceMicroFromQuote("1000000", "nope"), null);
  assert.equal(priceMicroFromQuote(undefined, undefined), null);
});
