// 把编译产物（ABI + 字节码）导出到 packages/contracts/abi/*.json，供 server 运行时直接部署/调用，
// 这样生产环境不需要安装 hardhat。
const fs = require("fs");
const path = require("path");
const out = path.join(__dirname, "..", "abi");
fs.mkdirSync(out, { recursive: true });
for (const name of ["NanningRegistry", "NanningPass"]) {
  const art = require(path.join(__dirname, "..", "artifacts", "contracts", `${name}.sol`, `${name}.json`));
  fs.writeFileSync(
    path.join(out, `${name}.json`),
    JSON.stringify({ contractName: name, abi: art.abi, bytecode: art.bytecode, compiler: "solc 0.8.19 / evm london" }, null, 2)
  );
  console.log(`exported abi/${name}.json (${(art.bytecode.length - 2) / 2} bytes)`);
}
