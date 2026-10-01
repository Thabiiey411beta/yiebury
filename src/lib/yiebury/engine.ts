import {
  BPS,
  DEFAULT_BUILDER_FEE_BPS,
  DEFAULT_SLIPPAGE_CAP_BPS,
  DEPOSITOR_YIELD_BPS,
  ONE_USDY,
  TIMELOCK_SECS,
  buryCut,
  oreBought,
  principalAtoms,
  splitYield,
  swapUsdcToUsdy,
  swapUsdyToUsdc,
  valueMicro,
  wrapStore,
  yieldAtoms,
} from "./math.ts";

export type BuryPath = "official" | "fallback" | "hold";

export type Vault = {
  usPerson: boolean;
  shares: bigint;
  priceSnapshot: bigint;
  principalValue: bigint;
  depositedAt: number;
  usdyBalance: bigint;
  storeReceived: bigint;
  oreBuried: bigint;
  oreDistributed: bigint;
  rawOreReceived: bigint;
  wrapFailures: number;
};

export type Wallet = { usdc: bigint; usdy: bigint; ore: bigint; store: bigint };

export type LedgerEvent =
  | {
      kind: "Deposited";
      usdcIn: bigint;
      usdyIn: bigint;
      shares: bigint;
      priceSnapshot: bigint;
    }
  | {
      kind: "Harvested";
      usdySold: bigint;
      oreBought: bigint;
      oreBurned: bigint;
      oreDistributed: bigint;
      storePaid: bigint;
      builderFeeUsdy: bigint;
      wrapFailed: boolean;
    }
  | {
      kind: "Buried";
      oreBurned: bigint;
      oreDistributed: bigint;
      path: BuryPath;
    }
  | { kind: "Withdrawn"; usdyOut: bigint; usdcOut: bigint };

export type Engine = {
  builder: string;
  builderFeeBps: bigint;
  slippageCapBps: bigint;
  pending: { builderFeeBps: bigint; slippageCapBps: bigint; eta: number } | null;
  clock: number;
  priceMicro: bigint;
  paused: boolean;
  poolSlippageBps: bigint;
  orePrice: bigint;
  buryPath: BuryPath;
  wrapFails: boolean;
  stakeBalance: bigint;
  storeSupply: bigint;
  vault: Vault | null;
  depositor: Wallet;
  builderWallet: Wallet;
  stakerEscrow: bigint;
  oreBurned: bigint;
  oreDistributed: bigint;
  usdcSwaps: number;
  events: LedgerEvent[];
};

export type Step = { ok: boolean; engine: Engine; message: string };

const emptyWallet = (): Wallet => ({ usdc: 0n, usdy: 0n, ore: 0n, store: 0n });

export function createEngine(): Engine {
  return {
    builder: "builder",
    builderFeeBps: DEFAULT_BUILDER_FEE_BPS,
    slippageCapBps: DEFAULT_SLIPPAGE_CAP_BPS,
    pending: null,
    clock: 1_700_000_000,
    priceMicro: 1_000_000n,
    paused: false,
    poolSlippageBps: 0n,
    orePrice: 180_000_000n,
    buryPath: "official",
    wrapFails: false,
    stakeBalance: 0n,
    storeSupply: 0n,
    vault: null,
    depositor: { ...emptyWallet(), usdc: 1_000_000_000_000n },
    builderWallet: emptyWallet(),
    stakerEscrow: 0n,
    oreBurned: 0n,
    oreDistributed: 0n,
    usdcSwaps: 0,
    events: [],
  };
}

function clone(e: Engine): Engine {
  return {
    ...e,
    pending: e.pending ? { ...e.pending } : null,
    vault: e.vault ? { ...e.vault } : null,
    depositor: { ...e.depositor },
    builderWallet: { ...e.builderWallet },
    events: e.events.map((event) => ({ ...event })),
  };
}

function fail(e: Engine, message: string): Step {
  return { ok: false, engine: e, message };
}

function livePrice(e: Engine): bigint | null {
  if (e.paused || e.priceMicro <= 0n) return null;
  return e.priceMicro;
}

