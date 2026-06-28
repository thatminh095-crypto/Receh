import { Horizon, Networks, rpc } from '@stellar/stellar-sdk';
import { env } from './env';

const networkMap = {
  testnet: {
    passphrase: Networks.TESTNET,
    horizonUrl: 'https://horizon-testnet.stellar.org',
  },
  public: {
    passphrase: Networks.PUBLIC,
    horizonUrl: 'https://horizon.stellar.org',
  },
  futurenet: {
    passphrase: Networks.FUTURENET,
    horizonUrl: 'https://horizon-futurenet.stellar.org',
  },
} as const;

const cfg = networkMap[env.STELLAR_NETWORK];

export const stellar = {
  passphrase: cfg.passphrase,
  horizonUrl: cfg.horizonUrl,
  network: env.STELLAR_NETWORK,
  rpcUrl: env.SOROBAN_RPC_URL,
  server: new Horizon.Server(cfg.horizonUrl),
  soroban: new rpc.Server(env.SOROBAN_RPC_URL, {
    allowHttp: env.SOROBAN_RPC_URL.startsWith('http://'),
  }),
  usdcAssetCode: env.USDC_ASSET_CODE,
  usdcIssuer: env.USDC_ASSET_ISSUER_TESTNET,
  recehPoolContractId: env.RECEH_POOL_CONTRACT_ID,
  usdcSacContractId: env.USDC_SAC_CONTRACT_ID,
} as const;