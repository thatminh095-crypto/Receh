import { Asset, BASE_FEE, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { env } from '@/server/config/env';
import { stellar } from '@/server/config/stellar';

export async function payFromVault(recipientAddress: string, amount: string): Promise<string> {
  const vaultKeypair = Keypair.fromSecret(env.VAULT_SECRET_KEY);
  const account = await stellar.server.loadAccount(vaultKeypair.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: stellar.passphrase,
  })
    .addOperation(
      Operation.payment({ destination: recipientAddress, asset: Asset.native(), amount }),
    )
    .setTimeout(60)
    .build();
  tx.sign(vaultKeypair);
  const result = await stellar.server.submitTransaction(tx);
  return result.hash;
}
