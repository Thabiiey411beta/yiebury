import { useEffect, useState } from "react";
import { isFramed } from "@/lib/app-data/login";
import { scanSolanaWallets, walletErrorMessage, type DetectedWallet, type WalletSession } from "@/lib/yiebury/wallet";

export function WalletButton({ onSession }: { onSession: (session: WalletSession | null) => void }) {
  const [wallets, setWallets] = useState<DetectedWallet[]>([]);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<WalletSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [framed, setFramed] = useState(false);

  useEffect(() => {
    let cancel = false;
    setFramed(isFramed());
    scanSolanaWallets().then((found) => {
      if (!cancel) setWallets(found);
    });
    return () => {
      cancel = true;
    };
  }, []);

  async function connect(wallet: DetectedWallet) {
    setBusy(true);
    setError(null);
    try {
      const next = await wallet.connect();
      setSession(next);
      onSession(next);
      setOpen(false);
    } catch (caught) {
      setError(walletErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function onPress() {
    if (session) return;
    const found = await scanSolanaWallets();
    setWallets(found);
    if (found.length === 0) {
      setOpen(false);
      setError(
        framed
          ? "No Solana wallet answered in this frame. Install Phantom, Solflare, or Backpack, open this page in a tab, and press Connect again."
          : "No Solana wallet answered. Install Phantom, Solflare, or Backpack, then press Connect again.",
      );
      return;
    }
    if (found.length === 1) {
      await connect(found[0]);
      return;
    }
    setError(null);
    setOpen((value) => !value);
  }

  async function onDisconnect() {
    setBusy(true);
    try {
      await session?.disconnect();
    } catch (caught) {
      setError(walletErrorMessage(caught));
    } finally {
      setSession(null);
      onSession(null);
      setBusy(false);
    }
  }

  return (
    <div className="relative max-w-full shrink-0 text-right">
      {session ? (
        <button
          type="button"
          className="min-h-11 max-w-full border border-ink px-3 text-sm"
          onClick={onDisconnect}
          disabled={busy}
        >
          {shortAddress(session.address)} · Disconnect
        </button>
      ) : (
        <button type="button" className="min-h-11 border border-ink px-3 text-sm" onClick={onPress} disabled={busy}>
          {busy ? "Waiting for wallet" : "Connect wallet"}
        </button>
      )}
      {open && wallets.length > 1 ? (
        <ul className="absolute right-0 z-10 mt-1 w-56 border border-ink bg-bone text-left" role="menu">
          {wallets.map((wallet) => (
            <li key={wallet.id}>
              <button
                type="button"
                role="menuitem"
                className="min-h-11 w-full px-3 text-left text-sm"
                onClick={() => connect(wallet)}
              >
                {wallet.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="mt-2 max-w-56 text-xs leading-snug text-ink">{error}</p> : null}
      {error && framed ? (
        <button
          type="button"
          className="mt-2 text-xs underline decoration-line underline-offset-4"
          onClick={() => window.open(window.location.href, "_blank", "noopener")}
        >
          Open this page in a tab
        </button>
      ) : null}
    </div>
  );
}

function shortAddress(address: string): string {
  if (address.length < 10) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
