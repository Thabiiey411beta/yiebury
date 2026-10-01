import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyFee,
  advanceClock,
  closeVault,
  createEngine,
  depositUsdc,
  depositUsdy,
  harvest,
  proposeFee,
  replayTenThousand,
  setPaused,
  setPoolSlippage,
  setPrice,
  setWrapFails,
  withdraw,
} from "./engine.ts";
import {
  DEFAULT_BUILDER_FEE_BPS,
  buryCut,
  oreBought,
  splitYield,
  valueMicro,
  wrapStore,
} from "./math.ts";

describe("devnet flow", () => {
  it("deposits USDC, harvests the split, and returns principal", () => {
    const step = replayTenThousand();
    assert.equal(step.ok, true);
    const e = step.engine;
    const vault = e.vault;
    assert.ok(vault);
    const harvested = e.events.find((event) => event.kind === "Harvested");
    assert.ok(harvested && harvested.kind === "Harvested");
    assert.equal(harvested.wrapFailed, false);
    const split = splitYield(harvested.usdySold, DEFAULT_BUILDER_FEE_BPS);
    assert.equal(harvested.builderFeeUsdy, split.builder);
    assert.equal(e.builderWallet.usdy, split.builder);
    assert.equal(split.depositor + split.builder + split.bury, harvested.usdySold);

    const price = 1_035_500n;
    const depositorValue = valueMicro(split.depositor, price);
    const builderValue = valueMicro(split.builder, price);
    const buryValue = valueMicro(split.bury, price);
    assert.ok(abs(depositorValue - 319_500_000n) < 2_000_000n);
    assert.ok(abs(builderValue - 7_100_000n) < 50_000n);
    assert.ok(abs(buryValue - 28_400_000n) < 50_000n);

    const oreDepositor = oreBought(split.depositor, price, e.orePrice, 0n);
    const oreBury = oreBought(split.bury, price, e.orePrice, 0n);
    assert.equal(harvested.storePaid, wrapStore(oreDepositor, 0n, 0n));
    assert.equal(e.depositor.store, harvested.storePaid);
    assert.equal(e.depositor.ore, 0n);
    const cut = buryCut(oreBury);
    assert.equal(harvested.oreBurned, cut.burned);
    assert.equal(harvested.oreDistributed, cut.shared);
    assert.equal(e.oreBurned, cut.burned);
    assert.equal(vault.oreBuried, cut.burned);
    assert.equal(e.builderWallet.ore, 0n);
    assert.equal(e.builderWallet.store, 0n);

    const out = withdraw(e, "depositor", false);
    assert.equal(out.ok, true);
    const withdrawnValue = valueMicro(out.engine.depositor.usdy, price);
    assert.ok(abs(withdrawnValue - 10_000_000_000n) <= valueMicro(1n, price) + 1n);
    assert.equal(out.engine.vault?.principalValue, 0n);
    const closed = closeVault(out.engine, "depositor");
    assert.equal(closed.ok, true);
    assert.equal(closed.engine.vault, null);
  });

  it("skips harvest when the price is paused", () => {
    let e = depositUsdc(createEngine(), false, 10_000_000_000n).engine;
    e = setPrice(e, 1_035_500n).engine;
    e = setPaused(e, true);
    const skipped = harvest(e);
    assert.equal(skipped.kind, "paused");
    assert.equal(skipped.engine.depositor.store, 0n);
    assert.equal(skipped.engine.builderWallet.usdy, 0n);
    assert.equal(skipped.engine.oreBurned, 0n);
    assert.equal(skipped.engine.vault?.usdyBalance, 10_000_000_000n);
    const paid = harvest(setPaused(skipped.engine, false));
    assert.equal(paid.kind, "paid");
    assert.ok(paid.engine.depositor.store > 0n);
  });

  it("offers the US path no USDC swap", () => {
    const blocked = depositUsdc(createEngine(), true, 10_000_000_000n);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.engine.usdcSwaps, 0);
    assert.equal(blocked.engine.vault, null);
    const funded = createEngine();
    funded.depositor.usdy = 5_000_000_000n;
    const deposited = depositUsdy(funded, true, 5_000_000_000n);
    assert.equal(deposited.ok, true);
    assert.equal(deposited.engine.usdcSwaps, 0);
    assert.equal(deposited.engine.vault?.usPerson, true);
    assert.equal(deposited.engine.vault?.usdyBalance, 5_000_000_000n);
  });

  it("does not let a fee change cut the depositor before the timelock", () => {
    let e = depositUsdc(createEngine(), false, 10_000_000_000n).engine;
    e = proposeFee(e, 5_000n).engine;
    e = setPrice(e, 1_035_500n).engine;
    e = harvest(e).engine;
    const first = e.builderWallet.usdy;
    const sold = e.events.find((event) => event.kind === "Harvested");
    assert.ok(sold && sold.kind === "Harvested");
    assert.equal(first, splitYield(sold.usdySold, DEFAULT_BUILDER_FEE_BPS).builder);
    assert.equal(applyFee(e).ok, false);
    e = withdraw(e, "depositor", false).engine;
    e = advanceClock(e, 86_400);
    e = applyFee(e).engine;
    assert.equal(e.builderFeeBps, 5_000n);
    assert.throws(() => splitYield(1n, 10_001n));
  });
});

function abs(n: bigint): bigint {
  return n < 0n ? -n : n;
}
