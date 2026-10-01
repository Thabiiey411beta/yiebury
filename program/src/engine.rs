//! Instruction processor for one vault PDA per depositor.
//!
//! No admin key can move principal. The config authority may only propose a
//! timelocked change of the builder wallet, the slippage cap, and the fee's
//! 20/80 cut. The depositor's 90% is not a config field.

use crate::math::*;

pub const TIMELOCK_SECS: i64 = 86_400;
pub const DEFAULT_SLIPPAGE_CAP_BPS: u64 = 100;

/// What the vault does with the bury slice.
///
/// `process_bury` (`regolith-labs/ore` `program/src/bury.rs`) requires only
/// that the caller sign and own the ORE. It does not compare the signer to
/// `ADMIN_ADDRESS`. The README groups the instruction under "Admin", but the
/// dispatcher does not gate it. The vault PDA therefore CPIs `process_bury`.
///
/// That CPI transfers the ORE into the ORE treasury, which then `distribute`s
/// 10% (signed by the treasury PDA) and burns 90%.
///
/// If a later deployment admin-gates bury, do not fork ORE. Use
/// [`BuryPath::Fallback`]: SPL-burn 90% from the vault's own ORE account, and
/// call `ore-stake` `distribute` for 10%. `process_distribute` is
/// permissionless (any signer with ORE). If distribute itself fails, hold the
/// 10% in the staker escrow. Never pay it to the builder.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BuryPath {
    /// CPI `process_bury` from the vault PDA.
    Official,
    /// Admin-gated bury: burn 90% here, permissionless distribute 10%.
    Fallback,
    /// Distribute reverted (for example `total_staked == 0`). Hold the 10%.
    HoldStakerShare,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Config {
    pub authority: String,
    pub builder: String,
    pub slippage_cap_bps: u64,
    pub builder_fee_bps: u64,
    pub timelock_secs: i64,
    /// Verified ORE program that contains the permissionless bury handler.
    /// Not hardcoded to an unverified id. See `docs/PROTOCOL.md`.
    pub ore_program: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingConfig {
    pub builder: String,
    pub slippage_cap_bps: u64,
    pub builder_fee_bps: u64,
    pub eta: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Price {
    /// Micro-USD per 1 whole USDY. Jupiter USDY/USDC snapshot. Not an invented oracle.
    pub micro: u64,
    pub paused: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Vault {
    pub authority: String,
    pub us_person: bool,
    /// USDY atoms currently backing principal. Updated when yield is sold.
    pub shares: u64,
    pub price_snapshot: u64,
    pub principal_value: u128,
    pub deposited_at: i64,
    pub usdy_balance: u64,
    pub store_received: u64,
    pub ore_buried: u64,
    pub ore_distributed: u64,
    pub raw_ore_received: u64,
    pub wrap_failures: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Wallet {
    pub usdc: u64,
    pub usdy: u64,
    pub ore: u64,
    pub store: u64,
}

impl Wallet {
    fn new() -> Self {
        Self { usdc: 0, usdy: 0, ore: 0, store: 0 }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Event {
    Deposited {
        authority: String,
        usdc_in: u64,
        usdy_in: u64,
        shares: u64,
        price_snapshot: u64,
    },
    Harvested {
        authority: String,
        usdy_sold: u64,
        ore_bought: u64,
        ore_burned: u64,
        ore_distributed: u64,
        store_paid: u64,
        builder_fee_usdy: u64,
        wrap_failed: bool,
    },
    Buried {
        authority: String,
        ore_burned: u64,
        ore_distributed: u64,
        path: BuryPath,
    },
    Withdrawn {
        authority: String,
        usdy_out: u64,
        usdc_out: u64,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct World {
    pub config: Config,
    pub pending: Option<PendingConfig>,
    pub clock: i64,
    pub price: Price,
    /// Quoted pool slippage, in bps, applied to each sold slice.
    pub pool_slippage_bps: u64,
    pub ore_price: u64,
    pub bury_path: BuryPath,
    pub wrap_fails: bool,
    /// ore-lst stake balance and stORE supply. Zero means the 1:1 genesis rate.
    pub stake_balance: u64,
    pub store_supply: u64,
    pub vault: Option<Vault>,
    pub depositor: Wallet,
    pub builder_wallet: Wallet,
    /// 10% of a bury slice held because distribute could not be called.
    pub staker_escrow: u64,
    pub ore_burned: u128,
    pub ore_distributed: u128,
    pub usdc_swaps: u64,
    pub events: Vec<Event>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    UsPersonCannotSwapUsdc,
    PricePaused,
    SlippageExceeded,
    NotAuthority,
    NothingToDeposit,
    MustHarvestFirst,
    TimelockPending,
    TimelockNotElapsed,
    NoPendingConfig,
    FeeBps,
    DepositorShareLocked,
    NotEmpty,
    NoVault,
    Math,
}

impl World {
    pub fn devnet() -> Self {
        let builder = "builder".to_string();
        Self {
            config: Config {
                authority: builder.clone(),
                builder: builder.clone(),
                slippage_cap_bps: DEFAULT_SLIPPAGE_CAP_BPS,
                builder_fee_bps: DEFAULT_BUILDER_FEE_BPS,
                timelock_secs: TIMELOCK_SECS,
                // Operator must confirm this id still serves the permissionless bury.
                // Source `declare_id!` on master currently differs. See PROTOCOL.md.
                ore_program: "mineRHF5r6S7HyD9SppBfVMXMavDkJsxwGesEvxZr2A".to_string(),
            },
            pending: None,
            clock: 1_700_000_000,
            price: Price { micro: 1_000_000, paused: false },
            pool_slippage_bps: 0,
            ore_price: 180_000_000,
            bury_path: BuryPath::Official,
            wrap_fails: false,
            stake_balance: 0,
            store_supply: 0,
            vault: None,
            depositor: Wallet {
                usdc: 1_000_000_000_000,
                ..Wallet::new()
            },
            builder_wallet: Wallet::new(),
            staker_escrow: 0,
            ore_burned: 0,
            ore_distributed: 0,
            usdc_swaps: 0,
            events: Vec::new(),
        }
    }

    fn require_price(&self) -> Result<u64, Error> {
        if self.price.paused || self.price.micro == 0 {
            Err(Error::PricePaused)
        } else {
            Ok(self.price.micro)
        }
    }

    fn open(&mut self, us_person: bool) -> &mut Vault {
        if self.vault.is_none() {
            self.vault = Some(Vault {
                authority: "depositor".to_string(),
                us_person,
                shares: 0,
                price_snapshot: 0,
                principal_value: 0,
                deposited_at: self.clock,
                usdy_balance: 0,
                store_received: 0,
                ore_buried: 0,
                ore_distributed: 0,
                raw_ore_received: 0,
                wrap_failures: 0,
            });
        }
        self.vault.as_mut().unwrap()
    }

    /// `deposit_usdc`. Refuses a declared US person before any swap.
    /// Swaps to already-unlocked USDY. Does not call Ondo's mint.
    /// Jupiter `platformFeeBps` is not set.
    pub fn deposit_usdc(&mut self, us_person: bool, usdc_atoms: u64) -> Result<(), Error> {
        if us_person {
            return Err(Error::UsPersonCannotSwapUsdc);
        }
        if let Some(vault) = &self.vault {
            if vault.us_person {
                return Err(Error::UsPersonCannotSwapUsdc);
            }
        }
        if usdc_atoms == 0 {
            return Err(Error::NothingToDeposit);
        }
        let price = self.require_price()?;
        if self.pool_slippage_bps > self.config.slippage_cap_bps {
            return Err(Error::SlippageExceeded);
        }
        self.refuse_unharvested()?;
        let usdy = swap_usdc_to_usdy(usdc_atoms, price, self.pool_slippage_bps).map_err(|_| Error::Math)?;
        self.usdc_swaps += 1;
        if self.depositor.usdc < usdc_atoms {
            return Err(Error::NothingToDeposit);
        }
        self.depositor.usdc -= usdc_atoms;
        self.credit_usdy(us_person, usdc_atoms, usdy, price)
    }

    /// `deposit_usdy`. Already-unlocked USDY the depositor holds. No swap.
    pub fn deposit_usdy(&mut self, us_person: bool, usdy_atoms: u64) -> Result<(), Error> {
        if usdy_atoms == 0 {
            return Err(Error::NothingToDeposit);
        }
        let price = self.require_price()?;
        self.refuse_unharvested()?;
        if self.depositor.usdy < usdy_atoms {
            return Err(Error::NothingToDeposit);
        }
        self.depositor.usdy -= usdy_atoms;
        self.credit_usdy(us_person, 0, usdy_atoms, price)
    }

    fn refuse_unharvested(&self) -> Result<(), Error> {
        let Some(vault) = &self.vault else {
            return Ok(());
        };
        if vault.usdy_balance == 0 {
            return Ok(());
        }
        if self.price.paused {
            return Err(Error::PricePaused);
        }
        let y = yield_atoms(vault.usdy_balance, vault.principal_value, self.price.micro);
        if y > 0 {
            Err(Error::MustHarvestFirst)
        } else {
            Ok(())
        }
    }

    fn credit_usdy(&mut self, us_person: bool, usdc_in: u64, usdy_in: u64, price: u64) -> Result<(), Error> {
        let clock = self.clock;
        let vault = self.open(us_person);
        if vault.us_person != us_person && vault.usdy_balance > 0 {
            return Err(Error::UsPersonCannotSwapUsdc);
        }
        vault.us_person = us_person;
        vault.usdy_balance += usdy_in;
        vault.shares += usdy_in;
        vault.principal_value += value_micro(usdy_in, price);
        vault.price_snapshot = if vault.shares == 0 {
            price
        } else {
            (vault.principal_value * ONE_USDY / vault.shares as u128) as u64
        };
        if vault.deposited_at == 0 {
            vault.deposited_at = clock;
        }
        let shares = vault.shares;
        let snap = vault.price_snapshot;
        let authority = vault.authority.clone();
        self.events.push(Event::Deposited {
            authority,
            usdc_in,
            usdy_in,
            shares,
            price_snapshot: snap,
        });
        Ok(())
    }

    /// `harvest`. Permissionless. Pays the builder only their cut of the fee,
    /// in USDY, before any swap. Wraps the depositor's ORE to stORE and sends
    /// it to the depositor. On wrap failure, sends raw ORE and does not keep it.
    pub fn harvest(&mut self, _crank: &str) -> Result<HarvestOutcome, Error> {
        let price = match self.require_price() {
            Ok(p) => p,
            Err(Error::PricePaused) => return Ok(HarvestOutcome::SkippedPaused),
            Err(e) => return Err(e),
        };
        if self.pool_slippage_bps > self.config.slippage_cap_bps {
            return Ok(HarvestOutcome::SkippedSlippage);
        }
        let Some(vault) = self.vault.as_ref() else {
            return Err(Error::NoVault);
        };
        let y = yield_atoms(vault.usdy_balance, vault.principal_value, price);
        if y == 0 {
            return Ok(HarvestOutcome::SkippedNoYield);
        }
        let split = split_yield(y, self.config.builder_fee_bps).map_err(|_| Error::FeeBps)?;
        let slip = self.pool_slippage_bps;
        let ore_price = self.ore_price;
        let ore_for_depositor = ore_bought(split.depositor, price, ore_price, slip).map_err(|_| Error::Math)?;
        let ore_for_bury = ore_bought(split.bury, price, ore_price, slip).map_err(|_| Error::Math)?;

        let wrap_fails = self.wrap_fails;
        let stake_balance = self.stake_balance;
        let store_supply = self.store_supply;
        let path = self.bury_path;
        let builder_atoms = split.builder;

        {
            let vault = self.vault.as_mut().unwrap();
            vault.usdy_balance -= y;
            vault.shares = vault.usdy_balance;
            vault.price_snapshot = price;
        }
        self.builder_wallet.usdy += builder_atoms;

        let (store_paid, wrap_failed) = if wrap_fails {
            self.depositor.ore += ore_for_depositor;
            let vault = self.vault.as_mut().unwrap();
            vault.raw_ore_received += ore_for_depositor;
            vault.wrap_failures += 1;
            (0, true)
        } else {
            let minted = wrap_store(ore_for_depositor, stake_balance, store_supply);
            self.depositor.store += minted;
            self.store_supply += minted;
            self.stake_balance += ore_for_depositor;
            let vault = self.vault.as_mut().unwrap();
            vault.store_received += minted;
            (minted, false)
        };

        let (burned, shared) = self.apply_bury(ore_for_bury, path);
        {
            let vault = self.vault.as_mut().unwrap();
            vault.ore_buried += burned;
            vault.ore_distributed += shared;
        }
        let authority = self.vault.as_ref().unwrap().authority.clone();
        let ore_bought_total = ore_for_depositor + ore_for_bury;
        self.events.push(Event::Buried {
            authority: authority.clone(),
            ore_burned: burned,
            ore_distributed: shared,
            path,
        });
        self.events.push(Event::Harvested {
            authority,
            usdy_sold: y,
            ore_bought: ore_bought_total,
            ore_burned: burned,
            ore_distributed: shared,
            store_paid,
            builder_fee_usdy: builder_atoms,
            wrap_failed,
        });
        Ok(HarvestOutcome::Paid)
    }

    fn apply_bury(&mut self, ore_atoms: u64, path: BuryPath) -> (u64, u64) {
        let (burned, shared) = bury_cut(ore_atoms);
        match path {
            BuryPath::Official | BuryPath::Fallback => {
                // Official: process_bury does this cut inside the ORE program.
                // Fallback: we burn 90% ourselves and distribute 10%.
                self.ore_burned += burned as u128;
                self.ore_distributed += shared as u128;
            }
            BuryPath::HoldStakerShare => {
                self.ore_burned += burned as u128;
                self.staker_escrow += shared;
            }
        }
        (burned, shared)
    }

    /// `withdraw`. Signer must be the depositor. Principal only.
    /// Unharvested yield stays in the vault. `as_usdc` swaps back only if the
    /// pool fills inside the slippage cap.
    pub fn withdraw(&mut self, signer: &str, as_usdc: bool) -> Result<(), Error> {
        if signer != "depositor" {
            return Err(Error::NotAuthority);
        }
        let price = self.require_price()?;
        if as_usdc && self.pool_slippage_bps > self.config.slippage_cap_bps {
            return Err(Error::SlippageExceeded);
        }
        let Some(vault) = self.vault.as_mut() else {
            return Err(Error::NoVault);
        };
        let atoms = principal_atoms(vault.principal_value, vault.usdy_balance, price);
        vault.usdy_balance -= atoms;
        vault.principal_value = 0;
        vault.shares = 0;
        vault.price_snapshot = price;
        let authority = vault.authority.clone();
        if as_usdc {
            let usdc = swap_usdy_to_usdc(atoms, price, self.pool_slippage_bps).map_err(|_| Error::Math)?;
            self.depositor.usdc += usdc;
            self.events.push(Event::Withdrawn {
                authority,
                usdy_out: 0,
                usdc_out: usdc,
            });
        } else {
            self.depositor.usdy += atoms;
            self.events.push(Event::Withdrawn {
                authority,
                usdy_out: atoms,
                usdc_out: 0,
            });
        }
        Ok(())
    }

    pub fn close(&mut self, signer: &str) -> Result<(), Error> {
        if signer != "depositor" {
            return Err(Error::NotAuthority);
        }
        let Some(vault) = &self.vault else {
            return Err(Error::NoVault);
        };
        if vault.usdy_balance > 0 || vault.principal_value > 0 {
            return Err(Error::NotEmpty);
        }
        self.vault = None;
        Ok(())
    }

    pub fn propose(&mut self, signer: &str, builder_fee_bps: u64, slippage_cap_bps: u64) -> Result<(), Error> {
        if signer != self.config.authority {
            return Err(Error::NotAuthority);
        }
        if builder_fee_bps > BPS || slippage_cap_bps > BPS {
            return Err(Error::FeeBps);
        }
        // There is no depositor field. Calling the guard keeps the floor tested
        // at the boundary a future patch would have to pass.
        guard_depositor_bps(DEPOSITOR_YIELD_BPS).map_err(|_| Error::DepositorShareLocked)?;
        self.pending = Some(PendingConfig {
            builder: self.config.builder.clone(),
            slippage_cap_bps,
            builder_fee_bps,
            eta: self.clock + self.config.timelock_secs,
        });
        Ok(())
    }

    pub fn apply_config(&mut self, signer: &str) -> Result<(), Error> {
        if signer != self.config.authority {
            return Err(Error::NotAuthority);
        }
        let Some(pending) = self.pending.clone() else {
            return Err(Error::NoPendingConfig);
        };
        if self.clock < pending.eta {
            return Err(Error::TimelockNotElapsed);
        }
        self.config.builder_fee_bps = pending.builder_fee_bps;
        self.config.slippage_cap_bps = pending.slippage_cap_bps;
        self.config.builder = pending.builder;
        self.pending = None;
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HarvestOutcome {
    Paid,
    SkippedPaused,
    SkippedSlippage,
    SkippedNoYield,
}
