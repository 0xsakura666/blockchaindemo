// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title 网上南宁 · 商家 / 景区 / 赛事主办方 登记合约
/// @notice 链上只记录"谁被平台审核通过、当前状态、资料哈希"，不记录任何个人信息和资金。
contract NanningRegistry is AccessControl {
    bytes32 public constant PLATFORM_ROLE = keccak256("PLATFORM_ROLE");

    enum Status { None, Active, Suspended }
    enum Kind { Merchant, Scenic, EventOrganizer }

    struct Merchant {
        Status status;
        Kind kind;
        address account;   // 平台为商家托管的链账户（仅用于展示与追溯）
        bytes32 metaHash;  // 入驻资料（营业执照号、店名等）链下 JSON 的 keccak256
        uint64 updatedAt;
    }

    mapping(bytes32 => Merchant) private _merchants;
    bytes32[] private _ids;

    event MerchantRegistered(bytes32 indexed merchantId, Kind kind, address account, bytes32 metaHash);
    event MerchantStatusChanged(bytes32 indexed merchantId, Status status);

    constructor(address platform) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PLATFORM_ROLE, platform);
    }

    function registerMerchant(bytes32 merchantId, Kind kind, address account, bytes32 metaHash)
        external
        onlyRole(PLATFORM_ROLE)
    {
        require(merchantId != bytes32(0), "Registry: empty id");
        require(_merchants[merchantId].status == Status.None, "Registry: already registered");
        _merchants[merchantId] = Merchant(Status.Active, kind, account, metaHash, uint64(block.timestamp));
        _ids.push(merchantId);
        emit MerchantRegistered(merchantId, kind, account, metaHash);
    }

    function setStatus(bytes32 merchantId, Status status) external onlyRole(PLATFORM_ROLE) {
        require(_merchants[merchantId].status != Status.None, "Registry: unknown merchant");
        require(status != Status.None, "Registry: invalid status");
        _merchants[merchantId].status = status;
        _merchants[merchantId].updatedAt = uint64(block.timestamp);
        emit MerchantStatusChanged(merchantId, status);
    }

    function getMerchant(bytes32 merchantId) external view returns (Merchant memory) {
        return _merchants[merchantId];
    }

    function isActive(bytes32 merchantId) external view returns (bool) {
        return _merchants[merchantId].status == Status.Active;
    }

    function merchantCount() external view returns (uint256) {
        return _ids.length;
    }
}
