const MICRO = 1_000_000n;

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatUsd(micro: bigint, cents = 2): string {
  const neg = micro < 0n;
  const v = neg ? -micro : micro;
  const whole = v / MICRO;
  const fracFull = (v % MICRO).toString().padStart(6, "0");
  const frac = fracFull.slice(0, cents);
  return `${neg ? "-" : ""}$${group(whole.toString())}.${frac}`;
}

export function formatAtoms(atoms: bigint, decimals: number, maxFrac = 4): string {
  const neg = atoms < 0n;
  const v = neg ? -atoms : atoms;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  let frac = (v % base).toString().padStart(decimals, "0").slice(0, maxFrac);
  frac = frac.replace(/0+$/, "");
  const body = frac.length > 0 ? `${group(whole.toString())}.${frac}` : group(whole.toString());
  return neg ? `-${body}` : body;
}

export function formatPrice(micro: bigint): string {
  return formatUsd(micro, 6).replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

export function parseAtoms(input: string, decimals: number): bigint | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > decimals) return null;
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
}
