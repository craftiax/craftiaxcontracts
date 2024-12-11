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
}); 