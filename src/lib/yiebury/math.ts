/** Split math shared with `program/src/math.rs`. Do not fork it. */

export const DEPOSITOR_YIELD_BPS = 9_000n;
export const FEE_BPS = 1_000n;
export const BPS = 10_000n;
export const DEFAULT_BUILDER_FEE_BPS = 2_000n;
export const DEFAULT_BURY_FEE_BPS = 8_000n;
export const ONE_USDY = 1_000_000n;
export const ONE_ORE = 100_000_000_000n;
export const TIMELOCK_SECS = 86_400;
export const DEFAULT_SLIPPAGE_CAP_BPS = 100n;

export const MINTS = {
  usdy: "A1KLoBrKBde8Ty9qtNQUtq3C2ortoC3u7twggz7sEto6",
  usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  ore: "oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp",
  store: "storenSbvkfzircixnaosc5CbzNZVrHJ6S3EKrS1yqR",
} as const;

export const PROGRAMS = {
  /** Verify before any bury CPI. User-supplied mining program. */
  oreMining: "mineRHF5r6S7HyD9SppBfVMXMavDkJsxwGesEvxZr2A",
  /** `declare_id!` on regolith-labs/ore master when bury.rs was read. Do not assume it matches mining. */
  oreMasterDeclare: "oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv",
  oreMint: "mintzxW6Kckmeyh1h6Zfdj9QcYgCzhPSGiC8ChZ6fCx",
  oreStake: "stakecNP3FpiExZPCgZfqRgumVzi6dNqnfrjwXyTgeH",
  oreLst: "storeD7bEkywTTMrje19WRoyrkEhbhrvyjVnLxWih6a",
} as const;

export function valueMicro(usdyAtoms: bigint, priceMicro: bigint): bigint {
  return (usdyAtoms * priceMicro) / ONE_USDY;
}

export function usdyForValue(micro: bigint, priceMicro: bigint): bigint {
  if (priceMicro <= 0n) return 0n;
  return (micro * ONE_USDY) / priceMicro;
}

export function principalAtoms(principalValue: bigint, balance: bigint, priceMicro: bigint): bigint {
  if (priceMicro <= 0n || principalValue <= 0n || balance <= 0n) return 0n;
  let atoms = usdyForValue(principalValue, priceMicro);
  if (valueMicro(atoms, priceMicro) < principalValue) atoms += 1n;
  return atoms > balance ? balance : atoms;
}

export function yieldAtoms(balance: bigint, principalValue: bigint, priceMicro: bigint): bigint {
  if (priceMicro <= 0n || balance <= 0n) return 0n;
  const current = valueMicro(balance, priceMicro);
  if (current <= principalValue) return 0n;
  const atoms = usdyForValue(current - principalValue, priceMicro);
  return atoms > balance ? balance : atoms;
}

export type YieldSplit = {
  depositor: bigint;
  fee: bigint;
  builder: bigint;
  bury: bigint;
};

export function splitYield(atoms: bigint, builderFeeBps: bigint): YieldSplit {
  if (builderFeeBps < 0n || builderFeeBps > BPS) {
    throw new Error("Fee bps must stay inside the 10% fee.");
  }
  const fee = (atoms * FEE_BPS) / BPS;
  const depositor = atoms - fee;
  const builder = (fee * builderFeeBps) / BPS;
  const bury = fee - builder;
  return { depositor, fee, builder, bury };
}

export function guardDepositorBps(bps: bigint): void {
  if (bps < DEPOSITOR_YIELD_BPS) {
    throw new Error("The depositor's 90% cannot be lowered.");
  }
}

export function oreBought(
  usdyAtoms: bigint,
  usdyPrice: bigint,
  orePrice: bigint,
  slippageBps: bigint,
): bigint {
  if (slippageBps > BPS || orePrice <= 0n) throw new Error("Bad swap quote.");
  const gross = valueMicro(usdyAtoms, usdyPrice);
  const ideal = (gross * ONE_ORE) / orePrice;
  return (ideal * (BPS - slippageBps)) / BPS;
}

export function swapUsdcToUsdy(usdcAtoms: bigint, usdyPrice: bigint, slippageBps: bigint): bigint {
  if (usdyPrice <= 0n || slippageBps > BPS) throw new Error("Bad swap quote.");
  const ideal = (usdcAtoms * ONE_USDY) / usdyPrice;
  return (ideal * (BPS - slippageBps)) / BPS;
}

export function swapUsdyToUsdc(usdyAtoms: bigint, usdyPrice: bigint, slippageBps: bigint): bigint {
  if (slippageBps > BPS) throw new Error("Bad swap quote.");
  const ideal = valueMicro(usdyAtoms, usdyPrice);
  return (ideal * (BPS - slippageBps)) / BPS;
}

export function buryCut(oreAtoms: bigint): { burned: bigint; shared: bigint } {
  const shared = oreAtoms / 10n;
  return { burned: oreAtoms - shared, shared };
}

export function wrapStore(oreAtoms: bigint, stakeBalance: bigint, storeSupply: bigint): bigint {
  if (stakeBalance === 0n || storeSupply === 0n) return oreAtoms;
  return (oreAtoms * storeSupply) / stakeBalance;
}