function unharvested(e: Engine): bigint {
  if (!e.vault || e.vault.usdyBalance === 0n) return 0n;
  if (e.paused) return -1n;
  return yieldAtoms(e.vault.usdyBalance, e.vault.principalValue, e.priceMicro);
}

export function depositUsdc(prev: Engine, usPerson: boolean, usdcAtoms: bigint): Step {
  if (usPerson || prev.vault?.usPerson) {
    return fail(prev, "A US person is not offered the USDC swap. Deposit unlocked USDY you already hold.");
  }
  if (usdcAtoms <= 0n) return fail(prev, "Enter an amount.");
  const price = livePrice(prev);
  if (price === null) return fail(prev, "Price source is paused. Nothing was deposited.");
  if (prev.poolSlippageBps > prev.slippageCapBps) {
    return fail(prev, "The pool cannot fill inside the slippage cap. Deposit skipped.");
  }
  const pendingYield = unharvested(prev);
  if (pendingYield < 0n) return fail(prev, "Price source is paused. Harvest or wait before adding principal.");
  if (pendingYield > 0n) return fail(prev, "Harvest yield before depositing more. It is not added to principal.");
  const usdy = swapUsdcToUsdy(usdcAtoms, price, prev.poolSlippageBps);
  if (prev.depositor.usdc < usdcAtoms) return fail(prev, "Not enough USDC in this devnet wallet.");
  const e = clone(prev);
  e.usdcSwaps += 1;
  e.depositor.usdc -= usdcAtoms;
  credit(e, false, usdcAtoms, usdy, price);
  return { ok: true, engine: e, message: "USDC swapped to already-unlocked USDY. Principal recorded at this price." };
}

export function depositUsdy(prev: Engine, usPerson: boolean, usdyAtoms: bigint): Step {
  if (usdyAtoms <= 0n) return fail(prev, "Enter an amount.");
  const price = livePrice(prev);
  if (price === null) return fail(prev, "Price source is paused. Nothing was deposited.");
  const pendingYield = unharvested(prev);
  if (pendingYield < 0n) return fail(prev, "Price source is paused. Harvest or wait before adding principal.");
  if (pendingYield > 0n) return fail(prev, "Harvest yield before depositing more. It is not added to principal.");
  if (prev.vault && prev.vault.usPerson !== usPerson && prev.vault.usdyBalance > 0n) {
    return fail(prev, "This vault is already open on the other path.");
  }
  const e = clone(prev);
  if (e.depositor.usdy < usdyAtoms) e.depositor.usdy = usdyAtoms;
  e.depositor.usdy -= usdyAtoms;
  credit(e, usPerson, 0n, usdyAtoms, price);
  return {
    ok: true,
    engine: e,
    message: usPerson
      ? "Unlocked USDY vaulted. This did not make the holding legal, and no USDC swap ran."
      : "Unlocked USDY vaulted. No mint, no swap.",
  };
}

function credit(e: Engine, usPerson: boolean, usdcIn: bigint, usdyIn: bigint, price: bigint) {
  const vault: Vault = e.vault ?? {
    usPerson,
    shares: 0n,
    priceSnapshot: 0n,
    principalValue: 0n,
    depositedAt: e.clock,
    usdyBalance: 0n,
    storeReceived: 0n,
    oreBuried: 0n,
    oreDistributed: 0n,
    rawOreReceived: 0n,
    wrapFailures: 0,
  };
  vault.usPerson = usPerson;
  vault.usdyBalance += usdyIn;
  vault.shares += usdyIn;
  vault.principalValue += valueMicro(usdyIn, price);
  vault.priceSnapshot = vault.shares === 0n ? price : (vault.principalValue * ONE_USDY) / vault.shares;
  e.vault = vault;
  e.events.push({
    kind: "Deposited",
    usdcIn,
    usdyIn,
    shares: vault.shares,
    priceSnapshot: vault.priceSnapshot,
  });
}

export type HarvestKind = "paid" | "paused" | "slippage" | "none";

