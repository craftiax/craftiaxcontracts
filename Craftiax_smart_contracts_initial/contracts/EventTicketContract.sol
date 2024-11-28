// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract EventTicketContract is ERC1155, Ownable, ReentrancyGuard {
    struct EventTier {
        uint256 price;
        uint256 maxQuantity;
        uint256 soldCount;
        bool isActive;
    }

    struct Event {
        address creator;
        string eventId;
        mapping(string => EventTier) tiers;
        bool isActive;
        uint256 totalTiers;
        bool commissionActive;
        uint256 commissionPercentage; // e.g., 5 means 5%
        address commissionAddress;
        string[] tierIds;
    }

    mapping(string => Event) private events;

    event EventCreated(string eventId, address creator);
    event TicketMinted(string eventId, string tierId, address recipient);

    constructor() ERC1155("") Ownable(msg.sender) {}

    function createEvent(
        string memory eventId,
        string[] memory tierIds,
        uint256[] memory prices,
        uint256[] memory maxQuantities,
        bool commissionActive,
        uint256 commissionPercentage,
        address commissionAddress
    ) external {
        require(!eventExists(eventId), "Event already exists");
        require(prices.length == maxQuantities.length, "Invalid tier data");
        require(prices.length == tierIds.length, "Invalid tier IDs");
        require(bytes(eventId).length > 0, "Event ID cannot be empty");
        require(prices.length > 0, "At least one tier is required");

        Event storage newEvent = events[eventId];
        newEvent.creator = msg.sender;
        newEvent.eventId = eventId;
        newEvent.isActive = true;
        newEvent.totalTiers = prices.length;
        newEvent.tierIds = tierIds;

        if (commissionActive) {
            require(commissionPercentage <= 100, "Invalid percentage");
            require(commissionAddress != address(0), "Invalid address");
            newEvent.commissionActive = true;
            newEvent.commissionPercentage = commissionPercentage;
            newEvent.commissionAddress = commissionAddress;
        }

        for (uint256 i = 0; i < prices.length; i++) {
            require(bytes(tierIds[i]).length > 0, "Tier ID cannot be empty");
            newEvent.tiers[tierIds[i]] = EventTier({
                price: prices[i],
                maxQuantity: maxQuantities[i],
                soldCount: 0,
                isActive: true
            });
        }

        emit EventCreated(eventId, msg.sender);
    }

    function mintTicket(
        string memory eventId,
        string memory tierId,
        address recipient,
        bool applyCommission
    ) external payable nonReentrant {
        Event storage event_ = events[eventId];
        require(event_.isActive, "Event not active");

        EventTier storage tier = event_.tiers[tierId];
        require(tier.isActive, "Tier not active");
        require(tier.soldCount < tier.maxQuantity, "Tier sold out");
        require(msg.value == tier.price, "Incorrect payment amount");

        uint256 tokenId = uint256(keccak256(abi.encodePacked(eventId, tierId)));
        _mint(recipient, tokenId, 1, "");

        tier.soldCount++;

        uint256 commissionAmount = 0;
        uint256 creatorAmount = msg.value;

        if (applyCommission && event_.commissionActive) {
            commissionAmount = (msg.value * event_.commissionPercentage) / 100;
            creatorAmount = msg.value - commissionAmount;

            (bool commissionSuccess, ) = payable(event_.commissionAddress).call{value: commissionAmount}("");
            require(commissionSuccess, "Commission transfer failed");
        }

        (bool success, ) = payable(event_.creator).call{value: creatorAmount}("");
        require(success, "Transfer to creator failed");

        emit TicketMinted(eventId, tierId, recipient);
    }

    function getEventDetails(string memory eventId) external view returns (
        address creator,
        bool isActive,
        uint256 totalTiers,
        bool commissionActive,
        uint256 commissionPercentage,
        address commissionAddress
    ) {
        Event storage event_ = events[eventId];
        return (
            event_.creator,
            event_.isActive,
            event_.totalTiers,
            event_.commissionActive,
            event_.commissionPercentage,
            event_.commissionAddress
        );
    }

    function getEventTierDetails(
        string memory eventId,
        string memory tierId
    ) external view returns (
        uint256 price,
        uint256 maxQuantity,
        uint256 soldCount,
        bool isActive
    ) {
        Event storage event_ = events[eventId];
        EventTier storage tier = event_.tiers[tierId];
        return (
            tier.price,
            tier.maxQuantity,
            tier.soldCount,
            tier.isActive
        );
    }

    function getTicketBalance(
        address owner,
        string memory eventId,
        string memory tierId
    ) external view returns (uint256) {
        uint256 tokenId = uint256(keccak256(abi.encodePacked(eventId, tierId)));
        return balanceOf(owner, tokenId);
    }

    function getTicketBalances(
        address owner,
        string memory eventId
    ) external view returns (uint256[] memory) {
        Event storage event_ = events[eventId];
        uint256[] memory balances = new uint256[](event_.totalTiers);
        
        for (uint256 i = 0; i < event_.totalTiers; i++) {
            string memory tierId = event_.tierIds[i];
            uint256 tokenId = uint256(keccak256(abi.encodePacked(eventId, tierId)));
            balances[i] = balanceOf(owner, tokenId);
        }
        
        return balances;
    }

    function eventExists(string memory eventId) public view returns (bool) {
        return events[eventId].creator != address(0);
    }

    function getEventTicketsSoldStatus(string memory eventId) external view returns (
        uint256[] memory soldCounts,
        uint256[] memory maxQuantities,
        string[] memory tierIds
    ) {
        Event storage event_ = events[eventId];
        require(event_.creator == msg.sender, "Not event creator");
        require(event_.isActive, "Event not active");

        uint256[] memory _soldCounts = new uint256[](event_.totalTiers);
        uint256[] memory _maxQuantities = new uint256[](event_.totalTiers);
        
        for (uint256 i = 0; i < event_.totalTiers; i++) {
            string memory tierId = event_.tierIds[i];
            EventTier storage tier = event_.tiers[tierId];
            _soldCounts[i] = tier.soldCount;
            _maxQuantities[i] = tier.maxQuantity;
        }
        
        return (_soldCounts, _maxQuantities, event_.tierIds);
    }
}