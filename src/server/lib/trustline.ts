import { Asset, BASE_FEE, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { stellar } from '@/server/config/stellar';
import { AppError } from '@/server/lib/http';

export type UsdcAsset = {
  code: string;
  issuer: string;
};

export async function buildChangeTrustTx(publicKey: string, asset: UsdcAsset): Promise<string> {
  if (!publicKey || !publicKey.startsWith('G') || publicKey.length !== 56) {
    throw new AppError('INVALID_PUBLIC_KEY', 'Invalid Stellar public key', 400);
  }
  let account;
  try {
    account = await stellar.server.loadAccount(publicKey);
  } catch (err) {
    throw new AppError(
      'NOT_FOUND',
      err instanceof Error ? `Could not load account: ${err.message}` : 'Could not load account',
      404,
    );
  }
  const assetObj = new Asset(asset.code, asset.issuer);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: stellar.passphrase,
  })
    .addOperation(Operation.changeTrust({ asset: assetObj }))
    .setTimeout(60)
    .build();
  return tx.toXDR();
}