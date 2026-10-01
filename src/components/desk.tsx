import { useMemo, useState } from "react";
import {
  advanceClock,
  advanceYear,
  applyFee,
  closeVault,
  createEngine,
  depositUsdc,
  depositUsdy,
  harvest,
  position,
  proposeFee,
  replayTenThousand,
  setPaused,
  setPoolSlippage,
  setWrapFails,
  withdraw,
  type Engine,
  type LedgerEvent,
} from "@/lib/yiebury/engine";
import { formatAtoms, formatPrice, formatUsd, parseAtoms } from "@/lib/yiebury/format";
import {
  BPS,
  DEFAULT_BUILDER_FEE_BPS,
  buryCut,
  oreBought,
  splitYield,
  valueMicro,
  yieldAtoms,
} from "@/lib/yiebury/math";

const LINKS = [
  { href: "https://ore.com", label: "ore.com" },
  {
    href: "https://github.com/regolith-labs/ore/blob/master/program/src/bury.rs",
    label: "Bury source",
  },
  {
    href: "https://docs.ondo.finance/general-access-products/usdy/faq/eligibility",
    label: "Ondo eligibility",
  },
] as const;

export function Desk() {
  const [engine, setEngine] = useState<Engine>(() => createEngine());
  const [path, setPath] = useState<"abroad" | "us">("abroad");
  const [amount, setAmount] = useState("10000");
  const [note, setNote] = useState("Devnet simulator. Nothing here is a mainnet transaction.");
  const [slippage, setSlippage] = useState("0");
  const pos = position(engine);
  const locked = engine.vault !== null;
  const usPerson = locked ? engine.vault!.usPerson : path === "us";
  const illustration = useMemo(() => buildIllustration(engine.orePrice), [engine.orePrice]);

  function apply(step: { ok: boolean; engine: Engine; message: string }) {
    setEngine(step.engine);
    setNote(step.message);
  }

  function onDeposit() {
    const atoms = parseAtoms(amount, 6);
    if (atoms === null || atoms <= 0n) {
      setNote("Enter a USD amount, up to 6 decimals.");
      return;
    }
    apply(usPerson ? depositUsdy(engine, true, atoms) : depositUsdc(engine, false, atoms));
  }

  function onReplay() {
    const step = replayTenThousand();
    setPath("abroad");
    setAmount("10000");
    apply(step);
  }

  const buryBps = BPS - engine.builderFeeBps;

  return (
    <main className="mx-auto min-h-screen w-full max-w-xl px-5 py-8 sm:py-12">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted uppercase">
            <span className="inline-block size-2.5 bg-copper" aria-hidden="true" />
            Not an ore.com product
          </p>
          <h1 className="mt-2 font-serif text-5xl leading-none text-ink">YieBury</h1>
        </div>
        <p className="max-w-36 pt-1 text-right text-xs leading-snug text-muted">
          Devnet desk. Mocked pool, mocked price.
        </p>
      </header>

      <p className="mt-6 text-base text-ink">
        Dollars sit in unlocked USDY and earn Treasury yield. On harvest, 90% of that yield is paid to
        you in stORE. A 10% fee is split 20/80: the builder, then ORE’s existing bury.
      </p>

      <p className="mt-4 border-l-2 border-copper pl-4 text-sm text-ink">
        USDY is not offered to US persons. This app does not mint it and does not onboard anyone to
        Ondo. Yield is realized by selling USDY. Principal is never taken.
      </p>

      <nav className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label="Sources">
        {LINKS.map((link) => (
          <a
            key={link.href}
            className="text-ink underline decoration-line underline-offset-4"
            href={link.href}
            target="_blank"
            rel="noreferrer"
          >
            {link.label}
          </a>
        ))}
      </nav>

      <section className="mt-10" aria-labelledby="deposit-heading">
        <h2 id="deposit-heading" className="font-serif text-2xl">
          Deposit
        </h2>
        <div className="mt-4 grid gap-2" role="radiogroup" aria-label="Which deposit path applies to you">
          <PathOption
            checked={!usPerson}
            disabled={locked}
            title="Not a US person"
            body="Deposit USDC. It is swapped on a Solana pool to USDY that is already unlocked. A fresh Ondo mint stays locked about 40 to 50 days, so this program never calls it."
            onSelect={() => setPath("abroad")}
          />
          <PathOption
            checked={usPerson}
            disabled={locked}
            title="I am a US person"
            body="USDC is not offered. USDY is Regulation S and cannot be sold to US persons."
            onSelect={() => setPath("us")}
          />
        </div>
        {usPerson ? (
          <p className="mt-3 bg-bone-deep px-3 py-3 text-sm text-ink">
            This screen accepts only unlocked USDY you already hold. Depositing it here does not make
            that holding legal.
          </p>
        ) : null}

        <label className="mt-4 block text-sm text-muted" htmlFor="amount">
          {usPerson ? "Unlocked USDY" : "USDC"}
        </label>
        <input
          id="amount"
          className="mt-1 w-full border border-line bg-bone px-3 py-3 font-serif text-3xl text-ink tabular-nums"
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <button
          type="button"
          className="mt-3 min-h-11 w-full bg-copper px-4 text-base font-medium text-bone"
          onClick={onDeposit}
        >
          {usPerson ? "Deposit unlocked USDY" : "Deposit USDC"}
        </button>
      </section>

      <section className="mt-10 border-t border-line pt-6" aria-labelledby="price-heading">
        <div className="flex items-end justify-between gap-3">
          <h2 id="price-heading" className="font-serif text-2xl">
            Price
          </h2>
          <p className="font-serif text-2xl tabular-nums">{engine.paused ? "Paused" : formatPrice(engine.priceMicro)}</p>
        </div>
        <p className="mt-2 text-sm text-muted">
          Ondo publishes no oracle for the Solana mint. The Ethereum redemption oracle is not read.
          Pyth lists a USDY/USD feed, and it is not Ondo’s price and not the pool. Harvest uses a
          Jupiter USDY/USDC snapshot. If that snapshot is paused, or the pool cannot fill inside
          the slippage cap, harvest does nothing.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" className="min-h-11 border border-ink px-3 text-sm" onClick={() => apply(advanceYear(engine))}>
            Accrue a year
          </button>
          <button
            type="button"
            className="min-h-11 border border-ink px-3 text-sm"
            onClick={() => {
              setEngine(setPaused(engine, !engine.paused));
              setNote(engine.paused ? "Price source resumed." : "Price source paused. Harvest will skip.");
            }}
          >
            {engine.paused ? "Resume price" : "Pause price"}
          </button>
        </div>
      </section>

      <section className="mt-10" aria-labelledby="position-heading">
        <h2 id="position-heading" className="font-serif text-2xl">
          Your vault
        </h2>
        <dl className="mt-3 border-t border-ink">
          <Row label="Principal" value={formatUsd(pos.principal)} />
          <Row
            label="Yield accrued"
            value={engine.paused && engine.vault ? "Paused" : formatUsd(pos.yieldValue)}
            hint={engine.paused ? "Not sold while the price source is paused." : "Unsold. Harvest sells only this."}
          />
          <Row
            label="stORE received"
            value={formatAtoms(engine.vault?.storeReceived ?? engine.depositor.store, 11)}
            tone="pine"
          />
          <Row
            label="ORE buried in your name"
            value={formatAtoms(engine.vault?.oreBuried ?? 0n, 11)}
            tone="copper"
            hint={
              engine.vault && engine.vault.oreDistributed > 0n
                ? `${formatAtoms(engine.vault.oreDistributed, 11)} ORE went to stakers, not the builder.`
                : undefined
            }
          />
          {engine.vault && engine.vault.rawOreReceived > 0n ? (
            <Row
              label="Raw ORE, wrap failed"
              value={formatAtoms(engine.vault.rawOreReceived, 11)}
              hint="Sent to your wallet. The vault did not keep it."
            />
          ) : null}
        </dl>
        <div className="mt-4 grid gap-2">
          <button type="button" className="min-h-11 bg-ink px-4 text-base font-medium text-bone" onClick={() => apply(harvest(engine))}>
            Crank harvest
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="min-h-11 border border-ink px-3 text-sm"
              onClick={() => apply(withdraw(engine, "depositor", false))}
            >
              Withdraw USDY
            </button>
            <button
              type="button"
              className="min-h-11 border border-ink px-3 text-sm"
              onClick={() => apply(withdraw(engine, "depositor", true))}
            >
              Withdraw USDC
            </button>
          </div>
          <button
            type="button"
            className="min-h-11 text-sm text-muted underline underline-offset-4"
            onClick={() => apply(closeVault(engine, "depositor"))}
          >
            Close empty vault
          </button>
        </div>
        <p className="mt-3 text-sm text-ink" role="status">
          {note}
        </p>
      </section>

      <section className="mt-10 border-t border-line pt-6" aria-labelledby="public-heading">
        <h2 id="public-heading" className="text-sm font-medium tracking-wide text-muted uppercase">
          Public buried counter
        </h2>
        <p className="mt-1 font-serif text-4xl text-copper tabular-nums">{formatAtoms(engine.oreBurned, 11)} ORE</p>
        <p className="mt-1 text-sm text-muted">
          Burned through bury. {formatAtoms(engine.oreDistributed, 11)} ORE was distributed to ORE
          stakers.
          {engine.stakerEscrow > 0n
            ? ` ${formatAtoms(engine.stakerEscrow, 11)} ORE is held because distribute could not be called. It is not the builder’s.`
            : ""}
        </p>
      </section>

      <section className="mt-10 border-t border-line pt-6" aria-labelledby="example-heading">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="example-heading" className="font-serif text-2xl">
            On $10,000
          </h2>
          <button type="button" className="text-sm text-ink underline underline-offset-4" onClick={onReplay}>
            Run it
          </button>
        </div>
        <p className="mt-2 text-sm text-muted">
          USDY yield is about 3.55% after Ondo’s own spread, so about {formatUsd(illustration.yieldValue)}{" "}
          before pool slippage. The program does not hardcode that rate. It sells the gap between the
          snapshot and the current price. Slippage and the Solana fee come out of each sold slice, not
          out of the 90%.
        </p>
        <div className="mt-4 flex h-3 w-full" aria-hidden="true">
          <div className="h-full bg-pine" style={{ width: "90%" }} />
          <div className="h-full bg-ink" style={{ width: "2%" }} />
          <div className="h-full bg-copper" style={{ width: "8%" }} />
        </div>
        <dl className="mt-4 border-t border-line">
          <Row label="You, in stORE" value={formatUsd(illustration.depositorValue)} tone="pine" hint="90% of yield. Not a fee." />
          <Row label="Builder, in USDY" value={formatUsd(illustration.builderValue)} hint="20% of the 10% fee. 2% of yield. Taken before the swap." />
          <Row label="Handed to bury" value={formatUsd(illustration.buryValue)} tone="copper" hint="80% of the fee. 8% of yield." />
          <Row
            label="Then bury’s own rule"
            value={`${formatAtoms(illustration.burned, 11)} burned`}
            hint={`${formatAtoms(illustration.shared, 11)} to ORE stakers. About ${formatUsd(illustration.burnedValue)} burned and ${formatUsd(illustration.sharedValue)} to stakers.`}
          />
        </dl>
        <p className="mt-3 text-sm text-muted">
          Fee ratio is a config constant, default {Number(engine.builderFeeBps) / 100}% of the fee to the
          builder and {Number(buryBps) / 100}% to bury. The 90% cannot be configured downward.
        </p>
      </section>

      <details className="mt-8 border-t border-line pt-4">
        <summary className="min-h-11 cursor-pointer text-sm font-medium">Timelock and the devnet crank</summary>
        <div className="mt-3 grid gap-3 text-sm">
          <p className="text-muted">
            Builder wallet, slippage cap ({engine.slippageCapBps.toString()} bps), and the fee split are
            set at init. A change waits 24 hours. You can exit before it lands.
            {engine.pending
              ? ` Pending: ${Number(engine.pending.builderFeeBps) / 100}% of the fee at clock ${engine.pending.eta}. Now ${engine.clock}.`
              : " Nothing is pending."}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="min-h-11 border border-ink px-3" onClick={() => apply(proposeFee(engine, 4_000n))}>
              Propose 40% of the fee
            </button>
            <button type="button" className="min-h-11 border border-ink px-3" onClick={() => apply(applyFee(engine))}>
              Apply if elapsed
            </button>
            <button
              type="button"
              className="min-h-11 border border-ink px-3"
              onClick={() => {
                setEngine(advanceClock(engine, 86_400));
                setNote("Devnet clock moved one day.");
              }}
            >
              Advance the clock one day
            </button>
            <button
              type="button"
              className="min-h-11 border border-ink px-3"
              onClick={() => {
                setEngine(setWrapFails(engine, !engine.wrapFails));
                setNote(engine.wrapFails ? "stORE wrap will be attempted." : "Next harvest will fail the wrap and send raw ORE.");
              }}
            >
              {engine.wrapFails ? "Wrap is forced to fail" : "Force wrap to fail"}
            </button>
          </div>
          <label className="block text-muted" htmlFor="slip">
            Pool slippage, bps. Cap is {engine.slippageCapBps.toString()}. Above the cap, harvest skips and USDC withdrawal is refused.
          </label>
          <input
            id="slip"
            className="w-full border border-line bg-bone px-3 py-3 tabular-nums"
            inputMode="numeric"
            value={slippage}
            onChange={(event) => {
              const next = event.target.value.replace(/[^\d]/g, "");
              setSlippage(next);
              const bps = BigInt(next || "0");
              setEngine(setPoolSlippage(engine, bps));
            }}
          />
        </div>
      </details>

      <section className="mt-8 border-t border-line pt-4" aria-labelledby="ledger-heading">
        <h2 id="ledger-heading" className="text-sm font-medium tracking-wide text-muted uppercase">
          Ledger
        </h2>
        {engine.events.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No deposits yet.</p>
        ) : (
          <ol className="mt-2 divide-y divide-line">
            {[...engine.events].reverse().map((event, index) => (
              <li key={`${event.kind}-${index}`} className="py-2 text-sm">
                {describe(event)}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

function PathOption({
  checked,
  disabled,
  title,
  body,
  onSelect,
}: {
  checked: boolean;
  disabled: boolean;
  title: string;
  body: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={
        "min-h-11 border px-3 py-3 text-left " +
        (checked ? "border-ink bg-bone-deep text-ink" : "border-line bg-bone text-ink")
      }
    >
      <span className="block text-sm font-medium">{title}</span>
      <span className="mt-1 block text-sm text-muted">{body}</span>
    </button>
  );
}

function Row({
  label,
  value,
  hint,
  tone = "ink",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ink" | "pine" | "copper";
}) {
  const color = tone === "pine" ? "text-pine" : tone === "copper" ? "text-copper" : "text-ink";
  return (
    <div className="border-b border-line py-3">
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-sm text-muted">{label}</dt>
        <dd className={`font-serif text-xl tabular-nums ${color}`}>{value}</dd>
      </div>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function buildIllustration(orePrice: bigint) {
  const shares = 10_000_000_000n;
  const price = 1_035_500n;
  const principal = valueMicro(shares, 1_000_000n);
  const yieldValue = valueMicro(shares, price) - principal;
  const atoms = yieldAtoms(shares, principal, price);
  const split = splitYield(atoms, DEFAULT_BUILDER_FEE_BPS);
  const buryOre = oreBought(split.bury, price, orePrice, 0n);
  const cut = buryCut(buryOre);
  const buryValue = valueMicro(split.bury, price);
  return {
    yieldValue,
    depositorValue: valueMicro(split.depositor, price),
    builderValue: valueMicro(split.builder, price),
    buryValue,
    burned: cut.burned,
    shared: cut.shared,
    burnedValue: (buryValue * 9n) / 10n,
    sharedValue: buryValue / 10n,
  };
}

function describe(event: LedgerEvent): string {
  switch (event.kind) {
    case "Deposited":
      return event.usdcIn > 0n
        ? `Deposited ${formatAtoms(event.usdcIn, 6)} USDC, swapped to ${formatAtoms(event.usdyIn, 6)} USDY.`
        : `Deposited ${formatAtoms(event.usdyIn, 6)} unlocked USDY. No swap.`;
    case "Harvested":
      return `Harvested ${formatAtoms(event.usdySold, 6)} USDY. stORE ${formatAtoms(event.storePaid, 11)}. Builder fee ${formatAtoms(event.builderFeeUsdy, 6)} USDY. Burned ${formatAtoms(event.oreBurned, 11)} ORE. Distributed ${formatAtoms(event.oreDistributed, 11)}.${event.wrapFailed ? " Wrap failed; raw ORE was sent out." : ""}`;
    case "Buried":
      return `Buried ${formatAtoms(event.oreBurned, 11)} ORE. Distributed ${formatAtoms(event.oreDistributed, 11)} via ${event.path}.`;
    case "Withdrawn":
      return event.usdcOut > 0n
        ? `Withdrew ${formatUsd(event.usdcOut)} of principal as USDC.`
        : `Withdrew ${formatAtoms(event.usdyOut, 6)} USDY of principal.`;
  }
}
