// 部署到 BSN 武汉链：
//   BSN_RPC_URL=https://<网关>/api/<项目ID>/rpc PLATFORM_PRIVATE_KEY=0x... npm run deploy:bsn
// 部署完把输出的两个地址填到 server 的 REGISTRY_ADDRESS / PASS_ADDRESS 环境变量。
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const net = await hre.ethers.provider.getNetwork();
  console.log(`network chainId=${net.chainId} deployer=${deployer.address}`);
  const uri = process.env.PASS_METADATA_URI || "https://example.com/api/passes/meta/{id}";
  const Registry = await hre.ethers.getContractFactory("NanningRegistry");
  const registry = await Registry.deploy(deployer.address);
  await registry.waitForDeployment();
  const Pass = await hre.ethers.getContractFactory("NanningPass");
  const pass = await Pass.deploy(await registry.getAddress(), deployer.address, uri);
  await pass.waitForDeployment();
  console.log(`REGISTRY_ADDRESS=${await registry.getAddress()}`);
  console.log(`PASS_ADDRESS=${await pass.getAddress()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
