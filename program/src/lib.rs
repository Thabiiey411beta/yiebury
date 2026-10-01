//! YieBury instruction processor.
//!
//! The on-chain account layout and CPI order live next to the processor that
//! the devnet test actually runs. There is no Solana BPF toolchain in this
//! workspace, so the processor is pure Rust behind a `Host` the test mocks
//! (unlocked USDY pool, price, bury, wrap). The same functions are what a
//! later BPF entrypoint must call. It must not grow a second copy of the split.

mod engine;
mod math;

pub use engine::*;
pub use math::*;
