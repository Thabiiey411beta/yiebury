//! Split math. The depositor's 90% is a constant. Only the fee's own cut is
//! configurable, and only inside that 10%.

/// Depositor's share of yield. Not stored on the config account.
/// A config change cannot lower it.
pub const DEPOSITOR_YIELD_BPS: u64 = 9_000;
/// Fee on yield. The other side of [`DEPOSITOR_YIELD_BPS`]. Immutable.
pub const FEE_BPS: u64 = 1_000;
pub const BPS: u64 = 10_000;
/// Default share of the *fee* (not of yield) paid to the builder. 20% of 10% = 2% of yield.
pub const DEFAULT_BUILDER_FEE_BPS: u64 = 2_000;
/// Default share of the fee handed to ORE bury. Always `BPS - builder_fee_bps`.
pub const DEFAULT_BURY_FEE_BPS: u64 = 8_000;

pub const USDY_DECIMALS: u32 = 6;
pub const USDC_DECIMALS: u32 = 6;
pub const ORE_DECIMALS: u32 = 11;
pub const ONE_USDY: u128 = 1_000_000;
pub const ONE_ORE: u128 = 100_000_000_000;

/// Micro-USD value of a USDY atom balance. Price is micro-USD per 1 whole USDY.
pub fn value_micro(usdy_atoms: u64, price_micro: u64) -> u128 {
    (usdy_atoms as u128) * (price_micro as u128) / ONE_USDY
}

/// USDY atoms needed to represent `value_micro` at `price_micro`. Rounds down.
pub fn usdy_for_value(value_micro: u128, price_micro: u64) -> u64 {
    if price_micro == 0 {
        return 0;
    }
    (value_micro * ONE_USDY / price_micro as u128) as u64
}

/// Principal atoms at the current price. Rounds up by at most one atom so the
/// depositor is not shorted a rounding dust of principal. Never exceeds `balance`.
pub fn principal_atoms(principal_value: u128, balance: u64, price_micro: u64) -> u64 {
    if price_micro == 0 || principal_value == 0 || balance == 0 {
        return 0;
    }
    let mut atoms = usdy_for_value(principal_value, price_micro);
    if value_micro(atoms, price_micro) < principal_value {
        atoms = atoms.saturating_add(1);
    }
    atoms.min(balance)
}

