import {
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  type rpc,
  type xdr,
} from '@stellar/stellar-sdk';
import { AppError } from '@/server/lib/http';
import { stellar } from '@/server/config/stellar';

function contract(): Contract {
  if (!stellar.recehPoolContractId) {
    throw new AppError('INTERNAL', 'RecehPool contract id is not configured', 500);
  }
  return new Contract(stellar.recehPoolContractId);
}

const addrScVal = (g: string) => new Address(g).toScVal();
const i128ScVal = (stroops: string | bigint) =>
  nativeToScVal(typeof stroops === 'string' ? BigInt(stroops) : stroops, { type: 'i128' });
const u64ScVal = (n: string | number | bigint) =>
  nativeToScVal(typeof n === 'bigint' ? n : BigInt(n), { type: 'u64' });
const bytesN32ScVal = (hex32: string): xdr.ScVal => {
  const buf = Buffer.from(hex32.replace(/^0x/, ''), 'hex');
  if (buf.length !== 32) {
    throw new AppError('INVALID_INPUT', 'title_hash must be 32 bytes hex', 400);
  }
  return nativeToScVal(buf, { type: 'bytes' });
};

function hex32(input: string): string {
  const buf = Buffer.alloc(32);
  Buffer.from(input, 'utf8').copy(buf, 0, 0, Math.min(32, input.length));
  return buf.toString('hex');
}

async function loadSourceOrThrow(source: string) {
  try {
    return await stellar.soroban.getAccount(source);
  } catch {
    throw new AppError(
      'INVALID_INPUT',
      'Source account is not funded on Soroban RPC. Fund it with friendbot and retry.',
      400,
    );
  }
}

async function prepareInvokeXdr(source: string, op: xdr.Operation): Promise<string> {
  const account = await loadSourceOrThrow(source);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: stellar.passphrase,
  })
    .addOperation(op)
    .setTimeout(180)
    .build();

  try {
    const prepared = await stellar.soroban.prepareTransaction(tx);
    return prepared.toXDR();
  } catch (err) {
    throw new AppError(
      'INTERNAL',
      `Could not prepare the on-chain transaction: ${(err as Error).message ?? 'simulation failed'}`,
      502,
    );
  }
}

export interface DisbursePrepared {
  xdr: string;
  contractId: string;
  networkPassphrase: string;
  proposalId: string;
}

export async function buildDisburseXdr(params: {
  source: string;
  proposalId: string;
}): Promise<DisbursePrepared> {
  const op = contract().call('disburse_grant', u64ScVal(params.proposalId));
  const xdr = await prepareInvokeXdr(params.source, op);
  return {
    xdr,
    contractId: stellar.recehPoolContractId,
    networkPassphrase: stellar.passphrase,
    proposalId: params.proposalId,
  };
}

export interface RecordRoundupPrepared {
  xdr: string;
  contractId: string;
  networkPassphrase: string;
}

export async function buildRecordRoundupXdr(params: {
  contributor: string;
  muxedId: string;
  amountStroops: string;
}): Promise<RecordRoundupPrepared> {
  const op = contract().call(
    'record_roundup',
    addrScVal(params.contributor),
    u64ScVal(params.muxedId),
    i128ScVal(params.amountStroops),
  );
  const xdr = await prepareInvokeXdr(params.contributor, op);
  return {
    xdr,
    contractId: stellar.recehPoolContractId,
    networkPassphrase: stellar.passphrase,
  };
}

export interface VotePrepared {
  xdr: string;
  contractId: string;
  networkPassphrase: string;
}

export async function buildVoteXdr(params: {
  voter: string;
  proposalId: string;
  inFavor: boolean;
}): Promise<VotePrepared> {
  const op = contract().call(
    'vote',
    addrScVal(params.voter),
    u64ScVal(params.proposalId),
    nativeToScVal(params.inFavor),
  );
  const xdr = await prepareInvokeXdr(params.voter, op);
  return {
    xdr,
    contractId: stellar.recehPoolContractId,
    networkPassphrase: stellar.passphrase,
  };
}

export interface CreateGrantPrepared {
  xdr: string;
  contractId: string;
  networkPassphrase: string;
}

export async function buildCreateGrantXdr(params: {
  proposer: string;
  recipient: string;
  amountStroops: string;
  titleHashHex32: string;
}): Promise<CreateGrantPrepared> {
  const op = contract().call(
    'create_grant',
    addrScVal(params.proposer),
    addrScVal(params.recipient),
    i128ScVal(params.amountStroops),
    bytesN32ScVal(params.titleHashHex32),
  );
  const xdr = await prepareInvokeXdr(params.proposer, op);
  return {
    xdr,
    contractId: stellar.recehPoolContractId,
    networkPassphrase: stellar.passphrase,
  };
}

const POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 2000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SubmitResult {
  hash: string;
  returnValue: unknown;
}

export async function submitSignedInvoke(signedXdr: string): Promise<SubmitResult> {
  let tx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    tx = TransactionBuilder.fromXDR(signedXdr, stellar.passphrase);
  } catch {
    throw new AppError('INVALID_INPUT', 'Could not decode the signed transaction', 400);
  }

  let sent: rpc.Api.SendTransactionResponse | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    sent = await stellar.soroban.sendTransaction(tx);
    if (sent.status === 'PENDING') break;
    if (sent.status === 'TRY_AGAIN_LATER') {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    const codes = JSON.stringify(sent.errorResult?.result() ?? sent.status);
    if (codes.includes('txBadSeq') || codes.includes('tx_bad_seq')) {
      throw new AppError('CONFLICT', 'Wallet sequence changed — please retry.', 409);
    }
    if (codes.includes('txInsufficientBalance') || codes.includes('underfunded')) {
      throw new AppError('CONFLICT', 'Insufficient balance to complete this transaction.', 409);
    }
    throw new AppError('INTERNAL', `RPC rejected the transaction (${sent.status}).`, 502);
  }
  if (!sent || sent.status !== 'PENDING') {
    throw new AppError('INTERNAL', 'RPC did not accept the transaction. Please retry.', 502);
  }

  const hash = sent.hash;
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    const res = await stellar.soroban.getTransaction(hash);
    if (res.status === 'SUCCESS') {
      let returnValue: unknown = null;
      try {
        if (res.returnValue) returnValue = scValToNative(res.returnValue);
      } catch {
        returnValue = null;
      }
      return { hash, returnValue };
    }
    if (res.status === 'FAILED') {
      throw new AppError(
        'INTERNAL',
        'The on-chain transaction failed. No funds moved. Please retry.',
        502,
      );
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new AppError('INTERNAL', 'Timed out waiting for the transaction to settle.', 504);
}

const READ_SOURCE = 'GBL5RJKF4QNJ4ZPLJZ7PS7K5A4J44VEZJRV2CRTFFDRVSY2N76AIIE47';

export async function readTotalPool(): Promise<string> {
  try {
    const account = await stellar.soroban.getAccount(READ_SOURCE);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: stellar.passphrase,
    })
      .addOperation(contract().call('get_total_pool'))
      .setTimeout(60)
      .build();
    const sim = await stellar.soroban.simulateTransaction(tx);
    if ('result' in sim && sim.result?.retval) {
      return (scValToNative(sim.result.retval) as bigint).toString();
    }
    console.warn('[recehPoolContract] readTotalPool simulation had no retval');
    return '0';
  } catch (e) {
    console.error('[recehPoolContract] readTotalPool failed', e);
    throw e;
  }
}

export async function readAvailable(): Promise<string> {
  try {
    const account = await stellar.soroban.getAccount(READ_SOURCE);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: stellar.passphrase,
    })
      .addOperation(contract().call('get_available'))
      .setTimeout(60)
      .build();
    const sim = await stellar.soroban.simulateTransaction(tx);
    if ('result' in sim && sim.result?.retval) {
      return (scValToNative(sim.result.retval) as bigint).toString();
    }
    console.warn('[recehPoolContract] readAvailable simulation had no retval');
    return '0';
  } catch (e) {
    console.error('[recehPoolContract] readAvailable failed', e);
    throw e;
  }
}

export async function readMemberCount(): Promise<number> {
  try {
    const account = await stellar.soroban.getAccount(READ_SOURCE);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: stellar.passphrase,
    })
      .addOperation(contract().call('get_member_count'))
      .setTimeout(60)
      .build();
    const sim = await stellar.soroban.simulateTransaction(tx);
    if ('result' in sim && sim.result?.retval) {
      return Number(scValToNative(sim.result.retval));
    }
    console.warn('[recehPoolContract] readMemberCount simulation had no retval');
    return 0;
  } catch (e) {
    console.error('[recehPoolContract] readMemberCount failed', e);
    throw e;
  }
}

export async function readProposal(id: string) {
  try {
    const account = await stellar.soroban.getAccount(READ_SOURCE);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: stellar.passphrase,
    })
      .addOperation(contract().call('get_proposal', u64ScVal(id)))
      .setTimeout(60)
      .build();
    const sim = await stellar.soroban.simulateTransaction(tx);
    if ('result' in sim && sim.result?.retval) {
      const native = scValToNative(sim.result.retval) as Record<string, unknown>;
      return native;
    }
    console.warn(`[recehPoolContract] readProposal(${id}) simulation had no retval`);
    return null;
  } catch (e) {
    console.error(`[recehPoolContract] readProposal(${id}) failed`, e);
    throw e;
  }
}

export { addrScVal, i128ScVal, u64ScVal, bytesN32ScVal, hex32 };