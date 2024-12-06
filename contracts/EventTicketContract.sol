// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

contract EventTicketContract is ERC1155, Ownable, ReentrancyGuard, Pausable {
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

    // Constants
    uint256 private immutable MAX_TIERS;
    uint256 private immutable MIN_PRICE;
    uint256 private immutable MAX_PRICE;
    uint8 private immutable USDC_DECIMALS;
    
    // Rate limiting
    uint256 public RATE_LIMIT_WINDOW;
    uint256 public MAX_MINTS_PER_WINDOW;
    uint256 public MIN_TIME_BETWEEN_MINTS;

    // State variables
    IERC20 public immutable usdToken;
    mapping(string => Event) private events;
    mapping(address => uint256) private organizerBalances;
    mapping(address => uint256) private organizerUSDBalances;

    // Events
    event EventCreated(string eventId, address indexed creator, string name);
    event TicketMinted(string eventId, string tierId, address indexed recipient, uint256 price);
    event FeesWithdrawn(address indexed recipient, uint256 ethAmount, uint256 usdAmount);
    event OrganizerBalanceUpdated(address indexed organizer, uint256 ethBalance, uint256 usdBalance);
    event EventStatusUpdated(string eventId, EventStatus status);
    event TierStatusUpdated(string eventId, string tierId, bool isActive);

    // Add price scaling factor for USDC
    uint256 private constant PRICE_DECIMALS = 18;
    
    constructor(address _usdToken) ERC1155("") Ownable(msg.sender) {
        usdToken = IERC20(_usdToken);
        MAX_TIERS = 10;
        MIN_PRICE = 0.0001 ether;
        MAX_PRICE = 100 ether;
        USDC_DECIMALS = IERC20Metadata(_usdToken).decimals();
        _initializeRateLimits();
    }

    // Internal function to initialize rate limits
    function _initializeRateLimits() private {
        RATE_LIMIT_WINDOW = 1 hours;
        MAX_MINTS_PER_WINDOW = 10;
        MIN_TIME_BETWEEN_MINTS = 1 minutes;
    }


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

    function _processPayment(
        uint256 amount,
        PaymentCurrency currency,
        address sender
    ) internal returns (bool) {
        if (currency == PaymentCurrency.USD) {
            // Scale amount for USDC decimals
            uint256 scaledAmount = (amount * (10 ** USDC_DECIMALS)) / (10 ** PRICE_DECIMALS);
            return usdToken.transferFrom(sender, address(this), scaledAmount);
        } else if (currency == PaymentCurrency.ETH) {
            return msg.value == amount;
        }
        revert("Invalid currency");
    }

    // Withdrawal function for contract owner (platform fees)
    function withdrawPlatformFees(address payable recipient) external onlyOwner nonReentrant {
        require(recipient != address(0), "Invalid recipient");
        
        uint256 ethBalance = address(this).balance;
        uint256 usdBalance = usdToken.balanceOf(address(this));
        
        // Transfer ETH if available
        if (ethBalance > 0) {
            (bool success, ) = recipient.call{value: ethBalance}("");
            require(success, "ETH transfer failed");
        }
        
        // Transfer USDC if available
        if (usdBalance > 0) {
            require(usdToken.transfer(recipient, usdBalance), "USDC transfer failed");
        }
        
        emit FeesWithdrawn(recipient, ethBalance, usdBalance);
    }

    // Withdrawal function for event organizers
    function withdrawOrganizerFees() external nonReentrant {
        uint256 ethBalance = organizerBalances[msg.sender];
        uint256 usdBalance = organizerUSDBalances[msg.sender];
        
        require(ethBalance > 0 || usdBalance > 0, "No balance to withdraw");
        
        // Reset balances before transfer (Checks-Effects-Interactions pattern)
        organizerBalances[msg.sender] = 0;
        organizerUSDBalances[msg.sender] = 0;
        
        // Transfer ETH if available
        if (ethBalance > 0) {
            (bool success, ) = payable(msg.sender).call{value: ethBalance}("");
            require(success, "ETH transfer failed");
        }
        
        // Transfer USDC if available
        if (usdBalance > 0) {
            require(usdToken.transfer(msg.sender, usdBalance), "USDC transfer failed");
        }
        
        emit FeesWithdrawn(msg.sender, ethBalance, usdBalance);
    }

    // Internal function to update organizer balances (call this when processing ticket sales)
    function _updateOrganizerBalance(address organizer, uint256 amount, PaymentCurrency currency) internal {
        if (currency == PaymentCurrency.USD) {
            organizerUSDBalances[organizer] += amount;
        } else if (currency == PaymentCurrency.ETH) {
            organizerBalances[organizer] += amount;
        }
        
        emit OrganizerBalanceUpdated(organizer, organizerBalances[organizer], organizerUSDBalances[organizer]);
    }

    function createEvent(
        string memory eventId,
        string memory name,
        string memory description,
        uint256 startTime,
        uint256 endTime,
        string[] memory tierIds,
        uint256[] memory prices,
        uint256[] memory maxQuantities,
        PaymentCurrency currency,
        uint256 commissionPercentage,
        address commissionAddress
    ) external whenNotPaused {
        require(!eventExists(eventId), "Event already exists");
        require(prices.length == maxQuantities.length && prices.length == tierIds.length, "Invalid tier data");
        require(prices.length > 0 && prices.length <= MAX_TIERS, "Invalid tier count");
        require(commissionPercentage <= 100, "Invalid percentage");
        require(commissionAddress != address(0), "Invalid commission address");
        validateEventTimes(startTime, endTime);

        Event storage newEvent = events[eventId];
        newEvent.name = name;
        newEvent.description = description;
        newEvent.startTime = startTime;
        newEvent.endTime = endTime;
        newEvent.organizer = msg.sender;
        newEvent.status = EventStatus.PUBLISHED;
        newEvent.currency = currency;
        newEvent.isActive = true;
        newEvent.tierIds = tierIds;
        newEvent.commissionPercentage = commissionPercentage;
        newEvent.commissionAddress = commissionAddress;

        for (uint256 i = 0; i < prices.length; i++) {
            require(prices[i] >= MIN_PRICE && prices[i] <= MAX_PRICE, "Invalid price");
            require(maxQuantities[i] > 0, "Invalid quantity");
            
            newEvent.tiers[tierIds[i]] = EventTier({
                price: prices[i],
                maxQuantity: maxQuantities[i],
                soldCount: 0,
                isActive: true
            });
        }

        emit EventCreated(eventId, msg.sender, name);
    }

    function mintTicket(
        string memory eventId,
        string memory tierId,
        address recipient
    ) external payable nonReentrant {
        Event storage event_ = events[eventId];
        require(event_.isActive, "Event not active");
        require(isEventActive(event_), "Event not in active timeframe");

        EventTier storage tier = event_.tiers[tierId];
        require(tier.isActive, "Tier not active");
        require(tier.soldCount < tier.maxQuantity, "Tier sold out");

        // Handle payment based on currency
        if (event_.currency == PaymentCurrency.USD) {
            uint256 scaledPrice = (tier.price * (10 ** USDC_DECIMALS)) / (10 ** PRICE_DECIMALS);
            require(_processPayment(scaledPrice, PaymentCurrency.USD, msg.sender), "USDC payment failed");
        } else {
            require(msg.value == tier.price, "Incorrect ETH amount");
        }

        uint256 tokenId = uint256(keccak256(abi.encodePacked(eventId, tierId)));
        _mint(recipient, tokenId, 1, "");

        tier.soldCount++;

        // Handle commission calculation and distribution
        uint256 commissionAmount;
        uint256 creatorAmount;
        
        if (event_.currency == PaymentCurrency.USD) {
            uint256 scaledPrice = (tier.price * (10 ** USDC_DECIMALS)) / (10 ** PRICE_DECIMALS);
            commissionAmount = (scaledPrice * event_.commissionPercentage) / 100;
            creatorAmount = scaledPrice - commissionAmount;
            
            require(usdToken.transfer(event_.commissionAddress, commissionAmount), "Commission USDC transfer failed");
            require(usdToken.transfer(event_.organizer, creatorAmount), "Creator USDC transfer failed");
        } else {
            commissionAmount = (msg.value * event_.commissionPercentage) / 100;
            creatorAmount = msg.value - commissionAmount;
            
            (bool commissionSuccess, ) = payable(event_.commissionAddress).call{value: commissionAmount}("");
            require(commissionSuccess, "Commission ETH transfer failed");
            
            (bool creatorSuccess, ) = payable(event_.organizer).call{value: creatorAmount}("");
            require(creatorSuccess, "Creator ETH transfer failed");
        }

        emit TicketMinted(eventId, tierId, recipient, tier.price);
    }

    function getEventDetails(string memory eventId) external view returns (
        address creator,
        bool isActive,
        uint256 totalTiers,
        uint256 commissionPercentage,
        address commissionAddress
    ) {
        Event storage event_ = events[eventId];
        return (
            event_.organizer,
            event_.isActive,
            event_.tierIds.length,
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
        uint256[] memory balances = new uint256[](event_.tierIds.length);
        
        for (uint256 i = 0; i < event_.tierIds.length; i++) {
            string memory tierId = event_.tierIds[i];
            uint256 tokenId = uint256(keccak256(abi.encodePacked(eventId, tierId)));
            balances[i] = balanceOf(owner, tokenId);
        }
        
        return balances;
    }

    function eventExists(string memory eventId) public view returns (bool) {
        return events[eventId].organizer != address(0);
    }

    function getEventTicketsSoldStatus(string memory eventId) external view returns (
        uint256[] memory soldCounts,
        uint256[] memory maxQuantities,
        string[] memory tierIds
    ) {
        Event storage event_ = events[eventId];
        require(event_.organizer == msg.sender, "Not event creator");
        require(event_.isActive, "Event not active");

        uint256[] memory _soldCounts = new uint256[](event_.tierIds.length);
        uint256[] memory _maxQuantities = new uint256[](event_.tierIds.length);
        
        for (uint256 i = 0; i < event_.tierIds.length; i++) {
            string memory tierId = event_.tierIds[i];
            EventTier storage tier = event_.tiers[tierId];
            _soldCounts[i] = tier.soldCount;
            _maxQuantities[i] = tier.maxQuantity;
        }
        
        return (_soldCounts, _maxQuantities, event_.tierIds);
    }
}