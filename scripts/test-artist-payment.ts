import { ethers } from "hardhat";
import { ArtistPayment, MockERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function deployOrLoadContract() {
  const [owner, artist, payer] = await ethers.getSigners();
  
  // Deploy mock USDC
  const MockToken = await ethers.getContractFactory("MockERC20");
  const mockUSDC = await MockToken.deploy("USDC", "USDC", 6);
  await mockUSDC.waitForDeployment();
  
  // Deploy ArtistPayment
  const ArtistPaymentFactory = await ethers.getContractFactory("ArtistPayment");
  const artistPayment = await ArtistPaymentFactory.deploy(
    owner.address,
    await mockUSDC.getAddress()
  );
  await artistPayment.waitForDeployment();

  // Mint USDC to payer
  await mockUSDC.mint(payer.address, ethers.parseUnits("1000", 6));
  await mockUSDC.connect(payer).approve(
    await artistPayment.getAddress(), 
    ethers.parseUnits("1000", 6)
  );

  return {
    contract: artistPayment,
    usdcToken: mockUSDC,
    owner,
    artist,
    payer
  };
}

async function main() {
  const { contract, usdcToken, owner, artist, payer } = await deployOrLoadContract();
  
  while (true) {
    console.log("\nArtist Payment Testing Interface");
    console.log("--------------------------------");
    console.log("1. Process ETH Payment");
    console.log("2. Process USDC Payment");
    console.log("3. Verify Artist");
    console.log("4. Update Fee Percentage");
    console.log("5. Update Payment Limits");
    console.log("6. Check Artist Status");
    console.log("7. Check Payment Limits");
    console.log("8. Batch Verify Artists");
    console.log("9. Exit");

    const choice = await prompt("\nSelect an action (1-9): ");

    try {
      switch (choice) {
        case "1": {
          const amount = ethers.parseEther(
            await prompt("Enter ETH amount: ")
          );
          const deadline = Math.floor(Date.now() / 1000) + 3600;

          console.log("Processing ETH payment...");
          const tx = await contract.connect(payer).payArtist(
            artist.address,
            amount,
            0, // ETH payment
            deadline,
            { value: amount }
          );
          await tx.wait();
          console.log("Payment processed successfully!");
          break;
        }

        case "2": {
          const amount = ethers.parseUnits(
            await prompt("Enter USDC amount: "),
            6
          );
          const deadline = Math.floor(Date.now() / 1000) + 3600;

          console.log("Processing USDC payment...");
          const tx = await contract.connect(payer).payArtist(
            artist.address,
            amount,
            1, // USDC payment
            deadline
          );
          await tx.wait();
          console.log("Payment processed successfully!");
          break;
        }

        case "3": {
          const artistAddr = await prompt("Enter artist address: ");
          const status = (await prompt("Verify artist? (y/n): ")).toLowerCase() === 'y';
          
          await contract.connect(owner).setVerificationStatus(artistAddr, status);
          console.log(`Artist verification status updated to: ${status}`);
          break;
        }

        case "4": {
          const newFee = await prompt("Enter new fee percentage (0-20): ");
          await contract.connect(owner).updateFeePercentage(parseInt(newFee));
          console.log("Fee percentage updated successfully!");
          break;
        }

        case "5": {
          const currency = (await prompt("Update limits for (eth/usdc): ")).toLowerCase();
          const min = ethers.parseUnits(await prompt("Enter minimum payment: "), 
            currency === "usdc" ? 6 : 18);
          const max = ethers.parseUnits(await prompt("Enter maximum payment: "), 
            currency === "usdc" ? 6 : 18);
          const verifiedMax = ethers.parseUnits(
            await prompt("Enter verified maximum payment: "), 
            currency === "usdc" ? 6 : 18
          );

          if (currency === "usdc") {
            await contract.connect(owner).updateUSDCPaymentLimits(min, max, verifiedMax);
          } else {
            await contract.connect(owner).updatePaymentLimits(min, max, verifiedMax);
          }
          console.log("Payment limits updated successfully!");
          break;
        }

        case "6": {
          const artistAddr = await prompt("Enter artist address: ");
          const isVerified = await contract.isVerifiedArtist(artistAddr);
          console.log(`Artist verification status: ${isVerified}`);
          break;
        }

        case "7": {
          const ethLimits = await contract.ethLimits();
          const usdcLimits = await contract.usdcLimits();
          
          console.log("\nETH Limits:");
          console.log(`Min: ${ethers.formatEther(ethLimits.minPayment)} ETH`);
          console.log(`Max: ${ethers.formatEther(ethLimits.maxPayment)} ETH`);
          console.log(`Verified Max: ${ethers.formatEther(ethLimits.verifiedMaxPayment)} ETH`);
          
          console.log("\nUSDC Limits:");
          console.log(`Min: ${ethers.formatUnits(usdcLimits.minPayment, 6)} USDC`);
          console.log(`Max: ${ethers.formatUnits(usdcLimits.maxPayment, 6)} USDC`);
          console.log(`Verified Max: ${ethers.formatUnits(usdcLimits.verifiedMaxPayment, 6)} USDC`);
          break;
        }

        case "8": {
          const addresses = (await prompt("Enter comma-separated artist addresses: ")).split(",");
          const status = (await prompt("Verify artists? (y/n): ")).toLowerCase() === 'y';
          
          await contract.connect(owner).setVerificationStatusBatch(addresses, status);
          console.log("Batch verification completed successfully!");
          break;
        }

        case "9": {
          console.log("Exiting...");
          rl.close();
          return;
        }

        default: {
          console.log("Invalid choice. Please try again.");
        }
      }
    } catch (error) {
      console.error("Error:", error.message);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}); 