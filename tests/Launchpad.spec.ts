import { Blockchain, SandboxContract, Treasury, TreasuryContract } from '@ton-community/sandbox';
import { Cell, beginCell, toNano } from 'ton-core';
import { Launchpad } from '../wrappers/Launchpad';
import { NFTCollection } from '../wrappers/NFTCollection';
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
    let users: SandboxContract<TreasuryContract>[];

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        blockchain.now = 1700000000;

        admin = await blockchain.treasury('deployer');
        adminKeypair = keyPairFromSeed(await getSecureRandomBytes(32));
        users = await blockchain.createWallets(5);

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
                    available: 20n,
                    price: toNano('2'),
                    lastIndex: 0n,
                    collection: collection.address,
                    buyerLimit: 5n,
                    startTime: 1800000000n,
                    endTime: 1900000000n,
                },
                code
            )
        );

        let result = await launchpad.sendDeploy(admin.getSender(), toNano('0.05'));
        expect(result.transactions).toHaveTransaction({
            from: admin.address,
            to: launchpad.address,
            deploy: true,
            success: true,
        });
        result = await collection.sendDeploy(admin.getSender(), toNano('0.05'));
        expect(result.transactions).toHaveTransaction({
            from: admin.address,
            to: collection.address,
            deploy: true,
            success: true,
        });
        result = await collection.sendChangeOwner(admin.getSender(), toNano('0.05'), launchpad.address);
        expect(result.transactions).toHaveTransaction({
            to: collection.address,
            success: true,
        });
    });

    it('should deploy', async () => {});

    it('should mint one NFT', async () => {
        blockchain.now = 1800000000;
        const signature = launchpad.signPurchase(adminKeypair, 123n, users[0].address);
        const res = await launchpad.sendPurchase(
            users[0].getSender(),
            toNano('2.5'),
            1n,
            signature,
            123n,
            users[0].address
        );

        expect(await collection.getNextItemIndex()).toEqual(1n);
        const nft = blockchain.openContract(await collection.getNftItemByIndex(0n));
        expect(await nft.getOwner()).toEqualAddress(users[0].address);
    });

    it('should mint several NFTs at once', async () => {
        blockchain.now = 1800000000;
        const signature = launchpad.signPurchase(adminKeypair, 123n, users[0].address);
        await launchpad.sendPurchase(users[0].getSender(), toNano('12'), 5n, signature, 123n, users[0].address);

        expect(await collection.getNextItemIndex()).toEqual(5n);
        for (let i = 0; i < 5; i++) {
            const nft = blockchain.openContract(await collection.getNftItemByIndex(BigInt(i)));
            expect(await nft.getOwner()).toEqualAddress(users[0].address);
        }
    });

    it('should mint several NFTs in separate transactions', async () => {
        blockchain.now = 1800000000;
        const signature = launchpad.signPurchase(adminKeypair, 123n, users[0].address);

        for (let i = 0; i < 5; i++) {
            await launchpad.sendPurchase(users[0].getSender(), toNano('2.5'), 1n, signature, 123n, users[0].address);

            expect(await collection.getNextItemIndex()).toEqual(BigInt(i + 1));
            const nft = blockchain.openContract(await collection.getNftItemByIndex(BigInt(i)));
            expect(await nft.getOwner()).toEqualAddress(users[0].address);
        }
    });
});
