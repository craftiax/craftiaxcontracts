// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@prb/math/src/Common.sol";

contract EventTicketBase is ERC1155, Ownable, ReentrancyGuard, Pausable {
    // Enums
    enum PaymentCurrency { ETH, USD }
    enum EventStatus { DRAFT, PUBLISHED, CANCELLED, COMPLETED }
    
    struct EventTier {
        uint256 price;
        uint256 maxQuantity;
        uint256 soldCount;
        bool isActive;
    }

    struct Event {
        string name;
        string description;
        uint256 startTime;
        uint256 endTime;
        address organizer;
        EventStatus status;
        PaymentCurrency currency;
        bool isActive;
        bool isRefundable;
        uint256 commissionPercentage;
        address commissionAddress;
        mapping(string => EventTier) tiers;
        string[] tierIds;
        mapping(address => bool) hasRefunded;
    }

    // Constants and State variables
    uint256 internal immutable MAX_TIERS;
    uint256 internal immutable MIN_PRICE;
    uint256 internal immutable MAX_PRICE;
    uint8 internal immutable USDC_DECIMALS;
    uint256 internal constant PRICE_DECIMALS = 18;
    
    IERC20 public immutable usdToken;
    mapping(string => Event) internal events;
    mapping(address => uint256) internal organizerBalances;
    mapping(address => uint256) internal organizerUSDBalances;

    // Events
    event EventCreated(string eventId, address indexed creator, string name);
    event TicketMinted(string eventId, string tierId, address indexed recipient, uint256 price);
    event FeesWithdrawn(address indexed recipient, uint256 ethAmount, uint256 usdAmount);
    event OrganizerBalanceUpdated(address indexed organizer, uint256 ethBalance, uint256 usdBalance);
    event EventStatusUpdated(string eventId, EventStatus status);
    event TierStatusUpdated(string eventId, string tierId, bool isActive);

    constructor(address _usdToken) ERC1155("") Ownable(msg.sender) {
        usdToken = IERC20(_usdToken);
        MAX_TIERS = 10;
        MIN_PRICE = 0.0001 ether;
        MAX_PRICE = 100 ether;
        USDC_DECIMALS = IERC20Metadata(_usdToken).decimals();
    }

    // Internal helper functions
    function validateEventTimes(uint256 startTime, uint256 endTime) internal view {
        require(startTime > block.timestamp, "Start time must be in future");
        require(endTime > startTime, "End time must be after start time");
    }

    function validateTierData(
        uint256[] memory tierPrices,
        uint256[] memory tierSupplies
    ) internal view {
        require(tierPrices.length == tierSupplies.length, "Tier arrays must match");
        require(tierPrices.length > 0 && tierPrices.length <= MAX_TIERS, "Invalid tier count");
        
        for (uint256 i = 0; i < tierPrices.length; i++) {
            require(tierPrices[i] >= MIN_PRICE && tierPrices[i] <= MAX_PRICE, "Invalid price");
            require(tierSupplies[i] > 0, "Supply must be positive");
        }
    }

    function isEventActive(Event storage event_) internal view returns (bool) {
        return event_.status == EventStatus.PUBLISHED &&
               block.timestamp >= event_.startTime &&
               block.timestamp <= event_.endTime;
    }

    function _scaleAmount(uint256 amount) internal virtual view returns (uint256) {
        if (USDC_DECIMALS <= PRICE_DECIMALS) {
            return amount / (10 ** (PRICE_DECIMALS - USDC_DECIMALS));
        } else {
            return amount * (10 ** (USDC_DECIMALS - PRICE_DECIMALS));
        }
    }

    function _processPayment(
        uint256 scaledAmount,
        PaymentCurrency currency,
        address sender
    ) internal returns (bool) {
        require(sender != address(0), "Invalid sender address");
        require(scaledAmount > 0, "Amount must be greater than 0");

        if (currency == PaymentCurrency.USD) {
            require(usdToken.balanceOf(sender) >= scaledAmount, "Insufficient USDC balance");
            return usdToken.transferFrom(sender, address(this), scaledAmount);
        } else if (currency == PaymentCurrency.ETH) {
            return msg.value == scaledAmount;
        }
        revert("Invalid currency");
    }
} 