export function harvest(prev: Engine): Step & { kind: HarvestKind } {
  if (prev.paused || prev.priceMicro <= 0n) {
    return { ok: true, kind: "paused", engine: prev, message: "Harvest skipped. The price source is paused." };
  }
  if (prev.poolSlippageBps > prev.slippageCapBps) {
    return {
      ok: true,
      kind: "slippage",
      engine: prev,
      message: "Harvest skipped. The pool cannot fill inside the slippage cap.",
    };
  }
  if (!prev.vault) return { ok: false, kind: "none", engine: prev, message: "No vault yet." };
  const y = yieldAtoms(prev.vault.usdyBalance, prev.vault.principalValue, prev.priceMicro);
  if (y === 0n) {
    return { ok: true, kind: "none", engine: prev, message: "No yield to sell. Principal stays put." };
  }
  const split = splitYield(y, prev.builderFeeBps);
  const oreForDepositor = oreBought(split.depositor, prev.priceMicro, prev.orePrice, prev.poolSlippageBps);
  const oreForBury = oreBought(split.bury, prev.priceMicro, prev.orePrice, prev.poolSlippageBps);
  const e = clone(prev);
  const vault = e.vault!;
  vault.usdyBalance -= y;
  vault.shares = vault.usdyBalance;
  vault.priceSnapshot = e.priceMicro;
  e.builderWallet.usdy += split.builder;

  let storePaid = 0n;
  let wrapFailed = false;
  if (e.wrapFails) {
    wrapFailed = true;
    e.depositor.ore += oreForDepositor;
    vault.rawOreReceived += oreForDepositor;
    vault.wrapFailures += 1;
  } else {
    storePaid = wrapStore(oreForDepositor, e.stakeBalance, e.storeSupply);
    e.depositor.store += storePaid;
    e.storeSupply += storePaid;
    e.stakeBalance += oreForDepositor;
    vault.storeReceived += storePaid;
  }

  const cut = buryCut(oreForBury);
  if (e.buryPath === "hold") {
    e.oreBurned += cut.burned;
    e.stakerEscrow += cut.shared;
  } else {
    e.oreBurned += cut.burned;
    e.oreDistributed += cut.shared;
  }
  vault.oreBuried += cut.burned;
  vault.oreDistributed += cut.shared;
  e.events.push({
    kind: "Buried",
    oreBurned: cut.burned,
    oreDistributed: e.buryPath === "hold" ? 0n : cut.shared,
    path: e.buryPath,
  });
  e.events.push({
    kind: "Harvested",
    usdySold: y,
    oreBought: oreForDepositor + oreForBury,
    oreBurned: cut.burned,
    oreDistributed: e.buryPath === "hold" ? 0n : cut.shared,
    storePaid,
    builderFeeUsdy: split.builder,
    wrapFailed,
  });
  const message = wrapFailed
    ? "Wrap failed. Raw ORE was sent to the depositor and not kept in the vault."
    : "Harvest paid. stORE to the depositor, USDY fee to the builder, the rest through bury.";
  return { ok: true, kind: "paid", engine: e, message };
}

export function withdraw(prev: Engine, signer: "depositor" | "builder", asUsdc: boolean): Step {
  if (signer !== "depositor") return fail(prev, "Only the depositor can withdraw. No admin key moves principal.");
  const price = livePrice(prev);
  if (price === null) return fail(prev, "Price source is paused, so principal cannot be separated from yield. Nothing was taken.");
  if (asUsdc && prev.poolSlippageBps > prev.slippageCapBps) {
    return fail(prev, "Swap back to USDC would break the slippage cap. Withdraw USDY instead.");
  }
  if (!prev.vault) return fail(prev, "No vault yet.");
  const e = clone(prev);
  const vault = e.vault!;
  const atoms = principalAtoms(vault.principalValue, vault.usdyBalance, price);
  vault.usdyBalance -= atoms;
  vault.principalValue = 0n;
  vault.shares = 0n;
  vault.priceSnapshot = price;
  if (asUsdc) {
    const usdc = swapUsdyToUsdc(atoms, price, e.poolSlippageBps);
    e.depositor.usdc += usdc;
    e.events.push({ kind: "Withdrawn", usdyOut: 0n, usdcOut: usdc });
    return { ok: true, engine: e, message: "Principal returned as USDC. Unharvested yield, if any, stays in the vault." };
  }
  e.depositor.usdy += atoms;
  e.events.push({ kind: "Withdrawn", usdyOut: atoms, usdcOut: 0n });
  return { ok: true, engine: e, message: "Principal returned as USDY. Unharvested yield, if any, stays in the vault." };
}

