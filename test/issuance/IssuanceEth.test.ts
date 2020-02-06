import * as chai from 'chai';
// tslint:disable-next-line:no-var-requires
const { balance, BN, ether, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
import { IssuanceEthInstance, ERC20MintableDetailedInstance } from '../../types/truffle-contracts';

const IssuanceEth = artifacts.require('IssuanceEth') as Truffle.Contract<IssuanceEthInstance>;
const ERC20MintableDetailed = artifacts.require(
        'ERC20MintableDetailed'
    ) as Truffle.Contract<ERC20MintableDetailedInstance>;

// tslint:disable-next-line:no-var-requires
chai.use(require('chai-bn')(require('bn.js')));
chai.should();

contract('IssuanceEth', (accounts) => {

    const investor1 = accounts[1];
    const investor2 = accounts[2];
    const wallet = accounts[3];

    let issuanceEth: IssuanceEthInstance;
    let issuanceToken: ERC20MintableDetailedInstance;

    beforeEach(async () => {
        issuanceToken = await ERC20MintableDetailed.new('IssuanceToken', 'ISST', 17);
        issuanceEth = await IssuanceEth.new(issuanceToken.address);
        await issuanceToken.addMinter(issuanceEth.address);
    });

    /**
     * @test {Issuance#invest}
     */
    it('cannot open issuanceEth without issue price', async () => {
        await issuanceEth.setIssuePrice(0);
        await expectRevert(issuanceEth.startIssuance(), 'Issue price not set.');
    });

    describe('Open issuance', () => {

        beforeEach(async () => {
            await issuanceEth.setIssuePrice(ether('0.05'));
        });

        /**
         * @test {Issuance#startIssuance}
         */
        it('startIssuance can succefully open the Issuance', async () => {
            await issuanceEth.startIssuance();
            chai.expect(bytes32ToString(await issuanceEth.currentState())).to.be.equal('OPEN');
        });

        describe('Invest', () => {

            beforeEach(async () => {
                await issuanceEth.startIssuance();
            });

            /**
             * @test {Issuance#invest}
             */
            it('invest should succesfully invest', async () => {
                expectEvent(
                    await issuanceEth.invest({ from: investor1, value: ether('0.5').toString() }),
                    'InvestmentAdded',
                    {
                        amount: ether('0.5'),
                        investor: investor1,
                    },
                );
            });

            describe('Start distribution', () => {

                beforeEach(async () => {
                    await issuanceEth.invest({ from: investor1, value: ether('0.5').toString() });
                    await issuanceEth.invest({ from: investor2, value: ether('0.1').toString() });
                });

                /**
                 * @test {Issuance#startDistribution}
                 */
                it('startDistribution can succesfully close the Issuance', async () => {
                    await issuanceEth.startDistribution();
                    chai.expect(bytes32ToString(await issuanceEth.currentState())).to.be.equal('LIVE');
                });

                describe('Claim & Withdraw', () => {

                    beforeEach(async () => {
                        await issuanceEth.startDistribution();
                    });

                    /**
                     * @test {Issuance#claim}
                     */
                    it('claim sends tokens to investors', async () => {
                        await issuanceEth.claim({ from: investor1 });
                        await issuanceEth.claim({ from: investor2 });
                        BN(await issuanceToken.balanceOf(investor1)).should.be.bignumber.equal(ether('1'));
                        BN(await issuanceToken.balanceOf(investor2)).should.be.bignumber.equal(ether('0.2'));
                    });

                    /**
                     * @test {Issuance#withdraw}
                     */
                    it('withdraw should transfer all collected tokens to the wallet of the owner', async () => {
                        await issuanceEth.claim({ from: investor1 });
                        await issuanceEth.claim({ from: investor2 });
                        const trackerWallet = await balance.tracker(wallet);
                        trackerWallet.get();
                        await issuanceEth.withdraw(wallet);
                        (await trackerWallet.delta()).should.be.bignumber.equal(ether('0.6'));
                    });

                    describe('Cancel fail', () => {

                        /**
                         * @test {Issuance#cancelInvestment}
                         */
                        it('cannot cancel investment when state is not "OPEN" or "FAILED"', async () => {
                            await expectRevert(
                                issuanceEth.cancelInvestment({ from: investor1 }),
                                'Cannot cancel now.',
                            );
                        });

                    });

                });

                describe('Claim fail', () => {

                    /**
                     * @test {Issuance#claim}
                     */
                    it('cannot claim when state is not "LIVE"', async () => {
                        await expectRevert(
                            issuanceEth.claim({ from: investor1 }),
                            'Cannot claim now.',
                        );
                    });

                });

                describe('Cancel', () => {

                    /**
                     * @test {Issuance#cancelInvestment}
                     */
                    it('cancelInvestment should cancel an investor investments', async () => {
                        await issuanceEth.invest({ from: investor1, value: ether('0.1').toString() });
                        expectEvent(
                            await issuanceEth.cancelInvestment({ from: investor1 }),
                            'InvestmentCancelled',
                            {
                                amount: ether('0.6'),
                                investor: investor1,
                            },
                        );
                    });

                    /**
                     * @test {Issuance#cancelAllInvestments}
                     */
                    it('cancelAllInvestments should begin the process to cancel all investor investments', async () => {
                        await issuanceEth.cancelAllInvestments();
                        bytes32ToString(await issuanceEth.currentState()).should.be.equal('FAILED');
                        await issuanceEth.cancelInvestment({ from: investor1 });
                        await issuanceEth.cancelInvestment({ from: investor2 });
                        (await balance.current(issuanceEth.address)).should.be.bignumber.equal(ether('0'));
                    });

                });

                describe('Withdraw fail', () => {

                    /**
                     * @test {Issuance#withdraw}
                     */
                    it('cannot transfer funds when issuanceEth state is not "LIVE"', async () => {
                        await expectRevert(
                            issuanceEth.withdraw(wallet),
                            'Cannot withdraw funds now.',
                        );
                    });

                });

            });

            describe('Not invested', () => {

                /**
                 * @test {Issuance#claim}
                 */
                it('cannot claim when not invested', async () => {
                    await issuanceEth.invest({ from: investor1, value: ether('0.5').toString() });
                    await issuanceEth.startDistribution();
                    await expectRevert(
                        issuanceEth.claim({ from: investor2 }),
                        'No investments found.',
                    );
                });

                /**
                 * @test {Issuance#cancelInvestment}
                 */
                it('cannot cancel investment when not invested', async () => {
                    await expectRevert(
                        issuanceEth.cancelInvestment({ from: investor1 }),
                        'No investments found.',
                    );
                });

            });

        });

        describe('Invest fail', () => {
            /**
             * @test {Issuance#invest}
             */
            it('cannot invest if state is not "OPEN"', async () => {
                await expectRevert(
                    issuanceEth.invest({ from: investor1, value: ether('0.5').toString() }),
                    'Not open for investments.',
                );
            });

            /**
             * @test {Issuance#invest}
             */
            it('cannot invest with fractional investments', async () => {
                await issuanceEth.startIssuance();
                await expectRevert(
                    issuanceEth.invest({ from: investor1, value: ether('0.5').add(new BN('1')).toString() }),
                    'Fractional investments not allowed.',
                );
            });

        });

    });

});

function bytes32ToString(text: string) {
    return web3.utils.toAscii(text).replace(/\0/g, '');
}
