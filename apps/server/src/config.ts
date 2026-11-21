export type ChainMode = 'local' | 'bsn';

const env = process.env;

export const config = {
  port: Number(env.PORT || 8787),
  chainMode: (env.CHAIN_MODE === 'bsn' ? 'bsn' : 'local') as ChainMode,
  rpcUrl: env.CHAIN_RPC_URL || '',
  chainId: Number(env.CHAIN_ID || (env.CHAIN_MODE === 'bsn' ? 5555 : 1337)),
  bsnProjectKey: env.BSN_PROJECT_KEY || '',
  platformKey: env.PLATFORM_PRIVATE_KEY || '',
  registryAddress: env.REGISTRY_ADDRESS || '',
  passAddress: env.PASS_ADDRESS || '',
  gasPriceWei: BigInt(env.GAS_PRICE_WEI || '1000000000'),
  explorerTxUrl: env.EXPLORER_TX_URL || 'https://wuhanexplorer.bsnbase.com/',
  custodySalt: env.CUSTODY_SALT || 'nanning-demo-salt',
  gameHmacSecret: env.GAME_HMAC_SECRET || '',
  dataDir: env.DATA_DIR || './data',
  localChainPort: Number(env.LOCAL_CHAIN_PORT || 8545),
  publicBaseUrl: env.PUBLIC_BASE_URL || '',
};