export function closeVault(prev: Engine, signer: "depositor" | "builder"): Step {
  if (signer !== "depositor") return fail(prev, "Only the depositor can close.");
  if (!prev.vault) return fail(prev, "No vault yet.");
  if (prev.vault.usdyBalance > 0n || prev.vault.principalValue > 0n) {
    return fail(prev, "The vault still holds USDY. Withdraw principal and harvest yield first.");
  }
  const e = clone(prev);
  e.vault = null;
  return { ok: true, engine: e, message: "Vault closed." };
}

export function proposeFee(prev: Engine, builderFeeBps: bigint): Step {
  if (builderFeeBps < 0n || builderFeeBps > BPS) return fail(prev, "The fee split has to stay inside the 10%.");
  if (DEPOSITOR_YIELD_BPS < 9_000n) return fail(prev, "The depositor's 90% cannot be lowered.");
  const e = clone(prev);
  e.pending = {
    builderFeeBps,
    slippageCapBps: e.slippageCapBps,
    eta: e.clock + TIMELOCK_SECS,
  };
  return {
    ok: true,
    engine: e,
    message: "Fee change proposed. It does not apply yet. You can withdraw before it lands.",
  };
}

export function applyFee(prev: Engine): Step {
  if (!prev.pending) return fail(prev, "Nothing is waiting.");
  if (prev.clock < prev.pending.eta) return fail(prev, "Timelock has not elapsed. Withdraw if you do not want the new split.");
  const e = clone(prev);
  e.builderFeeBps = e.pending!.builderFeeBps;
  e.slippageCapBps = e.pending!.slippageCapBps;
  e.pending = null;
  return { ok: true, engine: e, message: "New fee split is live. The depositor still receives 90% of yield." };
}

export function setPrice(prev: Engine, priceMicro: bigint): Step {
  if (priceMicro <= 0n) return fail(prev, "Price has to be positive.");
  const e = clone(prev);
  e.priceMicro = priceMicro;
  return { ok: true, engine: e, message: "Price snapshot updated. This is the pool price, not an Ondo oracle." };
}

export function setPaused(prev: Engine, paused: boolean): Engine {
  const e = clone(prev);
  e.paused = paused;
  return e;
}

export function setPoolSlippage(prev: Engine, bps: bigint): Engine {
  const e = clone(prev);
  e.poolSlippageBps = bps;
  return e;
}

export function setWrapFails(prev: Engine, wrapFails: boolean): Engine {
  const e = clone(prev);
  e.wrapFails = wrapFails;
  return e;
}

export function advanceYear(prev: Engine): Step {
  const next = (prev.priceMicro * 10_355n) / 10_000n;
  return setPrice(prev, next);
}

export function advanceClock(prev: Engine, seconds: number): Engine {
  const e = clone(prev);
  e.clock += seconds;
  return e;
}

export function position(e: Engine): {
  principal: bigint;
  yieldValue: bigint;
  yieldTokens: bigint;
  balanceValue: bigint;
} {
  if (!e.vault || e.paused || e.priceMicro <= 0n) {
    return {
      principal: e.vault?.principalValue ?? 0n,
      yieldValue: 0n,
      yieldTokens: 0n,
      balanceValue: 0n,
    };
  }
  const balanceValue = valueMicro(e.vault.usdyBalance, e.priceMicro);
  const principal = e.vault.principalValue;
  const yieldValue = balanceValue > principal ? balanceValue - principal : 0n;
  return {
    principal,
    yieldValue,
    yieldTokens: yieldAtoms(e.vault.usdyBalance, principal, e.priceMicro),
    balanceValue,
  };
}

/** The worked $10,000 deposit at $1, marked up 3.55%, harvested by a crank. */
export function replayTenThousand(): Step {
  let step = depositUsdc(createEngine(), false, 10_000_000_000n);
  if (!step.ok) return step;
  step = setPrice(step.engine, 1_035_500n);
  if (!step.ok) return step;
  return harvest(step.engine);
}
