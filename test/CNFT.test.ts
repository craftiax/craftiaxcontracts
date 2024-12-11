import { expect } from "chai";
import { ethers } from "hardhat";
import { CraftiaxNFT } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("CraftiaxNFT", function () {
  let cnft: CraftiaxNFT;
  let owner: SignerWithAddress;
  let verifier: SignerWithAddress;
  let minter: SignerWithAddress;
  let recipient: SignerWithAddress;
  
  const BASE_URI = "https://api.craftiax.com/nft/";
  const MOCK_URI = "ipfs://QmXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
  
  beforeEach(async function () {
    [owner, verifier, minter, recipient] = await ethers.getSigners();
    
    const CraftiaxNFTFactory = await ethers.getContractFactory("CraftiaxNFT");
    cnft = await CraftiaxNFTFactory.deploy(
      owner.address,
      BASE_URI,
      verifier.address
    ) as CraftiaxNFT;
    await cnft.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      expect(await cnft.owner()).to.equal(owner.address);
    });

    it("Should set the correct base URI", async function () {
      const tokenId = 0;
      await mintNFT(recipient.address, MOCK_URI);
      expect(await cnft.tokenURI(tokenId)).to.include(MOCK_URI);
    });
  });

  describe("Minting", function () {
    it("Should mint NFT with valid signature", async function () {
      const deadline = await getDeadline();
      const nonce = await cnft.nonces(recipient.address);
      
      const signature = await generateSignature(
        recipient.address,
        MOCK_URI,
        nonce,
        deadline,
        verifier
      );

      await expect(cnft.connect(minter).safeMint(
        recipient.address,
        MOCK_URI,
        deadline,
        signature
      )).to.emit(cnft, "TokenMinted")
        .withArgs(recipient.address, 0, MOCK_URI);

      expect(await cnft.ownerOf(0)).to.equal(recipient.address);
    });

    it("Should reject expired signature", async function () {
      const deadline = await getDeadline(-3600); // 1 hour ago
      const nonce = await cnft.nonces(recipient.address);
      
      const signature = await generateSignature(
        recipient.address,
        MOCK_URI,
        nonce,
        deadline,
        verifier
      );

      await expect(cnft.connect(minter).safeMint(
        recipient.address,
        MOCK_URI,
        deadline,
        signature
      )).to.be.revertedWith("Signature expired");
    });

    it("Should reject invalid signature", async function () {
      const deadline = await getDeadline();
      const nonce = await cnft.nonces(recipient.address);
      
      const signature = await generateSignature(
        recipient.address,
        MOCK_URI,
        nonce,
        deadline,
        minter // Wrong signer
      );

      await expect(cnft.connect(minter).safeMint(
        recipient.address,
        MOCK_URI,
        deadline,
        signature
      )).to.be.revertedWith("Invalid signature");
    });

    it("Should reject when max supply reached", async function () {
      // First mint should succeed
      const deadline1 = await getDeadline();
      const nonce1 = await cnft.nonces(recipient.address);
      const signature1 = await generateSignature(
        recipient.address,
        MOCK_URI,
        nonce1,
        deadline1,
        verifier
      );

      await cnft.connect(minter).safeMint(
        recipient.address,
        MOCK_URI,
        deadline1,
        signature1
      );

      // Second mint should fail due to max supply
      const deadline2 = await getDeadline();
      const nonce2 = await cnft.nonces(recipient.address);
      const signature2 = await generateSignature(
        recipient.address,
        MOCK_URI,
        nonce2,
        deadline2,
        verifier
      );

      await expect(cnft.connect(minter).safeMint(
        recipient.address,
        MOCK_URI,
        deadline2,
        signature2
      )).to.be.revertedWith("Max supply reached");
    });
  });

  describe("Burning", function () {
    it("Should burn owned token", async function () {
      // Mint a token first
      const deadline = await getDeadline();
      const nonce = await cnft.nonces(recipient.address);
      const signature = await generateSignature(
        recipient.address,
        MOCK_URI,
        nonce,
        deadline,
        verifier
      );

      await cnft.connect(minter).safeMint(
        recipient.address,
        MOCK_URI,
        deadline,
        signature
      );
      
      // Now try to burn it
      await expect(cnft.connect(recipient).burn(0))
        .to.emit(cnft, "TokenBurned")
        .withArgs(recipient.address, 0);

      await expect(cnft.ownerOf(0))
        .to.be.revertedWithCustomError(cnft, "ERC721NonexistentToken");
    });

    it("Should prevent burning of non-owned token", async function () {
      await mintNFT(recipient.address, MOCK_URI);
      
      await expect(cnft.connect(minter).burn(0))
        .to.be.revertedWith("Caller is not owner or approved");
    });
  });

  describe("Admin Functions", function () {
    it("Should update base URI", async function () {
      const newBaseURI = "https://new.api.craftiax.com/nft/";
      
      await expect(cnft.connect(owner).setBaseURI(newBaseURI))
        .to.emit(cnft, "BaseURIChanged")
        .withArgs(newBaseURI);
    });

    it("Should update verifier", async function () {
      await expect(cnft.connect(owner).updateVerifier(minter.address))
        .to.emit(cnft, "VerifierUpdated")
        .withArgs(verifier.address, minter.address);
    });

    it("Should pause and unpause", async function () {
      await expect(cnft.connect(owner).pause())
        .to.emit(cnft, "ContractPaused");

      // Try minting while paused
      const deadline = await getDeadline();
      const nonce = await cnft.nonces(recipient.address);
      const signature = await generateSignature(
        recipient.address,
        MOCK_URI,
        nonce,
        deadline,
        verifier
      );

      await expect(cnft.connect(minter).safeMint(
        recipient.address,
        MOCK_URI,
        deadline,
        signature
      )).to.be.revertedWithCustomError(cnft, "EnforcedPause");

      await expect(cnft.connect(owner).unpause())
        .to.emit(cnft, "ContractUnpaused");
    });
  });

  // Helper functions
  async function getDeadline(offsetSeconds: number = 3600): Promise<number> {
    const latestBlock = await ethers.provider.getBlock('latest');
    return latestBlock!.timestamp + offsetSeconds;
  }

  async function generateSignature(
    to: string,
    uri: string,
    nonce: bigint,
    deadline: number,
    signer: SignerWithAddress
  ): Promise<string> {
    const domain = {
      name: "CraftiaxNFT",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
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
      to: to,
      uri: uri,
      nonce: nonce,
      deadline: deadline
    };

    return await signer.signTypedData(domain, types, value);
  }

  async function mintNFT(to: string, uri: string) {
    const deadline = await getDeadline();
    const nonce = await cnft.nonces(to);
    const signature = await generateSignature(
      to,
      uri,
      nonce,
      deadline,
      verifier
    );

    return cnft.connect(minter).safeMint(to, uri, deadline, signature);
  }
}); 