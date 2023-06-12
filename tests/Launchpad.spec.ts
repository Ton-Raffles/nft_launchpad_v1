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
        users = await blockchain.createWallets(10);

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
                    adminAddress: admin.address,
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

    it('should not exceed the buyer limit', async () => {
        blockchain.now = 1800000000;
        const signature = launchpad.signPurchase(adminKeypair, 123n, users[0].address);

        await launchpad.sendPurchase(users[0].getSender(), toNano('100'), 4n, signature, 123n, users[0].address);
        expect(await collection.getNextItemIndex()).toEqual(4n);

        await launchpad.sendPurchase(users[0].getSender(), toNano('100'), 2n, signature, 123n, users[0].address);
        expect(await collection.getNextItemIndex()).toEqual(5n);

        await launchpad.sendPurchase(users[0].getSender(), toNano('100'), 1n, signature, 123n, users[0].address);
        expect(await collection.getNextItemIndex()).toEqual(5n);
    });

    it('should not exceed the total limit', async () => {
        blockchain.now = 1800000000;

        for (let i = 0; i < 10; i++) {
            const signature = launchpad.signPurchase(adminKeypair, 123n, users[i].address);
            const r = await launchpad.sendPurchase(
                users[i].getSender(),
                toNano('100'),
                5n,
                signature,
                123n,
                users[i].address
            );
        }

        expect(await collection.getNextItemIndex()).toEqual(20n);
    });

    it('should reject invalid signature', async () => {
        blockchain.now = 1800000000;
        const signature = launchpad.signPurchase(adminKeypair, 456n, users[0].address);
        const res = await launchpad.sendPurchase(
            users[0].getSender(),
            toNano('2.5'),
            1n,
            signature,
            123n,
            users[0].address
        );

        expect(res.transactions).toHaveTransaction({
            on: launchpad.address,
            exitCode: 701,
        });
    });

    it('should reject wrong sender', async () => {
        blockchain.now = 1800000000;
        const signature = launchpad.signPurchase(adminKeypair, 123n, users[0].address);
        const res = await launchpad.sendPurchase(
            users[1].getSender(),
            toNano('2.5'),
            1n,
            signature,
            123n,
            users[0].address
        );

        expect(res.transactions).toHaveTransaction({
            on: launchpad.address,
            exitCode: 702,
        });
    });

    it('should reject on not enough value', async () => {
        blockchain.now = 1800000000;
        const signature = launchpad.signPurchase(adminKeypair, 123n, users[0].address);
        const res = await launchpad.sendPurchase(
            users[0].getSender(),
            toNano('2'),
            1n,
            signature,
            123n,
            users[0].address
        );

        expect(res.transactions).toHaveTransaction({
            on: launchpad.address,
            exitCode: 703,
        });
    });

    it('should reject when too early', async () => {
        blockchain.now = 1790000000;
        const signature = launchpad.signPurchase(adminKeypair, 123n, users[0].address);
        const res = await launchpad.sendPurchase(
            users[0].getSender(),
            toNano('2.5'),
            1n,
            signature,
            123n,
            users[0].address
        );

        expect(res.transactions).toHaveTransaction({
            on: launchpad.address,
            exitCode: 704,
        });
    });

    it('should reject when too late', async () => {
        blockchain.now = 1910000000;
        const signature = launchpad.signPurchase(adminKeypair, 123n, users[0].address);
        const res = await launchpad.sendPurchase(
            users[0].getSender(),
            toNano('2.5'),
            1n,
            signature,
            123n,
            users[0].address
        );

        expect(res.transactions).toHaveTransaction({
            on: launchpad.address,
            exitCode: 704,
        });
    });

    it('should reject on trying to purchase 0 NFTs by accident', async () => {
        blockchain.now = 1800000000;
        const signature = launchpad.signPurchase(adminKeypair, 123n, users[0].address);
        await launchpad.sendPurchase(users[0].getSender(), toNano('100'), 5n, signature, 123n, users[0].address);
        const res = await launchpad.sendPurchase(
            users[0].getSender(),
            toNano('2.5'),
            1n,
            signature,
            123n,
            users[0].address
        );

        expect(res.transactions).toHaveTransaction({
            on: launchpad.address,
            exitCode: 705,
        });
    });

    it('should reject on trying to purchase 0 NFTs', async () => {
        blockchain.now = 1800000000;
        const signature = launchpad.signPurchase(adminKeypair, 123n, users[0].address);
        const res = await launchpad.sendPurchase(
            users[0].getSender(),
            toNano('1'),
            0n,
            signature,
            123n,
            users[0].address
        );

        expect(res.transactions).toHaveTransaction({
            on: launchpad.address,
            exitCode: 705,
        });
    });

    it('should return unused coins', async () => {
        blockchain.now = 1800000000;
        const signature = launchpad.signPurchase(adminKeypair, 123n, users[0].address);
        const res = await launchpad.sendPurchase(
            users[0].getSender(),
            toNano('10000'),
            3n,
            signature,
            123n,
            users[0].address
        );

        expect(res.transactions).toHaveTransaction({
            from: launchpad.address,
            to: users[0].address,
            value: toNano('9993.729'),
        });
    });

    it('should work with as little coins as possible', async () => {
        blockchain.now = 1800000000;
        const signature = launchpad.signPurchase(adminKeypair, 123n, users[0].address);

        const res = await launchpad.sendPurchase(
            users[0].getSender(),
            toNano('6.269'),
            3n,
            signature,
            123n,
            users[0].address
        );
        expect(res.transactions).toHaveTransaction({
            on: launchpad.address,
            exitCode: 703,
        });

        await launchpad.sendPurchase(users[0].getSender(), toNano('6.27'), 3n, signature, 123n, users[0].address);
        expect(await collection.getNextItemIndex()).toEqual(3n);
    });

    it('should transfer funds to admin after successful purchase', async () => {
        blockchain.now = 1800000000;
        const signature = launchpad.signPurchase(adminKeypair, 123n, users[0].address);

        const res = await launchpad.sendPurchase(
            users[0].getSender(),
            toNano('6.27'),
            3n,
            signature,
            123n,
            users[0].address
        );
        expect(res.transactions).toHaveTransaction({
            from: launchpad.address,
            to: admin.address,
            value: toNano('6'),
        });
    });

    it('should change the owner of collection and set inactive', async () => {
        let result = await launchpad.sendChangeCollectionOwner(admin.getSender(), toNano('0.05'), users[0].address);
        expect(result.transactions).toHaveTransaction({
            from: launchpad.address,
            to: collection.address,
            success: true,
            op: 3,
        });
        expect(await collection.getOwner()).toEqualAddress(users[0].address);

        blockchain.now = 1800000000;
        const signature = launchpad.signPurchase(adminKeypair, 123n, users[0].address);
        result = await launchpad.sendPurchase(
            users[0].getSender(),
            toNano('2.5'),
            1n,
            signature,
            123n,
            users[0].address
        );
        expect(result.transactions).toHaveTransaction({
            from: users[0].address,
            to: launchpad.address,
            success: false,
            exitCode: 707,
        });
    });
});
