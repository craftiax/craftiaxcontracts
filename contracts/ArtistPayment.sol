// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ArtistPayment is ReentrancyGuard, Ownable {
    address public craftiaxAddress;
    uint256 public craftiaxFeePercentage;
    
    // Maximum fee percentage allowed (e.g., 20%)
    uint256 public constant MAX_FEE_PERCENTAGE = 20;
    
    event PaymentProcessed(
        address indexed artist,
        uint256 artistAmount,
        uint256 craftiaxFee
    );
    
    event FeeUpdated(uint256 newFee);
    event CraftiaxAddressUpdated(address newAddress);

    constructor(address initialOwner) Ownable(initialOwner) {
        craftiaxAddress = 0x8ce0f94755Eb14f7AF130C1aa2cAd26dea2a2Acd;
        craftiaxFeePercentage = 5;
    }

    function payArtist(address artistAddress) 
        external 
        payable 
        nonReentrant 
    {
        require(msg.value > 0, "Payment amount must be greater than 0");
        require(artistAddress != address(0), "Invalid artist address");
        require(artistAddress != craftiaxAddress, "Artist cannot be Craftiax address");

        uint256 craftiaxFee = (msg.value * craftiaxFeePercentage) / 100;
        uint256 artistPayment = msg.value - craftiaxFee;

        // Transfer to artist first (favors artist in case of failure)
        (bool successArtist, ) = payable(artistAddress).call{
            value: artistPayment
        }("");
        require(successArtist, "Failed to send payment to artist");

        // Then transfer fee to Craftiax
        (bool successCraftiax, ) = payable(craftiaxAddress).call{
            value: craftiaxFee
        }("");
        require(successCraftiax, "Failed to send payment to Craftiax");

        emit PaymentProcessed(artistAddress, artistPayment, craftiaxFee);
    }

    function updateCraftiaxAddress(address newAddress) external onlyOwner {
        require(newAddress != address(0), "Invalid address");
        require(newAddress != craftiaxAddress, "Same address provided");
        craftiaxAddress = newAddress;
        emit CraftiaxAddressUpdated(newAddress);
    }

    function updateFeePercentage(uint256 newFee) external onlyOwner {
        require(newFee <= MAX_FEE_PERCENTAGE, "Fee exceeds maximum allowed");
        craftiaxFeePercentage = newFee;
        emit FeeUpdated(newFee);
    }

    receive() external payable {}
}
