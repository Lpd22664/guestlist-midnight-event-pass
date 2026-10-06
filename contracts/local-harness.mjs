import * as RT from '@midnight-ntwrk/compact-runtime';
import {
  Contract, PassStatus, ledger, pureCircuits,
} from './generated/event-pass/contract/index.js';

export { RT, Contract, PassStatus, ledger, pureCircuits };

/** Test-only deterministic bytes. NEVER use these values for real credentials. */
export const testBytes = (value) => new Uint8Array(32).fill(value);

export const witnesses = {
  issuerSecret: ({ privateState }) => [privateState, privateState.issuerSecret],
  bearerSecret: ({ privateState }) => [privateState, privateState.bearerSecret],
};

/**
 * Actual compiler-generated circuit execution. No node or proof server is
 * involved: success here is contract-logic verification, not a valid proof,
 * a signed transaction, consensus finality, or physical entry permission.
 */
export class LocalContractHarness {
  constructor({ eventId = testBytes(1), issuerSecret = testBytes(2), bearerSecret = testBytes(3) } = {}) {
    this.contract = new Contract(witnesses);
    this.address = RT.sampleContractAddress();
    this.coinPublicKey = '0'.repeat(64);
    this.privateState = { issuerSecret, bearerSecret };
    const initial = this.contract.initialState(
      RT.createConstructorContext(this.privateState, this.coinPublicKey),
      eventId,
      issuerSecret,
    );
    this.state = initial.currentContractState;
    this.eventId = eventId;
  }

  get ledger() { return ledger(this.state.data); }

  commitment(secret = this.privateState.bearerSecret) {
    return pureCircuits.derivePassCommitment(this.eventId, secret);
  }

  context(privateState = this.privateState) {
    return RT.createCircuitContext(this.address, this.coinPublicKey, this.state, privateState);
  }

  call(circuit, commitment, privateState = this.privateState) {
    const result = this.contract.impureCircuits[circuit](this.context(privateState), commitment);
    // Only adopt returned state on success. Assertion failures can't partially
    // update this harness's accepted state. Network finality is separate.
    this.state.data = result.context.currentQueryContext.state;
    this.privateState = result.context.currentPrivateState;
    return result;
  }
}
