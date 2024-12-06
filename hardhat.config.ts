import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: "0.8.20",
  networks: {
    "base-sepolia": {
    //   url: "https://base-sepolia.g.alchemy.com/v2/YOUR-API-KEY", // Replace with your Alchemy API key
    //   // Or use the public RPC:
      url: "https://sepolia.base.org",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 84532, // Base Sepolia chainId
      gasPrice: 1500000000, // 1.5 gwei
    },
  },
  // Add TypeScript configuration
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
};

export default config; 