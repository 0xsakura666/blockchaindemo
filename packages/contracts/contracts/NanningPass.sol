// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

interface INanningRegistry {
    function isActive(bytes32 merchantId) external view returns (bool);
}

/// @title 网上南宁 · 不可转让电子凭证（门票 / 商品凭证 / 参赛凭证 / 完赛证书 / 打卡徽章）
/// @notice
///  - 凭证是"权益记录"，不是代币：不可转让、不可授权、没有价格，只能由平台铸造、由商家核销。
///  - 订单只上链存证哈希（anchorOrder），不涉及任何资金转移。
///  - 玩家链上地址由平台托管，能量值（gas）由平台用人民币在 BSN 充值后统一支付。
contract NanningPass is ERC1155, AccessControl {
    bytes32 public constant PLATFORM_ROLE = keccak256("PLATFORM_ROLE");

    enum PassType { Product, Ticket, RaceEntry, FinisherCert, CheckinBadge }

    struct Pass {
        PassType passType;
        bool redeemable;      // 门票/商品/参赛凭证可核销；证书/徽章仅作纪念与证明
        uint64 issuedAt;
        uint64 validUntil;    // 0 = 不过期
        uint64 redeemedAt;    // 0 = 未核销
        bytes32 merchantId;   // 发放方（证书/徽章可为 0 = 平台）
        bytes32 orderHash;    // 关联订单/任务的链下数据哈希
        bytes32 redeemedBy;   // 核销商家
    }

    INanningRegistry public immutable registry;
    uint256 public nextTokenId = 1;

    mapping(uint256 => Pass) private _passes;
    mapping(uint256 => address) public holderOf;
    mapping(bytes32 => bytes32) public orderAnchors;     // orderId => dataHash
    mapping(bytes32 => bytes32) public orderMerchant;    // orderId => merchantId

    event PassIssued(
        uint256 indexed tokenId,
        address indexed to,
        PassType passType,
        bytes32 indexed merchantId,
        bytes32 orderHash,
        uint64 validUntil
    );
    event PassRedeemed(uint256 indexed tokenId, bytes32 indexed merchantId, uint64 redeemedAt);
    event OrderAnchored(bytes32 indexed orderId, bytes32 indexed merchantId, bytes32 dataHash);

    constructor(address registry_, address platform, string memory uri_) ERC1155(uri_) {
        registry = INanningRegistry(registry_);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PLATFORM_ROLE, platform);
    }

    // ------------------------------------------------------------------ 订单存证

    function anchorOrder(bytes32 orderId, bytes32 merchantId, bytes32 dataHash) external onlyRole(PLATFORM_ROLE) {
        require(orderId != bytes32(0) && dataHash != bytes32(0), "Pass: empty anchor");
        require(orderAnchors[orderId] == bytes32(0), "Pass: order already anchored");
        require(registry.isActive(merchantId), "Pass: merchant not active");
        orderAnchors[orderId] = dataHash;
        orderMerchant[orderId] = merchantId;
        emit OrderAnchored(orderId, merchantId, dataHash);
    }

    // ------------------------------------------------------------------ 发放与核销

    function mintPass(
        address to,
        PassType passType,
        bytes32 merchantId,
        bytes32 orderHash,
        uint64 validUntil
    ) external onlyRole(PLATFORM_ROLE) returns (uint256 tokenId) {
        bool redeemable = passType == PassType.Product || passType == PassType.Ticket || passType == PassType.RaceEntry;
        if (redeemable || merchantId != bytes32(0)) {
            require(registry.isActive(merchantId), "Pass: merchant not active");
        }
        require(validUntil == 0 || validUntil > block.timestamp, "Pass: already expired");

        tokenId = nextTokenId++;
        _passes[tokenId] = Pass({
            passType: passType,
            redeemable: redeemable,
            issuedAt: uint64(block.timestamp),
            validUntil: validUntil,
            redeemedAt: 0,
            merchantId: merchantId,
            orderHash: orderHash,
            redeemedBy: bytes32(0)
        });
        holderOf[tokenId] = to;
        _mint(to, tokenId, 1, "");
        emit PassIssued(tokenId, to, passType, merchantId, orderHash, validUntil);
    }

    /// @notice 商家核销（商家链账户由平台托管，因此由平台代为提交，链上记录核销商家 ID）
    function redeem(uint256 tokenId, bytes32 merchantId) external onlyRole(PLATFORM_ROLE) {
        Pass storage p = _passes[tokenId];
        require(p.issuedAt != 0, "Pass: unknown pass");
        require(p.redeemable, "Pass: not redeemable");
        require(p.redeemedAt == 0, "Pass: already redeemed");
        require(p.validUntil == 0 || block.timestamp <= p.validUntil, "Pass: expired");
        require(p.merchantId == merchantId, "Pass: wrong merchant");
        require(registry.isActive(merchantId), "Pass: merchant not active");
        p.redeemedAt = uint64(block.timestamp);
        p.redeemedBy = merchantId;
        emit PassRedeemed(tokenId, merchantId, p.redeemedAt);
    }

    function getPass(uint256 tokenId) external view returns (Pass memory) {
        return _passes[tokenId];
    }

    // ------------------------------------------------------------------ 不可转让

    function setApprovalForAll(address, bool) public pure override {
        revert("Pass: non-transferable");
    }

    function _beforeTokenTransfer(
        address operator,
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) internal override {
        require(from == address(0) || to == address(0), "Pass: non-transferable");
        super._beforeTokenTransfer(operator, from, to, ids, amounts, data);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
