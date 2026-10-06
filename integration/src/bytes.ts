/** Public commitment encodings only. Never call on an issuer/bearer/signing secret for logging. */
export function bytes32(value: Uint8Array, label = 'value'): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== 32 || value.every((byte) => byte === 0)) {
    throw new Error(`${label} must contain exactly 32 bytes and be nonzero`);
  }
  return value.slice();
}
export function publicHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}
export function publicBytes(hex: string): Uint8Array {
  if (!/^[a-f0-9]{64}$/.test(hex)) throw new Error('Expected a public 32-byte lowercase hex value');
  return Uint8Array.from(hex.match(/../g)!, (pair) => Number.parseInt(pair, 16));
}
export function publicAddress(address: string): string {
  if (!/^[a-fA-F0-9]{64}$/.test(address)) throw new Error('Expected a 32-byte contract address');
  return address.toLowerCase();
}
