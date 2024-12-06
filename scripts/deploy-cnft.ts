import { ethers } from "ethers";
import hre from "hardhat";
import readline from "readline";
import fs from 'fs';
import path from 'path';
import { CraftiaxNFT } from "../typechain-types";

const DEPLOY_FILE = path.join(__dirname, '../deployed-cnft-address.json');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function saveDeployedAddress(address: string) {
  fs.writeFileSync(DEPLOY_FILE, JSON.stringify({ address }, null, 2));
  console.log(`Deployed address saved to ${DEPLOY_FILE}`);
}

async function loadDeployedAddress(): Promise<string | null> {
  try {
    if (fs.existsSync(DEPLOY_FILE)) {
      const data = JSON.parse(fs.readFileSync(DEPLOY_FILE, 'utf8'));
      return data.address;
    }
  } catch (error) {
    console.error("Error reading deployed address:", error);
  }
  return null;
}

async function deployOrLoadContract(): Promise<{ contract: CraftiaxNFT; wallet: ethers.Signer }> {
  const [deployer] = await hre.ethers.getSigners();
  const deployedAddress = await loadDeployedAddress();

  if (deployedAddress) {
    const useExisting = (await prompt(`Found existing deployment at ${deployedAddress}. Use it? (yes/no): `)).toLowerCase() === 'yes';
    if (useExisting) {
      console.log("Using existing contract at:", deployedAddress);
      const factory = await hre.ethers.getContractFactory("CraftiaxNFT");
      return { 
        contract: (await factory.attach(deployedAddress)) as CraftiaxNFT,
        wallet: deployer 
      };
    }
  }

  const baseURI = await prompt("Enter base URI (e.g., https://api.craftiax.com/metadata/): ");
  const verifier = await prompt("Enter verifier address (default to deployer? yes/no): ");
  
  const verifierAddress = verifier.toLowerCase() === 'yes' ? 
    deployer.address : 
    await prompt("Enter custom verifier address: ");

  const factory = await hre.ethers.getContractFactory("CraftiaxNFT");
  console.log("\nDeploying CraftiaxNFT...");
  console.log("Owner:", deployer.address);
  console.log("Base URI:", baseURI);
  console.log("Verifier:", verifierAddress);

  const cnft = await factory.deploy(
    deployer.address,  // initialOwner
    baseURI,          // baseURI
    verifierAddress   // verifier
  );
  
  await cnft.waitForDeployment();
  
  const address = await cnft.getAddress();
  console.log("\nCraftiaxNFT deployed to:", address);
  await saveDeployedAddress(address);
  
  return { contract: cnft as CraftiaxNFT, wallet: deployer };
}

async function waitForTransaction(tx: ethers.ContractTransactionResponse) {
  console.log(`Transaction sent: ${tx.hash}`);
  console.log('Waiting for confirmation...');
  
  try {
    const receipt = await tx.wait();
    if (!receipt) throw new Error('Transaction failed - no receipt');
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
    return receipt;
  } catch (error) {
    console.error('Transaction failed:', error);
    throw error;
  }
}

async function main() {
  const { contract: cnft, wallet } = await deployOrLoadContract();
  
  while (true) {
    console.log("\nAvailable actions:");
    console.log("1. Mint NFT");
    console.log("2. Set Base URI");
    console.log("3. Check Token URI");
    console.log("4. Pause Contract");
    console.log("5. Unpause Contract");
    console.log("6. Burn NFT");
    console.log("7. Update Verifier");
    console.log("8. Invalidate Nonce");
    console.log("9. Exit");

    const choice = await prompt("Select an action (1-9): ");

    try {
      switch (choice) {
        case "1": {
          const recipient = await prompt("Enter recipient address: ");
          const tokenURI = await prompt("Enter token URI: ");
          const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

          // Create the message hash
          const domain = {
            name: "CraftiaxNFT",
            version: "1",
            chainId: (await hre.ethers.provider.getNetwork()).chainId,
            verifyingContract: await cnft.getAddress()
          };

          const types = {
            SafeMint: [
              { name: "to", type: "address" },
              { name: "uri", type: "string" },
              { name: "nonce", type: "uint256" },
              { name: "deadline", type: "uint256" }
            ]
          };

          const value = {
            to: recipient,
            uri: tokenURI,
            nonce: await cnft.nonces(recipient),
            deadline: deadline
          };

          // Sign the message
          const signature = await wallet.signTypedData(domain, types, value);

          const tx = await cnft.safeMint(recipient, tokenURI, deadline, signature);
          await waitForTransaction(tx);
          break;
        }

        case "2": {
          const newBaseURI = await prompt("Enter new base URI: ");
          const tx = await cnft.setBaseURI(newBaseURI);
          await waitForTransaction(tx);
          break;
        }

        case "3": {
          const tokenId = await prompt("Enter token ID: ");
          const uri = await cnft.tokenURI(tokenId);
          console.log("Token URI:", uri);
          break;
        }

        case "4": {
          const tx = await cnft.pause();
          await waitForTransaction(tx);
          console.log("Contract paused");
          break;
        }

        case "5": {
          const tx = await cnft.unpause();
          await waitForTransaction(tx);
          console.log("Contract unpaused");
          break;
        }

        case "6": {
          const tokenId = await prompt("Enter token ID to burn: ");
          console.log("Initiating burn process...");
          
          const tx = await cnft.burn(tokenId);
          await waitForTransaction(tx);
          console.log(`Successfully burned token ${tokenId}`);
          break;
        }

        case "7": {
          const newVerifier = await prompt("Enter new verifier address: ");
          const tx = await cnft.updateVerifier(newVerifier);
          await waitForTransaction(tx);
          console.log("Verifier updated successfully");
          break;
        }

        case "8": {
          const userAddress = await prompt("Enter user address to invalidate nonce: ");
          const tx = await cnft.invalidateNonce(userAddress);
          await waitForTransaction(tx);
          console.log("Nonce invalidated successfully");
          break;
        }

        case "9": {
          rl.close();
          process.exit(0);
        }

        default:
          console.log("Invalid choice");
      }
    } catch (error) {
      console.error("Error:", error);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}); 