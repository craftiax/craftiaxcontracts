import { expect } from "chai";
import { ethers } from "hardhat";
import { ArtistPayment } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

// Add helper functions
async function getDeadline(offsetSeconds: number = 3600): Promise<number> {
    const latestTime = await time.latest();
    return latestTime + offsetSeconds;
}

async function getPaymentSignature(
    artistPayment: ArtistPayment,
    verifier: SignerWithAddress,
    artist: string,
    amount: bigint,
    nonce: number,
    deadline: number
) {
    const domain = {
        name: "ArtistPayment",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await artistPayment.getAddress()
    };

    const types = {
        PayArtist: [
            { name: "artist", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
            { name: "chainId", type: "uint256" }
        ]
    };

    const value = {
        artist: artist,
        amount: amount,
        nonce: nonce,
        deadline: deadline,
        chainId: domain.chainId
    };

    return await verifier.signTypedData(domain, types, value);
}

describe("ArtistPayment", function () {
    let artistPayment: ArtistPayment;
    let owner: SignerWithAddress;
    let verifier: SignerWithAddress;
    let artist: SignerWithAddress;
    let payer: SignerWithAddress;
    let craftiax: SignerWithAddress;

    const DOMAIN_NAME = "ArtistPayment";
    const DOMAIN_VERSION = "1";
    
    beforeEach(async function () {
        [owner, verifier, artist, payer, craftiax] = await ethers.getSigners();
        
        const ArtistPaymentFactory = await ethers.getContractFactory("ArtistPayment");
        artistPayment = await ArtistPaymentFactory.deploy(owner.address) as ArtistPayment;
        await artistPayment.waitForDeployment();

        // Set up initial state
        await artistPayment.updateCraftiaxAddress(craftiax.address);
        await artistPayment.updateVerifier(verifier.address);
    });

    describe("Basic Configuration", function () {
        it("Should initialize with correct values", async function () {
            expect(await artistPayment.craftiaxFeePercentage()).to.equal(5);
            expect(await artistPayment.craftiaxAddress()).to.equal(craftiax.address);
        });

        it("Should update fee percentage correctly", async function () {
            await artistPayment.updateFeePercentage(10);
            expect(await artistPayment.craftiaxFeePercentage()).to.equal(10);
        });

        it("Should revert if fee percentage exceeds maximum", async function () {
            await expect(artistPayment.updateFeePercentage(21))
                .to.be.revertedWith("Fee exceeds maximum allowed");
        });
    });

    describe("Artist Verification", function () {
        it("Should verify artist correctly", async function () {
            await artistPayment.setVerificationStatus(artist.address, true);
            expect(await artistPayment.isVerifiedArtist(artist.address)).to.be.true;
        });

        it("Should verify multiple artists in batch", async function () {
            const artists = [artist.address, payer.address];
            await artistPayment.setVerificationStatusBatch(artists, true);
            
            expect(await artistPayment.isVerifiedArtist(artist.address)).to.be.true;
            expect(await artistPayment.isVerifiedArtist(payer.address)).to.be.true;
        });
    });

    describe("Payment Processing", function () {
        it("Should process payment correctly", async function () {
            const paymentAmount = ethers.parseEther("0.1");
            const deadline = await getDeadline();
            const nonce = await artistPayment.nonces(payer.address);
            
            const signature = await getPaymentSignature(
                artistPayment,
                verifier,
                artist.address,
                paymentAmount,
                Number(nonce),
                deadline
            );

            const artistBalanceBefore = await ethers.provider.getBalance(artist.address);
            const craftiaxBalanceBefore = await ethers.provider.getBalance(craftiax.address);

            await expect(artistPayment.connect(payer).payArtist(
                artist.address,
                deadline,
                signature,
                { value: paymentAmount }
            )).to.emit(artistPayment, "PaymentProcessed");

            const artistBalanceAfter = await ethers.provider.getBalance(artist.address);
            const craftiaxBalanceAfter = await ethers.provider.getBalance(craftiax.address);

            // Check fee calculation (5% fee)
            const expectedFee = (paymentAmount * BigInt(5)) / BigInt(100);
            const expectedArtistPayment = paymentAmount - expectedFee;

            expect(artistBalanceAfter - artistBalanceBefore).to.equal(expectedArtistPayment);
            expect(craftiaxBalanceAfter - craftiaxBalanceBefore).to.equal(expectedFee);
        });

        it("Should revert on expired signature", async function () {
            const paymentAmount = ethers.parseEther("0.1");
            const deadline = await getDeadline(-3600); // 1 hour ago
            const nonce = await artistPayment.nonces(payer.address);
            
            const signature = await getPaymentSignature(
                artistPayment,
                verifier,
                artist.address,
                paymentAmount,
                Number(nonce),
                deadline
            );

            await expect(artistPayment.connect(payer).payArtist(
                artist.address,
                deadline,
                signature,
                { value: paymentAmount }
            )).to.be.revertedWith("Signature expired");
        });

        it("Should revert on invalid payment amount", async function () {
            const paymentAmount = ethers.parseEther("0.000001"); // Too small
            const deadline = await getDeadline();
            const nonce = await artistPayment.nonces(payer.address);
            
            const signature = await getPaymentSignature(
                artistPayment,
                verifier,
                artist.address,
                paymentAmount,
                Number(nonce),
                deadline
            );

            await expect(artistPayment.connect(payer).payArtist(
                artist.address,
                deadline,
                signature,
                { value: paymentAmount }
            )).to.be.revertedWith("Payment amount below minimum");
        });
    });

    describe("Security Features", function () {
        it("Should invalidate nonce correctly", async function () {
            await artistPayment.invalidateNonce(payer.address);
            expect(await artistPayment.nonces(payer.address))
                .to.equal(ethers.MaxUint256);
        });

        it("Should handle rate limiting", async function () {
            const paymentAmount = ethers.parseEther("0.1");
            const deadline = await getDeadline(7200); // Set deadline further in future
            
            // First payment
            const nonce1 = await artistPayment.nonces(payer.address);
            const signature1 = await getPaymentSignature(
                artistPayment,
                verifier,
                artist.address,
                paymentAmount,
                Number(nonce1),
                deadline
            );

            // Make first payment
            await artistPayment.connect(payer).payArtist(
                artist.address,
                deadline,
                signature1,
                { value: paymentAmount }
            );

            // Attempt second payment immediately
            const nonce2 = await artistPayment.nonces(payer.address);
            const signature2 = await getPaymentSignature(
                artistPayment,
                verifier,
                artist.address,
                paymentAmount,
                Number(nonce2),
                deadline
            );

            // This should fail due to rate limiting
            await expect(
                artistPayment.connect(payer).payArtist(
                    artist.address,
                    deadline,
                    signature2,
                    { value: paymentAmount }
                )
            ).to.be.revertedWith("Too many requests");

            // Wait for cooldown period
            await ethers.provider.send("evm_increaseTime", [61]); // Wait 61 seconds
            await ethers.provider.send("evm_mine", []); // Mine a new block

            // Third payment should now succeed
            const nonce3 = await artistPayment.nonces(payer.address);
            const signature3 = await getPaymentSignature(
                artistPayment,
                verifier,
                artist.address,
                paymentAmount,
                Number(nonce3),
                deadline
            );

            await expect(
                artistPayment.connect(payer).payArtist(
                    artist.address,
                    deadline,
                    signature3,
                    { value: paymentAmount }
                )
            ).to.not.be.reverted;
        });
    });
}); 