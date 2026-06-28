import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { BASE_FEE, Contract, Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { z } from 'zod';
import { env } from '@/server/config/env';
import { stellar } from '@/server/config/stellar';
import { db } from '@/server/db/client';
import { grantProposals, horizonEvents } from '@/server/db/schema';
import { fromError, ok } from '@/server/lib/http';
import { u64ScVal } from '@/server/lib/recehPoolContract';
import { getProposal } from '@/server/service/grant.service';
import { withdrawFromVault } from '@/server/service/vault.service';

export const dynamic = 'force-dynamic';

const schema = z.object({ proposalId: z.string().uuid().optional() });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await schema.parse(await req.json().catch(() => ({})));
    const proposal = await getProposal(id);
    if (proposal.status !== 'approved' && proposal.status !== 'voting') {
      throw new Error(
        `Proposal ${id} is not in an approved or voting state (current: ${proposal.status})`,
      );
    }

    if (!stellar.recehPoolContractId) {
      throw new Error('RecehPool contract id is not configured');
    }

    const vaultKeypair = Keypair.fromSecret(env.VAULT_SECRET_KEY);
    const op = new Contract(stellar.recehPoolContractId).call(
      'disburse_grant',
      u64ScVal(proposal.id),
    );

    const account = await stellar.soroban.getAccount(vaultKeypair.publicKey());
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: stellar.passphrase,
    })
      .addOperation(op)
      .setTimeout(180)
      .build();
    const prepared = await stellar.soroban.prepareTransaction(tx);
    prepared.sign(vaultKeypair);
    const sent = await stellar.soroban.sendTransaction(prepared);
    if (sent.status !== 'PENDING') {
      throw new Error(`Soroban RPC rejected the disburse: ${sent.status}`);
    }
    const hash = sent.hash;

    await withdrawFromVault(proposal.vaultId, proposal.requestedUsdc);

    const updated = await db
      .update(grantProposals)
      .set({ status: 'disbursed', disburseTxHash: hash })
      .where(eq(grantProposals.id, id))
      .returning();

    await db.insert(horizonEvents).values({
      vaultId: proposal.vaultId,
      proposalId: proposal.id,
      eventType: 'disburse',
      amount: proposal.requestedUsdc,
      label: `Grant disbursed (Soroban) to ${proposal.organization}`,
      txHash: hash,
    });

    return ok({ hash, proposal: updated[0]! });
  } catch (err) {
    return fromError(err);
  }
}