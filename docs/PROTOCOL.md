# YieBury protocol notes

YieBury is an independent contribution to the ORE store-of-value loop. It is not an ore.com product. It does not seed liquidity, mint a token, or onboard anyone to Ondo.

## Split

Yield is the rise in the USDY reference price since the vault’s snapshot. Principal is not in the split.

On a $10,000 deposit, about 3.55% after Ondo’s spread is about $355 of yield before pool slippage:

| Slice | Of what | About | Where it goes |
| --- | --- | --- | --- |
| Depositor | 90% of yield | $319 | Swapped to ORE, wrapped to stORE, sent to the depositor |
| Fee | 10% of yield | $35.50 | Split below. Taken before either ORE swap |
| Builder | 20% of the fee (2% of yield) | $7.10 | USDY, not swapped. Bury never sees it |
| Bury | 80% of the fee (8% of yield) | $28.40 | Swapped to ORE and handed to ORE’s bury |
| Burned | 90% of what bury receives | $25.56 | ORE’s own rule, not ours |
| Stakers | 10% of what bury receives | $2.84 | ORE’s own rule, not ours |

`DEPOSITOR_YIELD_BPS` is 9000 and is not a config field. Rounding the fee down means the depositor is never rounded below 90%.

`builder_fee_bps` is the only configurable cut. Default 2000. Bury receives `10000 - builder_fee_bps` of the fee (default 8000). Dust inside the fee goes to bury, not the builder.

Pool slippage and the Solana fee come out of each sold slice after that split. Jupiter is called with no `platformFeeBps`. Taking the fee in USDY first avoids a second platform fee.

The 3.55% figure is an illustration of Ondo’s published slope. The program does not hardcode it.

## Solana integration

Checked against Ondo’s address book and bridge docs on 2026-10-01. There is no Solana USDY manager and no Solana port of `USDY_InstantManager`.

| What is on Solana | Address | Use |
| --- | --- | --- |
| Accumulating USDY mint, 6 decimals | `A1KLoBrKBde8Ty9qtNQUtq3C2ortoC3u7twggz7sEto6` | The only USDY this vault holds |
| LayerZero OFT adapter | `7YNReenG6AXgVUfmSizt6hoVXrznS4zDdgCj1UTLJ2S3` | Ondo’s bridge. Burns on one chain and mints native USDY on the other. Not called |
| Ondo Stocks program | `XzTT4XB8m7sLD2xi6snefSasaswsKCxx5Tifjondogm` | Tokenized stocks, not USDY. Not called |
| USDon | `ZPFtoCe7WWqG4N3ZFRccS8T9SMBeHsd1Vmgv2i7ondo` | Stock-swap token, not USDY. Not called |

The Solana address-book row for USDY is the mint and nothing else. No oracle, no instant manager, no rUSDY mint.

Three ways USDY appears on Solana, and which one this program uses:

