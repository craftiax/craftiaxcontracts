import { expect } from "chai";
import { ethers } from "hardhat";
import { EventTicketManager, MockERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("EventTicketContract", function () {
  let eventTicket: EventTicketManager;
  let owner: SignerWithAddress;
  let organizer: SignerWithAddress;
  let buyer: SignerWithAddress;
  let mockUSDC: MockERC20;
  
  const MOCK_EVENT_ID = "event1";
  const MOCK_TIER_ID = "tier1";
  
  beforeEach(async function () {
    // Get signers
    [owner, organizer, buyer] = await ethers.getSigners();
    
    // Deploy mock USDC token
    const MockToken = await ethers.getContractFactory("MockERC20");
    mockUSDC = (await MockToken.deploy("USDC", "USDC", 6)) as MockERC20;
    await mockUSDC.waitForDeployment();
    
    // Deploy EventTicketContract
    const EventTicketFactory = await ethers.getContractFactory("EventTicketManager");
    eventTicket = (await EventTicketFactory.deploy(await mockUSDC.getAddress())) as EventTicketManager;
    await eventTicket.waitForDeployment();
    
    // Mint USDC to buyer
    await mockUSDC.mint(buyer.address, ethers.parseUnits("1000", 6));
    await mockUSDC.connect(buyer).approve(await eventTicket.getAddress(), ethers.parseUnits("1000", 6));
  });

  describe("Event Creation", function () {
    it("Should create an event successfully", async function () {
      const startTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      const endTime = startTime + 3600; // 2 hours from now
      
      await expect(eventTicket.connect(organizer).createEvent(
        MOCK_EVENT_ID,
        "Test Event",
        "Test Description",
        startTime,
        endTime,
        [MOCK_TIER_ID],
        [ethers.parseEther("0.1")], // prices
        [100], // maxQuantities
        0, // ETH payment
        10, // 10% commission
        owner.address // commission recipient
      )).to.not.be.reverted;
      
      const eventDetails = await eventTicket.getEventDetails(MOCK_EVENT_ID);
      expect(eventDetails.creator).to.equal(organizer.address);
    });
  });

  describe("Ticket Minting", function () {
    beforeEach(async function () {
      const startTime = Math.floor(Date.now() / 1000) + 60; // Start 1 minute from now
      const endTime = startTime + 3600; // End 1 hour after start
      
      await eventTicket.connect(organizer).createEvent(
        MOCK_EVENT_ID,
        "Test Event",
        "Test Description",
        startTime,
        endTime,
        [MOCK_TIER_ID],
        [ethers.parseEther("0.1")],
        [100],
        0, // ETH payment
        10, // 10% commission
        owner.address
      );

      // Fast forward time to after start time
      await ethers.provider.send("evm_increaseTime", [61]); // Move 61 seconds forward
      await ethers.provider.send("evm_mine"); // Mine a new block
    });

    it("Should mint ticket with ETH payment", async function () {
      await expect(eventTicket.connect(buyer).mintTicket(
        MOCK_EVENT_ID,
        MOCK_TIER_ID,
        buyer.address,
        { value: ethers.parseEther("0.1") }
      )).to.not.be.reverted;

      const tokenId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["string", "string"],
          [MOCK_EVENT_ID, MOCK_TIER_ID]
        )
      );

      const balance = await eventTicket.balanceOf(buyer.address, tokenId);
      expect(balance).to.equal(1);
    });
  });

  describe("Event Management", function () {
    it("Should return correct event status", async function () {
      const startTime = Math.floor(Date.now() / 1000) + 3600;
      const endTime = startTime + 3600;
      
      await eventTicket.connect(organizer).createEvent(
        MOCK_EVENT_ID,
        "Test Event",
        "Test Description",
        startTime,
        endTime,
        [MOCK_TIER_ID],
        [ethers.parseEther("0.1")],
        [100],
        0,
        10,
        owner.address
      );

      const tierDetails = await eventTicket.getEventTierDetails(MOCK_EVENT_ID, MOCK_TIER_ID);
      expect(tierDetails.maxQuantity).to.equal(100);
      expect(tierDetails.soldCount).to.equal(0);
    });
  });

  describe("Price Scaling", function () {
    it("Should handle USDC decimal scaling correctly", async function () {
        // Set start time further in future (3600 seconds = 1 hour)
        const startTime = Math.floor(Date.now() / 1000) + 3600; 
        const endTime = startTime + 3600; // End time 1 hour after start
        const price = ethers.parseEther("0.1");
        
        await eventTicket.connect(organizer).createEvent(
            MOCK_EVENT_ID,
            "Test Event",
            "Test Description",
            startTime,
            endTime,
            [MOCK_TIER_ID],
            [price],
            [100],
            1, // USD payment
            10,
            owner.address
        );

        // Fast forward time to just after start time
        await ethers.provider.send("evm_setNextBlockTimestamp", [startTime + 1]);
        await ethers.provider.send("evm_mine");

        // Calculate expected USDC amount (6 decimals)
        const expectedUSDC = price / BigInt(10n ** 12n);
        
        // Check USDC balance before
        const balanceBefore = await mockUSDC.balanceOf(buyer.address);
        
        // Mint ticket
        await eventTicket.connect(buyer).mintTicket(
            MOCK_EVENT_ID,
            MOCK_TIER_ID,
            buyer.address
        );

        // Check USDC balance after
        const balanceAfter = await mockUSDC.balanceOf(buyer.address);
        expect(balanceBefore - balanceAfter).to.equal(expectedUSDC);
    });

    it("Should revert on price too small after scaling", async function () {
        // Get current block timestamp
        const latestBlock = await ethers.provider.getBlock('latest');
        const currentTimestamp = latestBlock!.timestamp;
        
        // Set event times relative to current block
        const startTime = currentTimestamp + 3600; // 1 hour from current block
        const endTime = startTime + 3600; // 2 hours from current block
        
        // Calculate a price that will definitely scale to 0
        // USDC has 6 decimals, ETH has 18 decimals
        // We need a price that's valid (>= 0.0001 ETH) but scales to 0 in USDC
        const smallPrice = BigInt(1e11); // This is below MIN_PRICE but above 0 when scaled
        
        // Create event with a valid minimum price
        await eventTicket.connect(organizer).createEvent(
            MOCK_EVENT_ID,
            "Test Event",
            "Test Description",
            startTime,
            endTime,
            [MOCK_TIER_ID],
            [ethers.parseEther("0.0001")], // Use MIN_PRICE for creation
            [100],
            1, // USD payment
            10,
            owner.address
        );

        // Update the price to our small amount that will scale to 0
        await eventTicket.connect(organizer).updateTierPrice(MOCK_EVENT_ID, MOCK_TIER_ID, smallPrice);

        // Fast forward time to just after start time
        await ethers.provider.send("evm_setNextBlockTimestamp", [startTime + 1]);
        await ethers.provider.send("evm_mine");

        // Attempt to mint ticket - should fail because the scaled amount will be 0
        await expect(eventTicket.connect(buyer).mintTicket(
            MOCK_EVENT_ID,
            MOCK_TIER_ID,
            buyer.address
        )).to.be.revertedWith("Scaled amount too small");
    });
  });
}); 