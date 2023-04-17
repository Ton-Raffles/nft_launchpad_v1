import { Blockchain, SandboxContract } from '@ton-community/sandbox';
import { Cell, toNano } from 'ton-core';
import { Launchpad } from '../wrappers/Launchpad';
import '@ton-community/test-utils';
import { compile } from '@ton-community/blueprint';

describe('Launchpad', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('Launchpad');
    });

    let blockchain: Blockchain;
    let launchpad: SandboxContract<Launchpad>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        launchpad = blockchain.openContract(Launchpad.createFromConfig({}, code));

        const deployer = await blockchain.treasury('deployer');

        const deployResult = await launchpad.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: launchpad.address,
            deploy: true,
            success: true,
        });
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
        // blockchain and launchpad are ready to use
    });
});
