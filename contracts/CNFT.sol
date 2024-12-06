// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract CraftiaxNFT is 
    ERC721URIStorage, 
    Ownable, 
    ReentrancyGuard, 
    Pausable,
    EIP712 
{
    using ECDSA for bytes32;

    uint256 private _nextTokenId;
    
    // Events
    event TokenMinted(address indexed to, uint256 indexed tokenId, string uri);
    event BaseURIChanged(string newBaseURI);
    event TokenBurned(address indexed burner, uint256 indexed tokenId);
    
    // URI related storage
    string private _baseTokenURI;
    mapping(uint256 => bool) private _usedTokenIds;

    bytes32 private constant MINT_TYPEHASH = keccak256("SafeMint(address to,string uri,uint256 nonce,uint256 deadline)");
    mapping(address => uint256) private _nonces;
    address private immutable _verifier;

    constructor(
        address initialOwner,
        string memory baseURI,
        address verifier
    ) ERC721("CraftiaxNFT", "CNFT") 
      Ownable(initialOwner) 
      EIP712("CraftiaxNFT", "1") 
    {
        _baseTokenURI = baseURI;
        _verifier = verifier;
    }




    function safeMint(
        address to,
        string memory uri,
        uint256 deadline,
        bytes memory signature
    ) 
        public 
        nonReentrant 
        whenNotPaused 
    {
        require(block.timestamp <= deadline, "Signature expired");
        require(to != address(0), "Invalid recipient address");
        require(bytes(uri).length > 0, "URI cannot be empty");

        // Verify signature
        bytes32 structHash = keccak256(abi.encode(
            MINT_TYPEHASH,
            to,
            keccak256(bytes(uri)),
            _nonces[to]++,
            deadline
        ));

        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(hash, signature);
        require(signer == _verifier, "Invalid signature");

        uint256 tokenId = _nextTokenId;
        require(!_usedTokenIds[tokenId], "Token ID already used");
        
        _nextTokenId++;
        _usedTokenIds[tokenId] = true;
        
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        
        emit TokenMinted(to, tokenId, uri);
    }

    function setBaseURI(string memory newBaseURI) external onlyOwner {
        require(bytes(newBaseURI).length > 0, "Base URI cannot be empty");
        _baseTokenURI = newBaseURI;
        emit BaseURIChanged(newBaseURI);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    // The following functions are overrides required by Solidity
    function tokenURI(uint256 tokenId) 
        public 
        view 
        override(ERC721URIStorage) 
        returns (string memory) 
    {
        ownerOf(tokenId);
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function burn(uint256 tokenId) 
        external 
        nonReentrant 
        whenNotPaused 
    {
        address owner = ownerOf(tokenId);
        address spender = _msgSender();
        
        require(
            spender == owner || 
            isApprovedForAll(owner, spender) ||
            getApproved(tokenId) == spender,
            "Caller is not owner or approved"
        );
        
        // Remove token URI before burning
        _setTokenURI(tokenId, "");
        
        // Burn the token
        _burn(tokenId);
        
        // Mark token ID as no longer used
        _usedTokenIds[tokenId] = false;
        
        emit TokenBurned(spender, tokenId);
    }

    function nonces(address owner) public view returns (uint256) {
        return _nonces[owner];
    }
}

