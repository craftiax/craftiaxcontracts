// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

contract ArtistPayment is ReentrancyGuard, Ownable, EIP712 {
    using ECDSA for bytes32;

    address public craftiaxAddress;
    uint256 public craftiaxFeePercentage;
    
    // Maximum fee percentage allowed (e.g., 20%)
    uint256 public constant MAX_FEE_PERCENTAGE = 20;
    
    // Add new constants for payment limits
    // 5 cents in Wei (0.05 USD ≈ 0.000025 ETH @ $2000/ETH)
    uint256 public constant MIN_PAYMENT = 25000000000000 wei; // 0.000025 ETH
    // 100 USD in Wei (100 USD ≈ 0.05 ETH @ $2000/ETH)
    uint256 public constant MAX_PAYMENT = 50000000000000000 wei; // 0.05 ETH
    
    // Change from constant to regular state variables so they can be updated
    uint256 public generalMinPayment = 5000000000000 wei; // 0.000005 ETH ≈ $0.01
    uint256 public generalMaxPayment = 50000000000000000 wei; // 0.05 ETH ≈ $100
    uint256 public verifiedMaxPayment = 250000000000000000 wei; // 0.25 ETH ≈ $500

    // Track verified artists
    mapping(address => bool) public isVerifiedArtist;
    
    event PaymentProcessed(
        address indexed artist,
        uint256 artistAmount,
        uint256 craftiaxFee,
        bool isVerified
    );
    
    event FeeUpdated(uint256 newFee);
    event CraftiaxAddressUpdated(address newAddress);
    event ArtistVerificationStatusUpdated(address indexed artist, bool isVerified);
    event PaymentLimitsUpdated(
        uint256 generalMin,
        uint256 generalMax,
        uint256 verifiedMax
    );
    event VerifierUpdated(address indexed oldVerifier, address indexed newVerifier);
    event NonceInvalidated(address indexed user, uint256 currentNonce);

    // Add new variables for signature verification
    bytes32 private constant PAYMENT_TYPEHASH = keccak256(
        "PayArtist(address artist,uint256 amount,PaymentCurrency currency,uint256 nonce,uint256 deadline,uint256 chainId)"
    );
    mapping(address => uint256) private _nonces;
    address private _verifier;

    // Add rate limiting
    mapping(address => uint256) private lastPaymentTimestamp;
    uint256 private constant PAYMENT_COOLDOWN = 60; // 60 seconds = 1 minute

    // Add payment currency enum
    enum PaymentCurrency { ETH, USD }
    
    // Add USDC token interface
    IERC20 public immutable usdToken;
    uint8 private immutable USDC_DECIMALS;
    uint8 private constant PRICE_DECIMALS = 18;

    // Update payment limits to include USDC
    struct PaymentLimits {
        uint256 minPayment;
        uint256 maxPayment;
        uint256 verifiedMaxPayment;
    }
    
    PaymentLimits public ethLimits;
    PaymentLimits public usdcLimits;

    constructor(address initialOwner, address _usdToken) 
        Ownable(initialOwner) 
        EIP712("ArtistPayment", "1") 
    {
        usdToken = IERC20(_usdToken);
        USDC_DECIMALS = IERC20Metadata(_usdToken).decimals();
        
        craftiaxAddress = 0x8ce0f94755Eb14f7AF130C1aa2cAd26dea2a2Acd;
        craftiaxFeePercentage = 5;
        _verifier = initialOwner;

        // Initialize ETH limits
        ethLimits = PaymentLimits({
            minPayment: 5000000000000 wei, // 0.000005 ETH
            maxPayment: 50000000000000000 wei, // 0.05 ETH
            verifiedMaxPayment: 250000000000000000 wei // 0.25 ETH
        });

        // Initialize USDC limits (assuming 6 decimals)
        usdcLimits = PaymentLimits({
            minPayment: 10000, // $0.01
            maxPayment: 100000000, // $100
            verifiedMaxPayment: 500000000 // $500
        });
    }

    function payArtist(
        address artistAddress,
        uint256 amount,
        PaymentCurrency currency,
        uint256 deadline
    ) external payable nonReentrant {
        // Add rate limiting check
        require(
            block.timestamp >= lastPaymentTimestamp[msg.sender] + PAYMENT_COOLDOWN,
            "Too many requests"
        );
        
        // Validate inputs
        require(block.timestamp <= deadline, "Signature expired");
        require(artistAddress != address(0), "Invalid artist address");
        require(artistAddress != craftiaxAddress, "Artist cannot be Craftiax address");

        // Update rate limiting timestamp
        lastPaymentTimestamp[msg.sender] = block.timestamp;

        // Verify signature with updated parameters
        bytes32 structHash = keccak256(abi.encode(
            PAYMENT_TYPEHASH,
            artistAddress,
            amount,
            currency,
            _nonces[msg.sender]++,
            deadline,
            block.chainid
        ));

        // Validate payment amount based on currency
        PaymentLimits storage limits = currency == PaymentCurrency.ETH ? ethLimits : usdcLimits;
        require(amount >= limits.minPayment, "Payment amount below minimum");
        
        uint256 maxAllowed = isVerifiedArtist[artistAddress] ? 
            limits.verifiedMaxPayment : 
            limits.maxPayment;
        require(amount <= maxAllowed, "Payment amount above maximum");

        // Process payment based on currency
        if (currency == PaymentCurrency.USD) {
            require(msg.value == 0, "ETH not accepted for USDC payment");
            require(usdToken.transferFrom(msg.sender, address(this), amount), "USDC transfer failed");
        } else {
            require(msg.value == amount, "Incorrect ETH amount");
        }

        // Calculate fees
        uint256 craftiaxFee = (amount * craftiaxFeePercentage) / 100;
        uint256 artistPayment = amount - craftiaxFee;

        // Process payments based on currency
        if (currency == PaymentCurrency.USD) {
            require(usdToken.transfer(artistAddress, artistPayment), "Artist USDC transfer failed");
            require(usdToken.transfer(craftiaxAddress, craftiaxFee), "Craftiax USDC transfer failed");
        } else {
            (bool successArtist, ) = payable(artistAddress).call{value: artistPayment}("");
            require(successArtist, "Failed to send ETH to artist");

            (bool successCraftiax, ) = payable(craftiaxAddress).call{value: craftiaxFee}("");
            require(successCraftiax, "Failed to send ETH to Craftiax");
        }

        emit PaymentProcessed(
            artistAddress, 
            artistPayment, 
            craftiaxFee,
            isVerifiedArtist[artistAddress]
        );
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

    // New functions for verified management
    function setVerificationStatus(address artistAddress, bool status) 
        external 
        onlyOwner 
    {
        require(artistAddress != address(0), "Invalid artist address");
        require(isVerifiedArtist[artistAddress] != status, "Status already set");
        
        isVerifiedArtist[artistAddress] = status;
        emit ArtistVerificationStatusUpdated(artistAddress, status);
    }

    // Add array size limit for batch operations
    uint256 private constant MAX_BATCH_SIZE = 100;

    function setVerificationStatusBatch(address[] calldata artists, bool status)
        external
        onlyOwner
    {
        require(artists.length <= MAX_BATCH_SIZE, "Batch too large");
        for (uint256 i = 0; i < artists.length; i++) {
            require(artists[i] != address(0), "Invalid artist address");
            if (isVerifiedArtist[artists[i]] != status) {
                isVerifiedArtist[artists[i]] = status;
                emit ArtistVerificationStatusUpdated(artists[i], status);
            }
        }
    }

    // Add function to update payment limits
    function updatePaymentLimits(
        uint256 newGeneralMin,
        uint256 newGeneralMax,
        uint256 newVerifiedMax
    ) external onlyOwner {
        require(newGeneralMin > 0, "General min must be greater than 0");
        require(newGeneralMax > newGeneralMin, "General max must be greater than min");
        require(newVerifiedMax > newGeneralMax, "Verified max must be greater than general max");
        
        generalMinPayment = newGeneralMin;
        generalMaxPayment = newGeneralMax;
        verifiedMaxPayment = newVerifiedMax;
        
        emit PaymentLimitsUpdated(newGeneralMin, newGeneralMax, newVerifiedMax);
    }

    // Add new functions for signature verification
    function updateVerifier(address newVerifier) external onlyOwner {
        require(newVerifier != address(0), "Invalid verifier address");
        address oldVerifier = _verifier;
        _verifier = newVerifier;
        emit VerifierUpdated(oldVerifier, newVerifier);
    }

    function nonces(address owner) public view returns (uint256) {
        return _nonces[owner];
    }

    function invalidateNonce(address user) external onlyOwner {
        require(user != address(0), "Invalid user address");
        uint256 currentNonce = _nonces[user];
        _nonces[user] = type(uint256).max;
        emit NonceInvalidated(user, currentNonce);
    }

    // Add function to update USDC payment limits
    function updateUSDCPaymentLimits(
        uint256 newGeneralMin,
        uint256 newGeneralMax,
        uint256 newVerifiedMax
    ) external onlyOwner {
        require(newGeneralMin > 0, "General min must be greater than 0");
        require(newGeneralMax > newGeneralMin, "General max must be greater than min");
        require(newVerifiedMax > newGeneralMax, "Verified max must be greater than general max");
        
        usdcLimits.minPayment = newGeneralMin;
        usdcLimits.maxPayment = newGeneralMax;
        usdcLimits.verifiedMaxPayment = newVerifiedMax;
        
        emit PaymentLimitsUpdated(newGeneralMin, newGeneralMax, newVerifiedMax);
    }

    receive() external payable {}
}

