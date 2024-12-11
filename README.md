# Craftiax Smart Contracts

Smart contract infrastructure for the Craftiax platform, enabling NFT minting, artist payments, and event ticket management.

## Overview

The Craftiax smart contract suite consists of three main components:

1. **CraftiaxNFT**: ERC721 contract for minting and managing NFTs with signature-based verification
2. **ArtistPayment**: Handles artist payments in ETH and USDC with verification tiers
3. **EventTicketManager**: ERC1155-based contract for event ticket management

## Setup & Installation

1. Clone the repository:
2. npm install
3. npx hardhat test


## Contract Functions

### CraftiaxNFT Contract

#### Core Functions
- `safeMint(address to, string uri, uint256 deadline, bytes signature)`
  - Mints new NFT with signature verification
  - Requires valid EIP-712 signature from authorized verifier
  - Emits `TokenMinted` event

- `burn(uint256 tokenId)`
  - Burns owned NFT
  - Only callable by token owner or approved address
  - Emits `TokenBurned` event

#### Admin Functions
- `setBaseURI(string newBaseURI)`
  - Updates base URI for token metadata
  - Only callable by owner
  - Emits `BaseURIChanged` event

- `pause()/unpause()`
  - Emergency pause functionality
  - Only callable by owner
  - Emits `ContractPaused`/`ContractUnpaused` events

### ArtistPayment Contract

#### Core Functions
- `payArtist(address artistAddress, uint256 amount, PaymentCurrency currency, uint256 deadline)`
  - Processes artist payment in ETH or USDC
  - Enforces payment limits based on verification status
  - Emits `PaymentProcessed` event

#### Admin Functions
- `setVerificationStatus(address artistAddress, bool status)`
  - Updates artist verification status
  - Only callable by owner
  - Emits `VerificationStatusUpdated` event

### EventTicketManager Contract

#### Core Functions
- `createEvent(string eventId, string name, string description, uint256 startTime, uint256 endTime, string[] tierIds, uint256[] prices, uint256[] supplies)`
  - Creates new event with multiple ticket tiers
  - Emits `EventCreated` event

- `mintTicket(string eventId, string tierId, address to)`
  - Mints event ticket
  - Requires payment in configured currency
  - Emits `TicketMinted` event

## Security Features

1. **Signature Verification**
   - EIP-712 compliant signatures
   - Nonce-based replay protection
   - Deadline validation

2. **Access Control**
   - Role-based permissions
   - Owner-only admin functions
   - Verifier system for minting

3. **Safety Measures**
   - Reentrancy protection
   - Pausable functionality
   - Payment limits
   - Input validation

## Gas Optimization

1. **Storage**
   - Efficient packing of variables
   - Minimal storage operations
   - Use of mappings for O(1) lookups

2. **Operations**
   - Batch processing where possible
   - Memory vs storage optimization
   - Efficient event emission

## Development Stack

- Solidity ^0.8.20
- OpenZeppelin Contracts v5.0.0
- Hardhat v2.22.17
- TypeScript
- Ethers.js v6.13.4

## License

MIT

## Contributing

1. Fork the repository
2. Create feature branch
3. Commit changes
4. Push to branch
5. Create Pull Request

## Support

For support and inquiries, please open an issue in the GitHub repository.
