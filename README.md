# YieBury

Independent Solana vault for the ORE store-of-value loop. Not an ore.com product.

A deposit sits in unlocked USDY and earns Treasury yield. Harvest sells only the yield:

- 90% is paid to the depositor in stORE. This is not configurable downward.
- 10% is a fee. Of that fee, 20% (2% of yield) goes to the builder in USDY, before any swap.
- 80% of the fee (8% of yield) is swapped to ORE and pushed through ORE’s existing bury: 90% burned, 10% to stakers.

Principal is never taken. There is no new token, no liquidity seeding, and no Ondo mint. USDY is not offered to US persons. A declared US person can deposit only unlocked USDY they already hold.

The desk in this repo is the devnet simulator: a mocked pool and a mocked Jupiter price, running the same accounting as `program/`. Read [docs/PROTOCOL.md](docs/PROTOCOL.md) before pointing a bury CPI at a deployment. The mining program id and the `declare_id!` on ore master were not the same on the day the source was read.

```bash
cargo test --manifest-path program/Cargo.toml
node --experimental-strip-types --test src/lib/yiebury/devnet-flow.test.ts
```

Links: [ore.com](https://ore.com), [bury.rs](https://github.com/regolith-labs/ore/blob/master/program/src/bury.rs), [Ondo eligibility](https://docs.ondo.finance/general-access-products/usdy/faq/eligibility).
