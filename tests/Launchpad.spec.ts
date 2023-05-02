import { Blockchain, SandboxContract, Treasury, TreasuryContract } from '@ton-community/sandbox';
import { Cell, beginCell, toNano } from 'ton-core';
import { Launchpad } from '../wrappers/Launchpad';
import { NFTCollection } from '../wrappers/NFTCollection';
import { NFTItem } from '../wrappers/NFTItem';
import '@ton-community/test-utils';
import { compile } from '@ton-community/blueprint';
import { KeyPair, getSecureRandomBytes, keyPairFromSeed } from 'ton-crypto';

describe('Launchpad', () => {
    let code: Cell;
    let codeNFTItem: Cell;
    let codeNFTCollection: Cell;

    beforeAll(async () => {
        code = await compile('Launchpad');
        codeNFTItem = await compile('NFTItem');
        codeNFTCollection = await compile('NFTCollection');
    });

    let blockchain: Blockchain;
    let launchpad: SandboxContract<Launchpad>;
    let collection: SandboxContract<NFTCollection>;
    let admin: SandboxContract<TreasuryContract>;
    let adminKeypair: KeyPair;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        admin = await blockchain.treasury('deployer');
        adminKeypair = keyPairFromSeed(await getSecureRandomBytes(32));

        collection = blockchain.openContract(
            NFTCollection.createFromConfig(
                {
                    owner: admin.address,
                    collectionContent: beginCell().endCell(),
                    commonContent: beginCell().storeStringTail('test.com/nft/').endCell(),
                    itemCode: codeNFTItem,
                    royaltyFactor: 1n,
                    royaltyBase: 1n,
                },
                codeNFTCollection
            )
        );

        launchpad = blockchain.openContract(
            Launchpad.createFromConfig(
                {
                    adminPubkey: adminKeypair.publicKey,
                    available: 10n,
                    price: toNano('2'),
                    lastIndex: 0n,
                    collection: collection.address,
                    buyerLimit: 2n,
                    startTime: 1000000n,
                    endTime: 2000000n,
                },
                code
            )
        );

        let deployResult = await launchpad.sendDeploy(admin.getSender(), toNano('0.05'));
        expect(deployResult.transactions).toHaveTransaction({
            from: admin.address,
            to: launchpad.address,
            deploy: true,
            success: true,
        });
        deployResult = await collection.sendDeploy(admin.getSender(), toNano('0.05'));
        expect(deployResult.transactions).toHaveTransaction({
            from: admin.address,
            to: collection.address,
            deploy: true,
            success: true,
        });
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
        // blockchain and launchpad are ready to use
    });
});
