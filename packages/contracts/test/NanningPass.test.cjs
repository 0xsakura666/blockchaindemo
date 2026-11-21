const { expect } = require("chai");
const { ethers } = require("hardhat");

const id = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const PassType = { Product: 0, Ticket: 1, RaceEntry: 2, FinisherCert: 3, CheckinBadge: 4 };

describe("NanningRegistry + NanningPass", () => {
  let owner, platform, player, other, registry, pass;
  const shop = id("merchant:laoyoufen");

  beforeEach(async () => {
    [owner, platform, player, other] = await ethers.getSigners();
    registry = await (await ethers.getContractFactory("NanningRegistry")).deploy(platform.address);
    pass = await (await ethers.getContractFactory("NanningPass")).deploy(
      await registry.getAddress(),
      platform.address,
      "https://demo/api/passes/meta/{id}"
    );
    await registry.connect(platform).registerMerchant(shop, 0, other.address, id("meta"));
  });

  it("只有平台角色可以登记商家", async () => {
    await expect(registry.connect(player).registerMerchant(id("x"), 0, player.address, id("m"))).to.be.reverted;
    expect(await registry.isActive(shop)).to.equal(true);
  });

  it("订单存证只能写一次", async () => {
    await expect(pass.connect(platform).anchorOrder(id("order-1"), shop, id("data")))
      .to.emit(pass, "OrderAnchored")
      .withArgs(id("order-1"), shop, id("data"));
    expect(await pass.orderAnchors(id("order-1"))).to.equal(id("data"));
    await expect(pass.connect(platform).anchorOrder(id("order-1"), shop, id("data2"))).to.be.revertedWith(
      "Pass: order already anchored"
    );
  });

  it("发放凭证 -> 核销一次 -> 重复核销失败", async () => {
    await expect(pass.connect(platform).mintPass(player.address, PassType.Product, shop, id("order-1"), 0))
      .to.emit(pass, "PassIssued");
    expect(await pass.balanceOf(player.address, 1)).to.equal(1n);
    await expect(pass.connect(platform).redeem(1, id("merchant:other"))).to.be.revertedWith("Pass: wrong merchant");
    await expect(pass.connect(platform).redeem(1, shop)).to.emit(pass, "PassRedeemed");
    const p = await pass.getPass(1);
    expect(p.redeemedAt).to.not.equal(0n);
    await expect(pass.connect(platform).redeem(1, shop)).to.be.revertedWith("Pass: already redeemed");
  });

  it("凭证不可转让、不可授权", async () => {
    await pass.connect(platform).mintPass(player.address, PassType.Ticket, shop, id("order-2"), 0);
    await expect(
      pass.connect(player).safeTransferFrom(player.address, other.address, 1, 1, "0x")
    ).to.be.revertedWith("Pass: non-transferable");
    await expect(pass.connect(player).setApprovalForAll(other.address, true)).to.be.revertedWith(
      "Pass: non-transferable"
    );
  });

  it("证书/徽章不可核销，商家停用后不能再发凭证", async () => {
    await pass.connect(platform).mintPass(player.address, PassType.CheckinBadge, ethers.ZeroHash, id("task"), 0);
    await expect(pass.connect(platform).redeem(1, shop)).to.be.revertedWith("Pass: not redeemable");
    await registry.connect(platform).setStatus(shop, 2);
    await expect(
      pass.connect(platform).mintPass(player.address, PassType.Product, shop, id("order-3"), 0)
    ).to.be.revertedWith("Pass: merchant not active");
  });

  it("过期凭证不能核销", async () => {
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await pass.connect(platform).mintPass(player.address, PassType.Ticket, shop, id("order-4"), now + 60);
    await ethers.provider.send("evm_increaseTime", [120]);
    await ethers.provider.send("evm_mine", []);
    await expect(pass.connect(platform).redeem(1, shop)).to.be.revertedWith("Pass: expired");
  });
});
