import { Horizon, Networks } from '@stellar/stellar-sdk';
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
  server: new Horizon.Server(cfg.horizonUrl),
  usdcAssetCode: env.USDC_ASSET_CODE,
  usdcIssuer: env.USDC_ASSET_ISSUER_TESTNET,
} as const;
