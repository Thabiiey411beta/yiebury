import { createServerFn } from "@tanstack/react-start";
import { MINTS } from "./math.ts";
import { JUPITER_PRICE_URL, SOLANA_RPC_URL, asAtoms, isSolanaAddress, jupiterSnapshotUrl, priceMicroFromQuote, priceMicroFromUsd } from "./quote.ts";

export type UsdySnapshot =
  | {
      ok: true;
      priceMicro: string;
      inAmount: string;
      outAmount: string;
      priceImpactPct: string;
      source: "quote" | "listed";
    }
  | { ok: false; reason: string };

export type WalletBalances =
  | { ok: true; sol: string; usdc: string; usdy: string }
  | { ok: false; reason: string };

type TokenAccountResult = {
  value?: {
    account?: {
      data?: { parsed?: { info?: { tokenAmount?: { amount?: unknown } } } };
    };
  }[];
};

const SNAPSHOT_TTL_MS = 15_000;
let snapshotCache: { at: number; snap: UsdySnapshot } | null = null;

export const fetchUsdySnapshot = createServerFn({ method: "POST" }).handler(async (): Promise<UsdySnapshot> => {
  if (snapshotCache && snapshotCache.snap.ok && Date.now() - snapshotCache.at < SNAPSHOT_TTL_MS) {
    return snapshotCache.snap;
  }
  const snap = await readSnapshot();
  if (snap.ok) snapshotCache = { at: Date.now(), snap };
  return snap;
});

async function readSnapshot(): Promise<UsdySnapshot> {
  const quote = await readQuote();
  if (quote.ok) return quote;
  const listed = await readListedPrice();
  return listed ?? quote;
}

async function readQuote(): Promise<UsdySnapshot> {
  try {
    const res = await fetch(jupiterSnapshotUrl(), { headers: { accept: "application/json" } });
    if (!res.ok) {
      return { ok: false, reason: `Jupiter returned ${res.status}. The snapshot is paused, so harvest skips.` };
    }
    const body = (await res.json()) as { inAmount?: unknown; outAmount?: unknown; priceImpactPct?: unknown };
    const price = priceMicroFromQuote(body.inAmount, body.outAmount);
    if (price === null) {
      return { ok: false, reason: "Jupiter returned no USDY/USDC fill. The snapshot is paused, so harvest skips." };
    }
    return {
      ok: true,
      source: "quote",
      priceMicro: price.toString(),
      inAmount: String(body.inAmount),
      outAmount: String(body.outAmount),
      priceImpactPct: typeof body.priceImpactPct === "string" ? body.priceImpactPct : "0",
    };
  } catch {
    return { ok: false, reason: "Jupiter could not be reached. The snapshot is paused, so harvest skips." };
  }
}

async function readListedPrice(): Promise<UsdySnapshot | null> {
  try {
    const url = new URL(JUPITER_PRICE_URL);
    url.searchParams.set("ids", MINTS.usdy);
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, { usdPrice?: unknown }>;
    const price = priceMicroFromUsd(body[MINTS.usdy]?.usdPrice);
    if (price === null) return null;
    return {
      ok: true,
      source: "listed",
      priceMicro: price.toString(),
      inAmount: "1000000",
      outAmount: price.toString(),
      priceImpactPct: "0",
    };
  } catch {
    return null;
  }
}

export const fetchWalletBalances = createServerFn({ method: "POST" })
  .validator((data: { owner: string }) => data)
  .handler(async ({ data }): Promise<WalletBalances> => {
    if (!isSolanaAddress(data.owner)) {
      return { ok: false, reason: "That is not a Solana address." };
    }
    try {
      const [sol, usdc, usdy] = await Promise.all([
        rpc("getBalance", [data.owner]),
        tokenAtoms(data.owner, MINTS.usdc),
        tokenAtoms(data.owner, MINTS.usdy),
      ]);
      const lamports = asAtoms((sol as { value?: unknown }).value);
      if (lamports === null || usdc === null || usdy === null) {
        return { ok: false, reason: "Mainnet returned an unreadable balance. Nothing was assumed." };
      }
      return { ok: true, sol: lamports.toString(), usdc: usdc.toString(), usdy: usdy.toString() };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Mainnet balance read failed.";
      return { ok: false, reason };
    }
  });

async function tokenAtoms(owner: string, mint: string): Promise<bigint | null> {
  const result = (await rpc("getTokenAccountsByOwner", [owner, { mint }, { encoding: "jsonParsed" }])) as TokenAccountResult;
  const rows = result.value ?? [];
  let total = 0n;
  for (const row of rows) {
    const amount = asAtoms(row.account?.data?.parsed?.info?.tokenAmount?.amount);
    if (amount === null) return null;
    total += amount;
  }
  return total;
}

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(SOLANA_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Solana mainnet returned ${res.status}. Balances were not guessed.`);
  const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message || "Solana mainnet rejected the balance read.");
  if (body.result === undefined) throw new Error("Solana mainnet returned no balance.");
  return body.result;
}
