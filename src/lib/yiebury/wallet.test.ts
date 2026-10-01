import assert from "node:assert/strict";
import test from "node:test";
import type { Wallet } from "@wallet-standard/base";
import { callInjectedConnect, callStandardConnect } from "./wallet.ts";

test("standard connect calls the wallet and returns its account", async () => {
  let called = false;
  const wallet = {
    version: "1.0.0",
    name: "Phantom",
    icon: "data:image/svg+xml;base64,AA==",
    chains: ["solana:mainnet"],
    accounts: [],
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async () => {
          called = true;
          return { accounts: [{ address: "11111111111111111111111111111111", chains: ["solana:mainnet"] }] };
        },
      },
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: async () => {},
      },
    },
  } as unknown as Wallet;
  const session = await callStandardConnect(wallet);
  assert.equal(called, true);
  assert.equal(session.address, "11111111111111111111111111111111");
  assert.equal(session.name, "Phantom");
});

test("injected connect calls provider.connect", async () => {
  let called = false;
  const session = await callInjectedConnect("Phantom", {
    isPhantom: true,
    connect: async () => {
      called = true;
      return { publicKey: { toBase58: () => "11111111111111111111111111111111", toString: () => "" } };
    },
  });
  assert.equal(called, true);
  assert.equal(session.address, "11111111111111111111111111111111");
});

test("a wallet with no connect method is not given an address", async () => {
  const wallet = {
    version: "1.0.0",
    name: "Empty",
    icon: "data:image/svg+xml;base64,AA==",
    chains: ["solana:mainnet"],
    accounts: [],
    features: {},
  } as unknown as Wallet;
  await assert.rejects(callStandardConnect(wallet), /no connect method/);
});
