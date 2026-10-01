import { MINTS } from "./math.ts";

/** One USDY, in atoms. Both USDY and USDC use 6 decimals, so this quote’s USDC out is the price in micro-dollars. */
export const SNAPSHOT_USDY_ATOMS = 1_000_000n;

export const JUPITER_QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
export const JUPITER_PRICE_URL = "https://api.jup.ag/price/v3";
export const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";

export function priceMicroFromQuote(inAmount: unknown, outAmount: unknown): bigint | null {
  const input = asAtoms(inAmount);
  const output = asAtoms(outAmount);
  if (input === null || output === null || input <= 0n || output <= 0n) return null;
  return (output * SNAPSHOT_USDY_ATOMS) / input;
}

export function priceMicroFromUsd(value: unknown): bigint | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1_000_000) return null;
  return BigInt(Math.round(value * 1_000_000));
}

export function asAtoms(value: unknown): bigint | null {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

export function isSolanaAddress(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

export function jupiterSnapshotUrl(): string {
  const url = new URL(JUPITER_QUOTE_URL);
  url.searchParams.set("inputMint", MINTS.usdy);
  url.searchParams.set("outputMint", MINTS.usdc);
  url.searchParams.set("amount", SNAPSHOT_USDY_ATOMS.toString());
  url.searchParams.set("slippageBps", "50");
  return url.toString();
}
