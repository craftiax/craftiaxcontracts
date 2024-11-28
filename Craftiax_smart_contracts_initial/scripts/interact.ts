import { ethers } from "ethers";
import readline from "readline";
import { EventTicketContract } from "../typechain-types";
import fs from 'fs';
import path from 'path';
import { abi, bytecode } from "../artifacts/contracts/event_ticket.sol/EventTicketContract.json";

const DEPLOY_FILE = path.join(__dirname, '../deployed-address.json');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function displayBalances(addresses: string[]) {
  console.log("\nCurrent Balances:");
  for (let i = 0; i < addresses.length; i++) {
    const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");
    const balance = await provider.getBalance(addresses[i]);
    console.log(`Account ${i}: ${ethers.formatEther(balance)} ETH (${addresses[i]})`);
  }
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

async function deployOrLoadContract(): Promise<{ contract: EventTicketContract; wallet: ethers.Wallet }> {
  const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY || "", provider);
  
  const deployedAddress = await loadDeployedAddress();

  if (deployedAddress) {
    const useExisting = (await prompt(`Found existing deployment at ${deployedAddress}. Use it? (yes/no): `)).toLowerCase() === 'yes';
    if (useExisting) {
      console.log("Using existing contract at:", deployedAddress);
      // Update contract factory creation
      const factory = new ethers.ContractFactory(
        // You'll need to import these from your artifacts
        abi,
        bytecode,
        wallet
      );
      return { 
        contract: (await factory.attach(deployedAddress)) as EventTicketContract,
        wallet 
      };
    }
  }

  // Update contract factory creation
  const factory = new ethers.ContractFactory(
    abi,
    bytecode,
    wallet
  );
  const eventTicket = (await factory.deploy()) as EventTicketContract;
  await eventTicket.waitForDeployment();
  
  const address = await eventTicket.getAddress();
  console.log("\nEventTicketContract deployed to:", address);
  await saveDeployedAddress(address);
  
  return { contract: eventTicket, wallet };
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

async function checkBalance(wallet: ethers.Wallet, required: bigint): Promise<boolean> {
  if (!wallet.provider) throw new Error("Wallet provider is not initialized");
  const balance = await wallet.provider.getBalance(wallet.address);
  if (balance < required) {
    console.error(`Insufficient balance. Have: ${ethers.formatEther(balance)} ETH, Need: ${ethers.formatEther(required)} ETH`);
    return false;
  }
  return true;
}

async function main() {
  const { contract: eventTicket, wallet } = await deployOrLoadContract();
  
  await displayBalances([wallet.address]);

  while (true) {
    console.log("\nAvailable actions:");
    console.log("1. Create Event");
    console.log("2. Mint Ticket");
    console.log("3. Check Event Details");
    console.log("4. Check Ticket Balance");
    console.log("5. Check Account Balances");
    console.log("6. Exit");

    const choice = await prompt("Select an action (1-6): ");

    switch (choice) {
      case "1": {
        console.log("\nCreating event as:", wallet.address);
        const eventId = await prompt("Enter event ID: ");
        const tierCount = parseInt(await prompt("Enter number of tiers: "));
        
        const prices: bigint[] = [];
        const maxQuantities: number[] = [];
        
        for (let i = 0; i < tierCount; i++) {
          const price = await prompt(`Enter price for tier ${i} (in ETH): `);
          const quantity = await prompt(`Enter max quantity for tier ${i}: `);
          prices.push(ethers.parseEther(price));
          maxQuantities.push(parseInt(quantity));
        }

        const useCommission = (await prompt("Enable commission? (yes/no): ")).toLowerCase() === "yes";
        let commissionPercentage = 0;
        let commissionAddress = ethers.ZeroAddress;

        if (useCommission) {
          commissionPercentage = parseInt(await prompt("Enter commission percentage (0-100): "));
          commissionAddress = wallet.address;
          console.log(`Using commission address: ${commissionAddress}`);
        }

        try {
          const tx = await eventTicket.connect(wallet).createEvent(
            eventId,
            prices,
            maxQuantities,
            useCommission,
            commissionPercentage,
            commissionAddress,
            {
              gasLimit: 3000000,
              maxFeePerGas: ethers.parseUnits("1.5", "gwei"),
              maxPriorityFeePerGas: ethers.parseUnits("1.5", "gwei")
            }
          );
          await waitForTransaction(tx);
        } catch (error) {
          console.error("Error creating event:", error);
        }
        break;
      }

      case "2": {
        const buyerType = await prompt("Buy as (1: wallet owner, 2: different address): ");
        let buyerAddress: string;
        
        if (buyerType === "2") {
          buyerAddress = await prompt("Enter the buyer's address: ");
          if (!ethers.isAddress(buyerAddress)) {
            console.log("Invalid address provided");
            continue;
          }
          
          const eventId = await prompt("Enter event ID: ");
          const tierId = parseInt(await prompt("Enter tier ID: "));
          const applyCommission = (await prompt("Apply commission? (yes/no): ")).toLowerCase() === "yes";
          
          try {
            const tier = await eventTicket.getEventTierDetails(eventId, tierId);
            const tierPrice = tier[0];
            
            // Create a new wallet instance connected to the buyer's address
            const buyerProvider = new ethers.JsonRpcProvider("https://sepolia.base.org");
            const buyerWallet = new ethers.Wallet(process.env.BUYER_PRIVATE_KEY || "", buyerProvider);
            if (buyerWallet.address.toLowerCase() !== buyerAddress.toLowerCase()) {
              console.log("Buyer's private key doesn't match the provided address");
              continue;
            }
            
            // Use the buyer's wallet to send the transaction
            const mintTx = await eventTicket.connect(buyerWallet).mintTicket(
              eventId,
              tierId,
              buyerAddress,
              applyCommission,
              {
                value: tierPrice,
                gasLimit: 300000,
              }
            );
            
            await waitForTransaction(mintTx);
            
          } catch (error) {
            console.error("Error minting ticket:", error);
          }
        }
        break;
      }

      case "3": {
        const eventId = await prompt("Enter event ID: ");
        try {
          const eventDetails = await eventTicket.getEventDetails(eventId);
          console.log("\nEvent Details:");
          console.log("Creator:", eventDetails[0]);
          console.log("Active:", eventDetails[1]);
          console.log("Total Tiers:", eventDetails[2].toString());
          console.log("Commission Active:", eventDetails[3]);
          console.log("Commission Percentage:", eventDetails[4].toString());
          console.log("Commission Address:", eventDetails[5]);

          const totalTiers = eventDetails[2];
          for (let i = 0; i < totalTiers; i++) {
            const tier = await eventTicket.getEventTierDetails(eventId, i);
            console.log(`\nTier ${i}:`);
            console.log(`Price: ${ethers.formatEther(tier[0])} ETH`);
            console.log(`Max Quantity: ${tier[1]}`);
            console.log(`Sold Count: ${tier[2]}`);
            console.log(`Is Active: ${tier[3]}`);
          }
        } catch (error) {
          console.error("Error fetching event details:", error);
        }
        break;
      }

      case "4": {
        const addressToCheck = await prompt("Enter address to check: ");
        const eventId = await prompt("Enter event ID: ");
        try {
          const eventDetails = await eventTicket.getEventDetails(eventId);
          const totalTiers = eventDetails[2];

          console.log(`\nChecking tickets for address: ${addressToCheck}`);
          console.log(`Event: ${eventId}`);

          for (let tierId = 0; tierId < totalTiers; tierId++) {
            const tokenId = ethers.keccak256(
              ethers.solidityPacked(["string", "uint256"], [eventId, tierId])
            );
            const balance = await eventTicket.balanceOf(addressToCheck, tokenId);
            const tier = await eventTicket.getEventTierDetails(eventId, tierId);

            console.log(`\nTier ${tierId}:`);
            console.log(`Price: ${ethers.formatEther(tier[0])} ETH`);
            console.log(`Tickets owned: ${balance.toString()}`);
          }
        } catch (error) {
          console.error("Error checking ticket balance:", error);
        }
        break;
      }

      case "5": {
        await displayBalances([wallet.address]);
        break;
      }

      case "6": {
        rl.close();
        process.exit(0);
      }

      default:
        console.log("Invalid choice");
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: any[] }) => Promise<any>;
      on: (event: string, callback: (params: any) => void) => void;
      removeListener: (event: string, callback: (params: any) => void) => void;
    };
  }
}