1. **Secondary pool.** Buy already-unlocked USDY with USDC through Jupiter. This is `deposit_usdc`. It does not onboard anyone to Ondo and does not call a mint.
2. **Primary subscribe.** Ondo’s own mint, on Ethereum via `USDY_InstantManager.subscribe`, or by onboarding and a USDC transfer to Ondo. New tokens stay locked about 40 to 50 days under Regulation S. This program never does that. Ondo’s basics page tells integrators to contact support to mint on Sui, Aptos, Stellar, XRP, or Noble. Solana is not given a subscribe instruction.
3. **Bridge.** [Ondo’s bridge](https://docs.ondo.finance/tools/ondo-bridge) moves USDY between Arbitrum, BNB Chain, Ethereum, Mantle, Sei, Solana, and Tempo with LayerZero OFT. Solana paths are capped at 250,000 USDY outbound and 300,000 inbound per pathway per day. The bridge mints native USDY on arrival. This program does not call it. A bridge mint is still a mint, and the destination lock state is not documented, so it is not treated as unlocked inventory.

`RWADynamicOracle.getPrice()` is the Ethereum redemption price (wrapper `0x87b126e5518b6a1Bb8465779b4607C45C643DF90`). It reverts when paused. It is not deployed for the Solana mint and is not read. Mantle has its own redemption oracle. Neither is the Solana path.

Pyth publishes `Crypto.USDY/USD` as feed `e393449f6aff8a4b6d3e1165a7c9ebec103685f3b41e60db4277b5b6d10e7326`. That id is from Pyth’s public feed list, not from Ondo’s address book. It is not the redemption slope. A signed Hermes update returned unauthorized on 2026-10-01, so no tick from that feed is stored here. Switchboard was named in a 2024 Ondo post. No feed hash is in the current address book. None is invented.

Harvest therefore prices from a Jupiter USDY/USDC snapshot, which is the pool the yield is actually sold into (USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`). If that snapshot is paused, stale, or the pool cannot fill inside the slippage cap, harvest returns success and moves nothing. A later crank may attach a signed Pyth update as a second check. If that update is missing or paused, harvest still skips. It must not fall back to the Ethereum oracle.

## Price

USDY on Solana is accumulating. Yield is a rising price, not a coupon, and not a rebase. Holders are not paid a coupon. They receive only the published slope, which Ondo sets a little under portfolio yield and keeps the spread. Use the accumulating mint, not rUSDY.

- Mint, 6 decimals: `A1KLoBrKBde8Ty9qtNQUtq3C2ortoC3u7twggz7sEto6`
- Checked against [Ondo’s address book](https://docs.ondo.finance/addresses). The Solana section lists the mint and no oracle account.

## Deposits

`deposit_usdc` is refused when the depositor has declared they are a US person. It swaps USDC to already-unlocked USDY on a Solana pool and vaults that. It does not call Ondo’s mint. A fresh mint is locked for about 40 to 50 days and cannot be harvested.

`deposit_usdy` vaults unlocked USDY the depositor already holds. For a US person this is the only deposit. The interface warns that the app does not make that holding legal. Eligibility: <https://docs.ondo.finance/general-access-products/usdy/faq/eligibility>.

Each user has one vault PDA. Authority is the depositor. A further deposit is refused while yield is unsold, so yield is not capitalized into principal.

Recorded at deposit: `shares`, `price_snapshot`, `deposited_at`, plus `principal_value` so later rounding cannot rewrite what was deposited.

## Withdraw and close

`withdraw` is signed by the depositor only. No admin key has an instruction that moves principal.

It returns principal at the snapshot value, in USDY, or in USDC when the swap back fills inside the slippage cap. Accrued yield is harvested first or left in the vault. It is never taken.

`close` deletes the vault only when its USDY balance and principal are zero.

## Harvest

Permissionless to crank.

1. Skip if the price is paused or the pool’s slippage exceeds the cap.
2. Sell only the yield atoms.
3. Transfer the builder’s cut of the fee in USDY. This happens before any swap.
4. Swap the depositor’s 90% of yield USDY to ORE with Jupiter, `platformFeeBps` unset.
5. Wrap through the official ore-lst program and send stORE to the depositor. `calculate_mint_amount` is `ore * supply / stake`, and 1:1 when stake or supply is zero. If wrap fails, send the raw ORE to the depositor and surface the failure. Do not keep it.
6. Swap the bury slice of USDY to ORE and hand it to bury.

Events: `Deposited`, `Harvested`, `Buried`, `Withdrawn`, with USDY sold, ORE bought, ORE burned, ORE distributed, stORE paid, and the builder fee.

## Bury

Read from <https://github.com/regolith-labs/ore/blob/master/program/src/bury.rs> on 2026-10-01.

`process_bury` checks that the caller is a signer and that the ORE account is that signer’s associated token account. It does not compare the signer to `ADMIN_ADDRESS` (`HBUh9g46wk2X89CvaNN15UmsznP59rh6od1h8JwYAopk`). The instruction enum in `api/src/instruction.rs` groups `Bury = 24` under a comment labeled Admin, and the README lists it there, but `process_instruction` dispatches it with no admin check.

So a non-admin can call it. The vault PDA CPIs `process_bury` (`BuryPath::Official`). Bury transfers the ORE to the ORE treasury, then the treasury signs `ore-stake` `distribute` for `amount / 10` and burns the rest. That 90/10 is ORE’s rule. YieBury does not apply it twice, and does not pay stakers out of the builder’s 2%.

`ore-stake` `process_distribute` was read the same day. Any signer who holds the ORE can call it. There is no admin check. It does require `total_staked > 0`.

If a deployment admin-gates bury, do not fork ORE. Burn 90% of the bury slice from the vault’s own ORE account with SPL burn, and call `distribute` for 10% (`BuryPath::Fallback`). If distribute reverts, hold that 10% in the staker escrow (`BuryPath::HoldStakerShare`). Never send it to the builder.

### Program ids, verify before a CPI

| What | Address | Note |
| --- | --- | --- |
| ORE mint | `oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp` | 11 decimals. Matches `MINT_ADDRESS` in ore `api/src/consts.rs` |
| stORE mint | `storenSbvkfzircixnaosc5CbzNZVrHJ6S3EKrS1yqR` | Matches ore-lst consts |
| Mining program, as supplied to verify | `mineRHF5r6S7HyD9SppBfVMXMavDkJsxwGesEvxZr2A` | Config default. Confirm this deployment still serves the permissionless bury before pointing a CPI at it |
| `declare_id!` on ore master the day bury.rs was read | `oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv` | Differs from the mining id above. Not used until an operator verifies it |
| Mint program | `mintzxW6Kckmeyh1h6Zfdj9QcYgCzhPSGiC8ChZ6fCx` | Not the bury program |
| ore-stake | `stakecNP3FpiExZPCgZfqRgumVzi6dNqnfrjwXyTgeH` | `declare_id!` on master |
| ore-lst | `storeD7bEkywTTMrje19WRoyrkEhbhrvyjVnLxWih6a` | Wrap / unwrap |

The config stores `ore_program` set at init. The devnet test mocks bury and does not send a transaction to either id.

## Config timelock

Builder wallet, slippage cap, and `builder_fee_bps` are set at init. `propose` writes a pending config with `eta = now + timelock` (86400 seconds). `apply` before `eta` fails. `withdraw` keeps working the whole time, so a depositor can exit before the new split lands. Apply cannot write a depositor share, and `guard_depositor_bps` rejects anything under 9000.

## Tests

`cargo test --manifest-path program/Cargo.toml` runs the devnet-shaped flow: USDC in, mocked unlocked USDY, mocked price to 3.55%, harvest, 90% as stORE, 2% of yield to the builder, the rest burned or buried, principal back on withdraw, paused price skips, US path performs no USDC swap.

The same assertions are in `src/lib/yiebury/devnet-flow.test.ts`, which is the engine the desk runs.
