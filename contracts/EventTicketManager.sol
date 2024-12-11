// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./EventTicketBase.sol";

contract EventTicketManager is EventTicketBase {
    // Rate limiting
    uint256 public RATE_LIMIT_WINDOW;
    uint256 public MAX_MINTS_PER_WINDOW;
    uint256 public MIN_TIME_BETWEEN_MINTS;

    constructor(address _usdToken) EventTicketBase(_usdToken) {
        _initializeRateLimits();
    }

    function _initializeRateLimits() private {
        RATE_LIMIT_WINDOW = 1 hours;
        MAX_MINTS_PER_WINDOW = 10;
        MIN_TIME_BETWEEN_MINTS = 1 minutes;
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
    ) external payable nonReentrant whenNotPaused {
        Event storage event_ = events[eventId];
        require(event_.isActive, "Event not active");
        require(isEventActive(event_), "Event not in active timeframe");

        EventTier storage tier = event_.tiers[tierId];
        require(tier.isActive, "Tier not active");
        require(tier.soldCount < tier.maxQuantity, "Tier sold out");

        uint256 tokenId = uint256(keccak256(abi.encode(eventId, tierId)));
        
        if (event_.currency == PaymentCurrency.USD) {
            uint256 scaledPrice = (tier.price * (10 ** USDC_DECIMALS)) / (10 ** PRICE_DECIMALS);
            require(_processPayment(scaledPrice, PaymentCurrency.USD, msg.sender), "USDC payment failed");
            _handleCommissionAndPayment(event_, tier.price, PaymentCurrency.USD);
        } else {
            require(msg.value == tier.price, "Incorrect ETH amount");
            _handleCommissionAndPayment(event_, msg.value, PaymentCurrency.ETH);
        }

        _mint(recipient, tokenId, 1, "");
        tier.soldCount++;

        emit TicketMinted(eventId, tierId, recipient, tier.price);
    }

    function _handleCommissionAndPayment(
        Event storage event_,
        uint256 amount,
        PaymentCurrency currency
    ) private {
        uint256 commissionAmount = (amount * event_.commissionPercentage) / 100;
        uint256 creatorAmount = amount - commissionAmount;

        if (currency == PaymentCurrency.USD) {
            require(usdToken.transfer(event_.commissionAddress, commissionAmount), "Commission USDC transfer failed");
            require(usdToken.transfer(event_.organizer, creatorAmount), "Creator USDC transfer failed");
        } else {
            (bool commissionSuccess, ) = payable(event_.commissionAddress).call{value: commissionAmount}("");
            require(commissionSuccess, "Commission ETH transfer failed");
            
            (bool creatorSuccess, ) = payable(event_.organizer).call{value: creatorAmount}("");
            require(creatorSuccess, "Creator ETH transfer failed");
        }
    }

    // View functions
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

    function eventExists(string memory eventId) public view returns (bool) {
        return events[eventId].organizer != address(0);
    }

    // Admin functions
    function withdrawPlatformFees(address payable recipient) external onlyOwner nonReentrant {
        require(recipient != address(0), "Invalid recipient");
        
        uint256 ethBalance = address(this).balance;
        uint256 usdBalance = usdToken.balanceOf(address(this));
        
        if (ethBalance > 0) {
            (bool success, ) = recipient.call{value: ethBalance}("");
            require(success, "ETH transfer failed");
        }
        
        if (usdBalance > 0) {
            require(usdToken.transfer(recipient, usdBalance), "USDC transfer failed");
        }
        
        emit FeesWithdrawn(recipient, ethBalance, usdBalance);
    }
} 