# Craftiax Smart Contracts

This repository contains the smart contracts for the Craftiax platform, built using Hardhat and OpenZeppelin contracts.

## Contracts Overview

### EventTicketContract
A comprehensive ERC-1155 based contract for managing event tickets with the following features:
- Multiple tier support for each event
- Commission system for ticket sales
- Batch minting capabilities
- Event creator controls and management
- Detailed event and tier tracking

### ArtistPayment
A dedicated payment handling contract that manages artist payments with built-in fee processing:
- Secure payment distribution between artists and platform
- Configurable platform fee (max 20%)
- Reentrancy protection
- Owner-controlled fee and platform address updates
- Automatic fee calculation and distribution

### CraftiaxNFT (CNFT)
An ERC-721 based NFT contract for managing digital artworks:
- Standard NFT functionality
- Pausable operations
- URI storage for metadata
- Owner-controlled minting
- Secure transfer mechanisms
 contract fileare are in the contract folder  
## Development Setup

1. Install dependencies:

```shell
npm install
```

2. Create a `.env` file with required environment variables:
```
PRIVATE_KEY=your_private_key
```

3. Compile contracts:
```bash
npx hardhat compile
```

4. Run tests:
```bash
npx hardhat test
```

## Deployment

Deploy to Base Sepolia testnet:
```bash
npx hardhat run scripts/deploy.ts --network base-sepolia
```

## Contract Interaction

Use the interactive script to manage events and tickets:
```bash
npx hardhat run scripts/interact.ts --network base-sepolia
```

## Security Features

- ReentrancyGuard implementation
- Ownable access control
- Safe math operations
- Event emission for tracking
- Pausable functionality where needed

## Network Configuration

Currently configured for:
- Base Sepolia Testnet
- Gas optimization settings
- TypeScript support

## License

All contracts are under the MIT License.
 