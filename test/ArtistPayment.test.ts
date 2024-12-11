import { expect } from "chai";
import { ethers } from "hardhat";
import { ArtistPayment, MockERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("ArtistPayment", function () {
  let artistPayment: ArtistPayment;
  let owner: SignerWithAddress;
  let artist: SignerWithAddress;
  let payer: SignerWithAddress;
  let mockUSDC: MockERC20;
  
  beforeEach(async function () {
    // Get signers
    [owner, artist, payer] = await ethers.getSigners();
    
    // Deploy mock USDC token
    const MockToken = await ethers.getContractFactory("MockERC20");
    mockUSDC = (await MockToken.deploy("USDC", "USDC", 6)) as MockERC20;
    await mockUSDC.waitForDeployment();
    
    // Deploy ArtistPayment contract
    const ArtistPaymentFactory = await ethers.getContractFactory("ArtistPayment");
    artistPayment = (await ArtistPaymentFactory.deploy(
      owner.address,
      await mockUSDC.getAddress()
    )) as ArtistPayment;
    await artistPayment.waitForDeployment();
    
    // Mint USDC to payer
    await mockUSDC.mint(payer.address, ethers.parseUnits("1000", 6));
    await mockUSDC.connect(payer).approve(await artistPayment.getAddress(), ethers.parseUnits("1000", 6));
  });

  describe("Basic Configuration", function () {
    it("Should initialize with correct values", async function () {
      expect(await artistPayment.owner()).to.equal(owner.address);
      expect(await artistPayment.craftiaxFeePercentage()).to.equal(5);
      expect(await artistPayment.MAX_FEE_PERCENTAGE()).to.equal(20);
    });

    it("Should allow owner to update fee percentage", async function () {
      await artistPayment.connect(owner).updateFeePercentage(10);
      expect(await artistPayment.craftiaxFeePercentage()).to.equal(10);
    });

    it("Should revert if non-owner tries to update fee", async function () {
      await expect(
        artistPayment.connect(artist).updateFeePercentage(10)
      ).to.be.revertedWithCustomError(artistPayment, "OwnableUnauthorizedAccount");
    });
  });

  describe("Artist Verification", function () {
    it("Should verify artist correctly", async function () {
      await artistPayment.connect(owner).setVerificationStatus(artist.address, true);
      expect(await artistPayment.isVerifiedArtist(artist.address)).to.be.true;
    });

    it("Should verify multiple artists in batch", async function () {
      const artists = [artist.address, payer.address];
      await artistPayment.connect(owner).setVerificationStatusBatch(artists, true);
      
      expect(await artistPayment.isVerifiedArtist(artist.address)).to.be.true;
      expect(await artistPayment.isVerifiedArtist(payer.address)).to.be.true;
    });
  });

  describe("Payment Processing", function () {
    it("Should process ETH payment correctly", async function () {
      const paymentAmount = ethers.parseEther("0.01");
      const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

      const artistBalanceBefore = await ethers.provider.getBalance(artist.address);
      
      await artistPayment.connect(payer).payArtist(
        artist.address,
        paymentAmount,
        0, // ETH payment
        deadline,
        { value: paymentAmount }
      );

      const artistBalanceAfter = await ethers.provider.getBalance(artist.address);
      const fee = (paymentAmount * BigInt(5)) / BigInt(100); // 5% fee
      const expectedArtistPayment = paymentAmount - fee;
      
      expect(artistBalanceAfter - artistBalanceBefore).to.equal(expectedArtistPayment);
    });

    it("Should process USDC payment correctly", async function () {
      // Set artist as verified to allow higher payment limits
      await artistPayment.connect(owner).setVerificationStatus(artist.address, true);

      // Use 100 USDC which is above the minimum (contract minimum is 0.01 USDC)
      // USDC has 6 decimals, so 100 USDC = 100 * 10^6
      const paymentAmount = ethers.parseUnits("100", 6); // 100 USDC
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      // Get balances before payment
      const artistBalanceBefore = await mockUSDC.balanceOf(artist.address);
      const craftiaxBalanceBefore = await mockUSDC.balanceOf(await artistPayment.craftiaxAddress());
      
      await artistPayment.connect(payer).payArtist(
        artist.address,
        paymentAmount,
        1, // USD payment
        deadline
      );

      // Get balances after payment
      const artistBalanceAfter = await mockUSDC.balanceOf(artist.address);
      const craftiaxBalanceAfter = await mockUSDC.balanceOf(await artistPayment.craftiaxAddress());

      // Calculate expected amounts
      const fee = (paymentAmount * BigInt(5)) / BigInt(100); // 5% fee
      const expectedArtistPayment = paymentAmount - fee;
      
      // Verify balances
      expect(artistBalanceAfter - artistBalanceBefore).to.equal(expectedArtistPayment);
      expect(craftiaxBalanceAfter - craftiaxBalanceBefore).to.equal(fee);
    });

    it("Should accept minimum USDC payment", async function () {
      // Get the minimum payment from contract
      const usdcLimits = await artistPayment.usdcLimits();
      const minPayment = usdcLimits.minPayment;
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      // Get balances before payment
      const artistBalanceBefore = await mockUSDC.balanceOf(artist.address);
      const craftiaxBalanceBefore = await mockUSDC.balanceOf(await artistPayment.craftiaxAddress());

      await expect(
        artistPayment.connect(payer).payArtist(
          artist.address,
          minPayment,
          1, // USD payment
          deadline
        )
      ).to.not.be.reverted;

      // Get balances after payment
      const artistBalanceAfter = await mockUSDC.balanceOf(artist.address);
      const craftiaxBalanceAfter = await mockUSDC.balanceOf(await artistPayment.craftiaxAddress());

      // Calculate expected amounts
      const fee = (minPayment * BigInt(5)) / BigInt(100); // 5% fee
      const expectedArtistPayment = minPayment - fee;

      // Verify balances
      expect(artistBalanceAfter - artistBalanceBefore).to.equal(expectedArtistPayment);
      expect(craftiaxBalanceAfter - craftiaxBalanceBefore).to.equal(fee);
    });

    it("Should reject below minimum USDC payment", async function () {
      const usdcLimits = await artistPayment.usdcLimits();
      const belowMin = usdcLimits.minPayment - BigInt(1);
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      await expect(
        artistPayment.connect(payer).payArtist(
          artist.address,
          belowMin,
          1, // USD payment
          deadline
        )
      ).to.be.revertedWith("Payment amount below minimum");
    });

    it("Should respect USDC payment limits for unverified artists", async function () {
      const usdcLimits = await artistPayment.usdcLimits();
      const aboveMax = usdcLimits.maxPayment + BigInt(1);
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      await expect(
        artistPayment.connect(payer).payArtist(
          artist.address,
          aboveMax,
          1, // USD payment
          deadline
        )
      ).to.be.revertedWith("Payment amount above maximum");
    });

    it("Should respect USDC payment limits for verified artists", async function () {
      // Verify the artist
      await artistPayment.connect(owner).setVerificationStatus(artist.address, true);

      const usdcLimits = await artistPayment.usdcLimits();
      const validAmount = usdcLimits.maxPayment + BigInt(1); // Amount above regular max but below verified max
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      // Should succeed because artist is verified
      await expect(
        artistPayment.connect(payer).payArtist(
          artist.address,
          validAmount,
          1, // USD payment
          deadline
        )
      ).to.not.be.reverted;
    });

    it("Should respect payment limits", async function () {
      const tooSmallAmount = ethers.parseEther("0.000001"); // Below minimum
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      await expect(
        artistPayment.connect(payer).payArtist(
          artist.address,
          tooSmallAmount,
          0, // ETH payment
          deadline,
          { value: tooSmallAmount }
        )
      ).to.be.revertedWith("Payment amount below minimum");
    });

    it("Should enforce cooldown period", async function () {
      const paymentAmount = ethers.parseEther("0.01");
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      // First payment
      await artistPayment.connect(payer).payArtist(
        artist.address,
        paymentAmount,
        0,
        deadline,
        { value: paymentAmount }
      );

      // Second payment should fail due to cooldown
      await expect(
        artistPayment.connect(payer).payArtist(
          artist.address,
          paymentAmount,
          0,
          deadline,
          { value: paymentAmount }
        )
      ).to.be.revertedWith("Too many requests");
    });
  });
}); 