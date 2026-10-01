import type { Wallet } from "@wallet-standard/base";

export type WalletSession = {
  address: string;
  name: string;
  disconnect: () => Promise<void>;
};

export type DetectedWallet = {
  id: string;
  name: string;
  connect: () => Promise<WalletSession>;
};

type ConnectResult = { accounts: readonly { address: string; chains?: readonly string[] }[] };

type StandardConnect = {
  connect: (input?: { silent?: boolean }) => Promise<ConnectResult>;
};

type StandardDisconnect = {
  disconnect: () => Promise<void>;
};

type InjectedProvider = {
  isPhantom?: boolean;
  isSolflare?: boolean;
  isBackpack?: boolean;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey?: InjectedKey }>;
  disconnect?: () => Promise<void>;
  publicKey?: InjectedKey;
};

type InjectedKey = { toBase58?: () => string; toString: () => string };

type SolanaWindow = Window & {
  solana?: InjectedProvider;
  solflare?: InjectedProvider;
  backpack?: InjectedProvider;
  phantom?: { solana?: InjectedProvider };
};

const seen = new Map<string, DetectedWallet>();

export function callStandardConnect(wallet: Wallet): Promise<WalletSession> {
  const connect = (wallet.features["standard:connect"] as StandardConnect | undefined)?.connect;
  if (!connect) {
    return Promise.reject(new Error(`${wallet.name} has no connect method.`));
  }
  return connect().then((result) => {
    const account = pickAccount(result.accounts);
    if (!account) throw new Error(`${wallet.name} connected without an account.`);
    const disconnect = (wallet.features["standard:disconnect"] as StandardDisconnect | undefined)?.disconnect;
    return {
      address: account.address,
      name: wallet.name,
      disconnect: async () => {
        await disconnect?.();
      },
    };
  });
}

export function callInjectedConnect(name: string, provider: InjectedProvider): Promise<WalletSession> {
  return provider.connect().then((result) => {
    const address = keyAddress(result.publicKey) ?? keyAddress(provider.publicKey);
    if (!address) throw new Error(`${name} connected without an address.`);
    return {
      address,
      name,
      disconnect: async () => {
        await provider.disconnect?.();
      },
    };
  });
}

export async function scanSolanaWallets(): Promise<DetectedWallet[]> {
  if (typeof window === "undefined") return [];
  readInjected().forEach(addWallet);
  try {
    const { getWallets } = await import("@wallet-standard/app");
    const api = getWallets();
    for (const wallet of api.get()) addStandard(wallet);
    if (!listening) {
      listening = true;
      api.on("register", (...wallets) => {
        wallets.forEach(addStandard);
      });
      api.on("unregister", (...wallets) => {
        for (const wallet of wallets) seen.delete(standardId(wallet));
      });
    }
  } catch {
    // The page still calls any injected provider. A missing standard registry is not a fake connect.
  }
  return [...seen.values()];
}

let listening = false;

function addStandard(wallet: Wallet): void {
  if (!wallet.chains.some((chain) => chain.startsWith("solana:"))) return;
  if (typeof (wallet.features["standard:connect"] as StandardConnect | undefined)?.connect !== "function") return;
  addWallet({
    id: standardId(wallet),
    name: wallet.name,
    connect: () => callStandardConnect(wallet),
  });
}

function addWallet(wallet: DetectedWallet): void {
  if (!wallet.id.startsWith("injected:")) {
    for (const [id, existing] of seen) {
      if (id.startsWith("injected:") && existing.name === wallet.name) seen.delete(id);
    }
  } else if ([...seen.values()].some((existing) => existing.name === wallet.name && !existing.id.startsWith("injected:"))) {
    return;
  }
  seen.set(wallet.id, wallet);
}

function readInjected(): DetectedWallet[] {
  const w = window as SolanaWindow;
  const found: { name: string; provider: InjectedProvider }[] = [];
  const phantom = w.phantom?.solana ?? (w.solana?.isPhantom ? w.solana : undefined);
  if (phantom) found.push({ name: "Phantom", provider: phantom });
  if (w.solflare) found.push({ name: "Solflare", provider: w.solflare });
  if (w.backpack) found.push({ name: "Backpack", provider: w.backpack });
  if (w.solana && !w.solana.isPhantom && w.solana !== w.solflare) {
    found.push({ name: "Solana wallet", provider: w.solana });
  }
  return found.map((entry) => ({
    id: `injected:${entry.name}`,
    name: entry.name,
    connect: () => callInjectedConnect(entry.name, entry.provider),
  }));
}

function pickAccount(accounts: readonly { address: string; chains?: readonly string[] }[]): { address: string } | undefined {
  return (
    accounts.find((account) => account.chains?.includes("solana:mainnet")) ??
    accounts.find((account) => account.chains?.some((chain) => chain.startsWith("solana:"))) ??
    accounts[0]
  );
}

function keyAddress(key: InjectedKey | undefined): string | null {
  if (!key) return null;
  const address = key.toBase58?.() ?? key.toString();
  return address && address !== "[object Object]" ? address : null;
}

function standardId(wallet: Wallet): string {
  return `standard:${wallet.name}`;
}

export function walletErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") return error.message;
  return "The wallet rejected the connection.";
}
