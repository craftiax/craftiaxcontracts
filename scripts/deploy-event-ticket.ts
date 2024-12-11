import { ethers } from "hardhat";
import readline from "readline";
import fs from 'fs';
import path from 'path';

const DEPLOY_FILE = path.join(__dirname, '../deployed-event-ticket-address.json');

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

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  // Get USDC token address for the network
  const usdcAddress = await prompt("Enter USDC token address: ");
  
  // Deploy EventTicketContract
  const EventTicketContract = await ethers.getContractFactory("EventTicketContract");
  const eventTicket = await EventTicketContract.deploy(usdcAddress);
  await eventTicket.waitForDeployment();

  const contractAddress = await eventTicket.getAddress();
  console.log("EventTicketContract deployed to:", contractAddress);
  
  await saveDeployedAddress(contractAddress);
  
  // Verify deployment
  console.log("\nDeployment verified with following details:");
  console.log("USDC Token:", usdcAddress);
  console.log("Contract Owner:", deployer.address);
  
  rl.close();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 