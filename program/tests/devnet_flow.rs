//! Devnet-shaped test. USDC is swapped to mocked unlocked USDY, a mocked price
//! advances, harvest pays 90% of yield as stORE, 2% of yield to the builder,
//! and buries the rest. Withdrawal returns principal. A paused price skips
//! harvest. The US path has no USDC swap.

use yiebury::*;

fn replay_ten_thousand() -> World {
    let mut w = World::devnet();
    w.deposit_usdc(false, 10_000_000_000).unwrap();
    w.price.micro = 1_035_500;
    w.harvest("crank").unwrap();
    w
}

#[test]
fn deposits_harvests_and_withdraws_principal() {
    let mut w = replay_ten_thousand();
    let vault = w.vault.clone().unwrap();
    let harvested = w.events.iter().find_map(|e| match e {
        Event::Harvested {
            usdy_sold,
            store_paid,
            builder_fee_usdy,
            ore_burned,
            ore_distributed,
            ore_bought,
            wrap_failed,
            ..
        } => Some((
            *usdy_sold,
            *store_paid,
            *builder_fee_usdy,
            *ore_burned,
            *ore_distributed,
            *ore_bought,
            *wrap_failed,
        )),
        _ => None,
    });
    let (sold, store_paid, builder_fee, burned, shared, bought, wrap_failed) = harvested.unwrap();
    assert!(!wrap_failed);

    let split = split_yield(sold, DEFAULT_BUILDER_FEE_BPS).unwrap();
    assert_eq!(builder_fee, split.builder);
    assert_eq!(w.builder_wallet.usdy, split.builder);
    assert_eq!(split.depositor + split.builder + split.bury, sold);

    let depositor_value = value_micro(split.depositor, 1_035_500);
    let builder_value = value_micro(split.builder, 1_035_500);
    let bury_value = value_micro(split.bury, 1_035_500);
    let yield_value = 355_000_000u128;
    assert!(depositor_value * 10_000 >= yield_value * 9_000 - 2_000_000);
    assert!((builder_value as i128 - yield_value as i128 * 2 / 100).abs() < 80_000);
    assert!((bury_value as i128 - yield_value as i128 * 8 / 100).abs() < 80_000);
    assert!((depositor_value as i128 - 319_500_000).abs() < 2_000_000);
    assert!((builder_value as i128 - 7_100_000).abs() < 50_000);
    assert!((bury_value as i128 - 28_400_000).abs() < 50_000);

    let ore_depositor = ore_bought(split.depositor, 1_035_500, w.ore_price, 0).unwrap();
    let ore_bury = ore_bought(split.bury, 1_035_500, w.ore_price, 0).unwrap();
    assert_eq!(store_paid, wrap_store(ore_depositor, 0, 0));
    assert_eq!(w.depositor.store, store_paid);
    assert_eq!(w.depositor.ore, 0, "raw ORE is not kept on a successful wrap");
    let (expect_burn, expect_share) = bury_cut(ore_bury);
    assert_eq!(burned, expect_burn);
    assert_eq!(shared, expect_share);
    assert_eq!(bought, ore_depositor + ore_bury);
    assert_eq!(w.ore_burned, burned as u128);
    assert_eq!(vault.ore_buried, burned);
    assert_eq!(w.builder_wallet.ore, 0);
    assert_eq!(w.builder_wallet.store, 0);
    assert!(shared > 0);
    assert_ne!(shared, w.builder_wallet.usdy);

    let principal_before = 10_000_000_000u128;
    w.withdraw("depositor", false).unwrap();
    let withdrawn = w.depositor.usdy;
    let withdrawn_value = value_micro(withdrawn, 1_035_500);
    let gap = if withdrawn_value > principal_before {
        withdrawn_value - principal_before
    } else {
        principal_before - withdrawn_value
    };
    assert!(gap <= value_micro(1, 1_035_500) + 1);
    assert_eq!(w.vault.as_ref().unwrap().principal_value, 0);
    w.close("depositor").unwrap();
    assert!(w.vault.is_none());
}

#[test]
fn paused_price_skips_harvest() {
    let mut w = World::devnet();
    w.deposit_usdc(false, 10_000_000_000).unwrap();
    w.price.micro = 1_035_500;
    w.price.paused = true;
    assert_eq!(w.harvest("crank").unwrap(), HarvestOutcome::SkippedPaused);
    assert_eq!(w.depositor.store, 0);
    assert_eq!(w.builder_wallet.usdy, 0);
    assert_eq!(w.ore_burned, 0);
    assert_eq!(w.vault.as_ref().unwrap().usdy_balance, 10_000_000_000);
    w.price.paused = false;
    assert_eq!(w.harvest("crank").unwrap(), HarvestOutcome::Paid);
    assert!(w.depositor.store > 0);
}