/// Yield atoms that may be sold. Rounds down. Never includes principal.
pub fn yield_atoms(balance: u64, principal_value: u128, price_micro: u64) -> u64 {
    if price_micro == 0 || balance == 0 {
        return 0;
    }
    let current = value_micro(balance, price_micro);
    if current <= principal_value {
        return 0;
    }
    let atoms = usdy_for_value(current - principal_value, price_micro);
    atoms.min(balance)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct YieldSplit {
    pub depositor: u64,
    pub fee: u64,
    pub builder: u64,
    pub bury: u64,
}

/// Fee is `yield * FEE_BPS / BPS` (rounds down). The depositor receives the
/// remainder, so their share is never rounded below 90%.
/// Builder is `fee * builder_fee_bps / BPS` (rounds down). The remainder of
/// the fee is the bury slice. Dust never moves from the depositor to the fee,
/// and never moves from bury to the builder.
pub fn split_yield(yield_atoms: u64, builder_fee_bps: u64) -> Result<YieldSplit, MathError> {
    if builder_fee_bps > BPS {
        return Err(MathError::FeeBps);
    }
    let fee = (yield_atoms as u128 * FEE_BPS as u128 / BPS as u128) as u64;
    let depositor = yield_atoms - fee;
    let builder = (fee as u128 * builder_fee_bps as u128 / BPS as u128) as u64;
    let bury = fee - builder;
    debug_assert!(depositor as u128 * BPS as u128 >= yield_atoms as u128 * DEPOSITOR_YIELD_BPS as u128);
    Ok(YieldSplit {
        depositor,
        fee,
        builder,
        bury,
    })
}

/// Rejects any attempt to configure the depositor below 90%.
pub fn guard_depositor_bps(bps: u64) -> Result<(), MathError> {
    if bps < DEPOSITOR_YIELD_BPS {
        Err(MathError::DepositorShareLocked)
    } else {
        Ok(())
    }
}

/// ORE atoms bought with a USDY slice. Slippage is taken out of this slice
/// only, after the percentage split, never by shrinking the depositor's share
/// to pay bury. `platformFeeBps` is not a parameter: Jupiter must be called
/// with no platform fee. The builder's cut was already transferred in USDY.
pub fn ore_bought(usdy_atoms: u64, usdy_price: u64, ore_price: u64, slippage_bps: u64) -> Result<u64, MathError> {
    if slippage_bps > BPS || ore_price == 0 {
        return Err(MathError::Slippage);
    }
    let gross = value_micro(usdy_atoms, usdy_price);
    let ideal = gross * ONE_ORE / ore_price as u128;
    let out = ideal * (BPS - slippage_bps) as u128 / BPS as u128;
    Ok(out as u64)
}

/// USDC (6 decimals, treated as $1) into unlocked USDY. Not an Ondo mint.
pub fn swap_usdc_to_usdy(usdc_atoms: u64, usdy_price: u64, slippage_bps: u64) -> Result<u64, MathError> {
    if usdy_price == 0 || slippage_bps > BPS {
        return Err(MathError::Slippage);
    }
    let ideal = (usdc_atoms as u128) * ONE_USDY / usdy_price as u128;
    Ok((ideal * (BPS - slippage_bps) as u128 / BPS as u128) as u64)
}

/// Unlocked USDY back to USDC. Used only for a principal withdrawal.
pub fn swap_usdy_to_usdc(usdy_atoms: u64, usdy_price: u64, slippage_bps: u64) -> Result<u64, MathError> {
    if slippage_bps > BPS {
        return Err(MathError::Slippage);
    }
    let ideal = value_micro(usdy_atoms, usdy_price);
    Ok((ideal * (BPS - slippage_bps) as u128 / BPS as u128) as u64)
}

/// Same integer cut as `process_bury`: `shared = amount / 10`, burn the rest.
pub fn bury_cut(ore_atoms: u64) -> (u64, u64) {
    let shared = ore_atoms / 10;
    let burned = ore_atoms - shared;
    (burned, shared)
}

/// `ore-lst` `Vault::calculate_mint_amount`. Genesis (empty stake or supply) is 1:1.
pub fn wrap_store(ore_atoms: u64, stake_balance: u64, store_supply: u64) -> u64 {
    if stake_balance == 0 || store_supply == 0 {
        return ore_atoms;
    }
    ((ore_atoms as u128) * (store_supply as u128) / stake_balance as u128) as u64
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MathError {
    FeeBps,
    DepositorShareLocked,
    Slippage,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn depositor_is_never_rounded_below_ninety() {
        for yield_atoms in 0..20_000u64 {
            let split = split_yield(yield_atoms, DEFAULT_BUILDER_FEE_BPS).unwrap();
            assert!(
                split.depositor as u128 * BPS as u128 >= yield_atoms as u128 * DEPOSITOR_YIELD_BPS as u128,
                "yield {yield_atoms}"
            );
            assert_eq!(split.depositor + split.builder + split.bury, yield_atoms);
            assert_eq!(split.builder + split.bury, split.fee);
        }
    }

    #[test]
    fn ten_thousand_illustration_is_three_hundred_fifty_five_dollars() {
        let shares = 10_000_000_000u64;
        let p0 = 1_000_000u64;
        let p1 = 1_035_500u64;
        let principal = value_micro(shares, p0);
        let current = value_micro(shares, p1);
        assert_eq!(principal, 10_000_000_000);
        assert_eq!(current - principal, 355_000_000);
        let y = yield_atoms(shares, principal, p1);
        let split = split_yield(y, DEFAULT_BUILDER_FEE_BPS).unwrap();
        let depositor_value = value_micro(split.depositor, p1);
        let builder_value = value_micro(split.builder, p1);
        let bury_value = value_micro(split.bury, p1);
        // About $319, $7.10, $28.40. Exact cents from the integer split.
        assert!((depositor_value as i128 - 319_500_000).abs() < 2_000_000);
        assert!((builder_value as i128 - 7_100_000).abs() < 50_000);
        assert!((bury_value as i128 - 28_400_000).abs() < 50_000);
        assert!(guard_depositor_bps(8_999).is_err());
        assert!(guard_depositor_bps(9_000).is_ok());
    }
}
