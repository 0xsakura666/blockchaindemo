require("@nomicfoundation/hardhat-toolbox");

/**
 * BSN 武汉链基于 Ethereum v1.10.17（London 硬分叉），不支持 Shanghai 的 PUSH0。
 * 因此固定 solc 0.8.19 + evmVersion "london"，保证字节码可以直接部署到武汉链。
 */
module.exports = {
  solidity: {
    version: "0.8.19",
    settings: {
      evmVersion: "london",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: { hardfork: "london" },
    // BSN 开放联盟链门户 / BSN-DDC 平台方网关：RPC = 网关地址/api/<项目ID>/rpc
    bsnWuhan: {
      url: process.env.BSN_RPC_URL || "http://127.0.0.1:8545",
      chainId: process.env.BSN_CHAIN_ID ? Number(process.env.BSN_CHAIN_ID) : undefined,
      accounts: process.env.PLATFORM_PRIVATE_KEY ? [process.env.PLATFORM_PRIVATE_KEY] : [],
      httpHeaders: process.env.BSN_PROJECT_KEY ? { "x-api-key": process.env.BSN_PROJECT_KEY } : {},
    },
  },
};
