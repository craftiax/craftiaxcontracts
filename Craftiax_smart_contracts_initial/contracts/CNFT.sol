// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

contract CraftiaxNFT is ERC721, ERC721URIStorage, Ownable, ReentrancyGuard, Pausable {
    using Counters for Counters.Counter;

    Counters.Counter private _tokenIdCounter;
    
    // Events
    event TokenMinted(address indexed to, uint256 indexed tokenId, string uri);
    event BaseURIChanged(string newBaseURI);
    
    // URI related storage
    string private _baseTokenURI;
    mapping(uint256 => bool) private _usedTokenIds;

    constructor(
        address initialOwner,
        string memory baseURI
    ) ERC721("CraftiaxNFT", "CNFT") Ownable(initialOwner) {
        _baseTokenURI = baseURI;
    }

    function safeMint(
        address to, 
        string memory uri
    ) 
        public 
        nonReentrant 
        whenNotPaused 
    {
        require(to != address(0), "Invalid recipient address");
        require(bytes(uri).length > 0, "URI cannot be empty");
        
        uint256 tokenId = _tokenIdCounter.current();
        require(!_usedTokenIds[tokenId], "Token ID already used");
        
        _tokenIdCounter.increment();
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
    function tokenURI(
        uint256 tokenId
    ) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        require(_exists(tokenId), "Token does not exist");
        return super.tokenURI(tokenId);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, ERC721URIStorage) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function _burn(uint256 tokenId) internal override(ERC721, ERC721URIStorage) {
        super._burn(tokenId);
    }
}
