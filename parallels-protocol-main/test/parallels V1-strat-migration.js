const { ethers } = require("hardhat")
const { expect } = require("chai");

const VAULT = "0x2dCz3..."
const GUEST_LIST = "0xcB16..."
const INVERSE_DEPLOYER = "0x3FcB3..."
const YDAI = "0xBFa4..."
const DEPOSITOR = "0x3c70p..." // has lots of tokens
const TIMELOCK = "0x446C6..."
const CTOKEN_STRAT = "0x42bE0..."
const DAI = "0x6b175..."

const overrides = {
    gasPrice:ethers.utils.parseUnits("0", "gwei")
}

describe("parallels v1 migration", function() {

    let strat, vault, dai;

    it("Should deploy new strategy", async function() {
        await hre.network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [INVERSE_DEPLOYER]}
        )
        const signer = await ethers.provider.getSigner(INVERSE_DEPLOYER);
        let Strat = await ethers.getContractFactory("YTokenStrat");
        Strat = Strat.connect(signer)
        strat = await Strat.deploy(VAULT, YDAI, overrides);

        await strat.deployed();
    })

    it("Should whitelist strategy", async function() {
        const signer = await ethers.provider.getSigner(INVERSE_DEPLOYER);
        let guestList = await ethers.getContractAt("GuestList", GUEST_LIST);
        guestList = guestList.connect(signer);
        const tx = await guestList.invite_guest(strat.address, overrides);
        await tx.wait()
        expect(await guestList.authorized(strat.address, ethers.utils.parseEther("250000"))).to.equal(true);
    })

    it("Should set strategy using timelock", async function() {
        const cTokenStrat = await ethers.getContractAt("IStrat", CTOKEN_STRAT);
        const totalValue = await cTokenStrat.callStatic.calcTotalValue()
        const signer = await ethers.provider.getSigner(INVERSE_DEPLOYER);
        let timelock = await ethers.getContractAt("Timelock", TIMELOCK);
        timelock = timelock.connect(signer);
        const signature = "setStrat(address,bool)"
        const abiCoder = new ethers.utils.AbiCoder();
        const data = abiCoder.encode(["address", "bool"], [strat.address, true]);
        const eta = (await timelock.delay()).add(Math.ceil(Date.now()/1000)).add(60).toNumber() // delay + 60 seconds
        const tx = await timelock.queueTransaction(VAULT, 0, signature, data, eta);
        await tx.wait()
        await hre.network.provider.request({
            method: "evm_setNextBlockTimestamp",
            params: [eta + 1]}
        )
        const tx2 = await timelock.executeTransaction(VAULT, 0, signature, data, eta);
        await tx2.wait()
        const oldStratValue = await cTokenStrat.callStatic.calcTotalValue()
        expect(oldStratValue).to.lt(ethers.utils.parseEther("1"));
        const newStratValue = await strat.calcTotalValue()
        expect(totalValue.sub(newStratValue)).to.lt(ethers.utils.parseEther("1"))
    })

    it("Should withdraw", async function() {
        const amount = 2
        await hre.network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [DEPOSITOR]}
        )
        const signer = await ethers.provider.getSigner(DEPOSITOR);
        vault = await ethers.getContractAt("EthVault", VAULT)
        vault = vault.connect(signer)
        dai = await ethers.getContractAt("IERC20", DAI);
        dai = dai.connect(signer);
        const oldBalance = await dai.balanceOf(DEPOSITOR);
        const tx = await vault.withdraw(amount);
        await tx.wait()
        const newBalance = await dai.balanceOf(DEPOSITOR)
        expect(newBalance.sub(oldBalance)).to.equal(amount)
    })

})