#[test]
fn us_path_has_no_usdc_swap() {
    let mut w = World::devnet();
    let err = w.deposit_usdc(true, 10_000_000_000).unwrap_err();
    assert_eq!(err, Error::UsPersonCannotSwapUsdc);
    assert_eq!(w.usdc_swaps, 0);
    assert!(w.vault.is_none());
    w.depositor.usdy = 5_000_000_000;
    w.deposit_usdy(true, 5_000_000_000).unwrap();
    assert_eq!(w.usdc_swaps, 0);
    assert!(w.vault.as_ref().unwrap().us_person);
    assert_eq!(w.vault.as_ref().unwrap().usdy_balance, 5_000_000_000);
}

#[test]
fn slippage_above_cap_skips_harvest_and_blocks_usdc_withdraw() {
    let mut w = World::devnet();
    w.deposit_usdc(false, 10_000_000_000).unwrap();
    w.price.micro = 1_035_500;
    w.pool_slippage_bps = 150;
    assert_eq!(w.harvest("crank").unwrap(), HarvestOutcome::SkippedSlippage);
    assert_eq!(w.ore_burned, 0);
    let err = w.withdraw("depositor", true).unwrap_err();
    assert_eq!(err, Error::SlippageExceeded);
    w.withdraw("depositor", false).unwrap();
    assert!(w.depositor.usdy > 0);
}

#[test]
fn yield_left_behind_is_not_taken_on_withdraw() {
    let mut w = World::devnet();
    w.deposit_usdc(false, 10_000_000_000).unwrap();
    w.price.micro = 2_000_000;
    w.withdraw("depositor", false).unwrap();
    let vault = w.vault.as_ref().unwrap();
    assert_eq!(vault.principal_value, 0);
    assert!(vault.usdy_balance > 0, "unharvested yield stays");
    assert_eq!(w.harvest("someone-else").unwrap(), HarvestOutcome::Paid);
    assert!(w.depositor.store > 0);
    assert_eq!(w.builder_wallet.usdy > 0, true);
}

#[test]
fn fee_change_is_timelocked_and_cannot_cut_the_depositor() {
    let mut w = World::devnet();
    w.deposit_usdc(false, 10_000_000_000).unwrap();
    w.propose("builder", 5_000, 100).unwrap();
    w.price.micro = 1_035_500;
    w.harvest("crank").unwrap();
    let first_builder = w.builder_wallet.usdy;
    let split = split_yield(
        match w.events.iter().find_map(|e| match e {
            Event::Harvested { usdy_sold, .. } => Some(*usdy_sold),
            _ => None,
        }) {
            Some(v) => v,
            None => panic!("harvest"),
        },
        DEFAULT_BUILDER_FEE_BPS,
    )
    .unwrap();
    assert_eq!(first_builder, split.builder);
    assert!(w.apply_config("builder").is_err());
    w.withdraw("depositor", false).unwrap();
    w.clock += TIMELOCK_SECS;
    w.apply_config("builder").unwrap();
    assert_eq!(w.config.builder_fee_bps, 5_000);
    assert!(guard_depositor_bps(8_000).is_err());
    assert_eq!(DEPOSITOR_YIELD_BPS, 9_000);
}

#[test]
fn wrap_failure_sends_raw_ore_to_the_depositor() {
    let mut w = World::devnet();
    w.wrap_fails = true;
    w.deposit_usdc(false, 10_000_000_000).unwrap();
    w.price.micro = 1_035_500;
    w.harvest("crank").unwrap();
    assert_eq!(w.depositor.store, 0);
    assert!(w.depositor.ore > 0);
    assert_eq!(w.vault.as_ref().unwrap().wrap_failures, 1);
    assert_eq!(w.vault.as_ref().unwrap().raw_ore_received, w.depositor.ore);
}

#[test]
fn held_staker_share_is_not_sent_to_the_builder() {
    let mut w = World::devnet();
    w.bury_path = BuryPath::HoldStakerShare;
    w.deposit_usdc(false, 10_000_000_000).unwrap();
    w.price.micro = 1_035_500;
    w.harvest("crank").unwrap();
    assert!(w.staker_escrow > 0);
    assert_eq!(w.ore_distributed, 0);
    assert_eq!(w.builder_wallet.ore, 0);
    assert!(w.ore_burned > 0);
}

#[test]
fn stranger_cannot_withdraw() {
    let mut w = World::devnet();
    w.deposit_usdc(false, 1_000_000).unwrap();
    assert_eq!(w.withdraw("builder", false).unwrap_err(), Error::NotAuthority);
    assert_eq!(w.vault.as_ref().unwrap().usdy_balance, 1_000_000);
}
