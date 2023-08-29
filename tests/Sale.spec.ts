import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, beginCell, toNano } from '@ton/core';
import { Sale } from '../wrappers/Sale';
import { NFTCollection } from '../wrappers/NFTCollection';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { KeyPair, getSecureRandomBytes, keyPairFromSeed } from '@ton/crypto';
import { Helper } from '../wrappers/Helper';

describe('Sale', () => {
    let code: Cell;
    let codeNFTItem: Cell;
    let codeNFTCollection: Cell;
    let helperCode: Cell;

    beforeAll(async () => {
        code = await compile('Sale');
        codeNFTItem = await compile('NFTItem');
        codeNFTCollection = await compile('NFTCollection');
        helperCode = await compile('Helper');
    });

    let blockchain: Blockchain;
    let sale: SandboxContract<Sale>;
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
                    royaltyAddress: admin.address,
                },
                codeNFTCollection
            )
        );

        sale = blockchain.openContract(
            Sale.createFromConfig(
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
                    helperCode,
                    affilatePercentage: 500n,
                },
                code
            )
        );

        let result = await sale.sendDeploy(admin.getSender(), toNano('0.05'));
        expect(result.transactions).toHaveTransaction({
            from: admin.address,
            to: sale.address,
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
        result = await collection.sendChangeOwner(admin.getSender(), toNano('0.05'), sale.address);
        expect(result.transactions).toHaveTransaction({
            to: collection.address,
            success: true,
        });
    });

    it('should deploy', async () => {});

    it('should mint one NFT', async () => {
        blockchain.now = 1800000000;
        const signature = sale.signPurchase(adminKeypair, users[0].address, BigInt(blockchain.now));
        const res = await sale.sendPurchase(
            users[0].getSender(),
            toNano('2.5'),
            123n,
            1n,
            BigInt(blockchain.now),
            signature
        );

        expect(await collection.getNextItemIndex()).toEqual(1n);
        const nft = blockchain.openContract(await collection.getNftItemByIndex(0n));
        expect(await nft.getOwner()).toEqualAddress(users[0].address);
    });

    it('should mint NFTs with price 0', async () => {
        blockchain.now = 1800000000;

        let newSale = blockchain.openContract(
            Sale.createFromConfig(
                {
                    adminPubkey: adminKeypair.publicKey,
                    available: 300n,
                    price: 0n,
                    lastIndex: 0n,
                    collection: collection.address,
                    buyerLimit: 300n,
                    startTime: 1800000000n,
                    endTime: 1900000000n,
                    adminAddress: admin.address,
                    helperCode,
                },
                code
            )
        );

        await newSale.sendDeploy(admin.getSender(), toNano('0.05'));
        await sale.sendChangeCollectionOwner(admin.getSender(), toNano('0.05'), newSale.address);

        const signature = newSale.signPurchase(adminKeypair, users[0].address, BigInt(blockchain.now));
        const res = await newSale.sendPurchase(
            users[0].getSender(),
            toNano('4.085'),
            123n,
            100n,
            BigInt(blockchain.now),
            signature
        );
        expect(await collection.getNextItemIndex()).toEqual(100n);
        for (let i = 0; i < 100; i++) {
            const nft = blockchain.openContract(await collection.getNftItemByIndex(BigInt(i)));
            expect(await nft.getOwner()).toEqualAddress(users[0].address);
        }
    });

    it('should mint one NFT with referrer', async () => {
        blockchain.now = 1800000000;
        const signature = sale.signPurchase(adminKeypair, users[0].address, BigInt(blockchain.now));
        const res = await sale.sendPurchase(
            users[0].getSender(),
            toNano('2.5'),
            123n,
            1n,
            BigInt(blockchain.now),
            signature,
            users[1].address
        );
        expect(await collection.getNextItemIndex()).toEqual(1n);
        const nft = blockchain.openContract(await collection.getNftItemByIndex(0n));
        expect(await nft.getOwner()).toEqualAddress(users[0].address);
        expect(res.transactions).toHaveTransaction({
            from: sale.address,
            to: users[1].address,
            value: toNano('0.1'),
        });
        expect(await sale.getAffilateTotal()).toEqual(toNano('0.1'));
        const referrerHelper = blockchain.openContract(
            Helper.createFromConfig(
                {
                    sale: sale.address,
                    user: users[1].address,
                    available: 5n,
                },
                helperCode
            )
        );
        expect(await referrerHelper.getTotalAffilate()).toEqual(toNano('0.1'));
    });

    it('should mint several NFTs at once', async () => {
        blockchain.now = 1800000000;
        const signature = sale.signPurchase(adminKeypair, users[0].address, BigInt(blockchain.now));
        const res = await sale.sendPurchase(
            users[0].getSender(),
            toNano('12'),
            123n,
            5n,
            BigInt(blockchain.now),
            signature
        );

        expect(await collection.getNextItemIndex()).toEqual(5n);
        for (let i = 0; i < 5; i++) {
            const nft = blockchain.openContract(await collection.getNftItemByIndex(BigInt(i)));
            expect(await nft.getOwner()).toEqualAddress(users[0].address);
        }
    });

    it('should mint 100 NFTs at once', async () => {
        blockchain.now = 1800000000;

        let newSale = blockchain.openContract(
            Sale.createFromConfig(
                {
                    adminPubkey: adminKeypair.publicKey,
                    available: 300n,
                    price: toNano('1'),
                    lastIndex: 0n,
                    collection: collection.address,
                    buyerLimit: 300n,
                    startTime: 1800000000n,
                    endTime: 1900000000n,
                    adminAddress: admin.address,
                    helperCode,
                },
                code
            )
        );

        await newSale.sendDeploy(admin.getSender(), toNano('0.05'));
        await sale.sendChangeCollectionOwner(admin.getSender(), toNano('0.05'), newSale.address);

        const signature = newSale.signPurchase(adminKeypair, users[0].address, BigInt(blockchain.now));
        const res = await newSale.sendPurchase(
            users[0].getSender(),
            toNano('1000'),
            123n,
            100n,
            BigInt(blockchain.now),
            signature
        );
        expect(await collection.getNextItemIndex()).toEqual(100n);
        for (let i = 0; i < 100; i++) {
            const nft = blockchain.openContract(await collection.getNftItemByIndex(BigInt(i)));
            expect(await nft.getOwner()).toEqualAddress(users[0].address);
        }
    });

    it('should mint 100 NFTs at once with referrer', async () => {
        blockchain.now = 1800000000;

        let newSale = blockchain.openContract(
            Sale.createFromConfig(
                {
                    adminPubkey: adminKeypair.publicKey,
                    available: 300n,
                    price: toNano('1'),
                    lastIndex: 0n,
                    collection: collection.address,
                    buyerLimit: 300n,
                    startTime: 1800000000n,
                    endTime: 1900000000n,
                    adminAddress: admin.address,
                    helperCode,
                    affilatePercentage: 100n,
                },
                code
            )
        );

        await newSale.sendDeploy(admin.getSender(), toNano('0.05'));
        await sale.sendChangeCollectionOwner(admin.getSender(), toNano('0.05'), newSale.address);

        const signature = newSale.signPurchase(adminKeypair, users[0].address, BigInt(blockchain.now));
        const res = await newSale.sendPurchase(
            users[0].getSender(),
            toNano('1000'),
            123n,
            100n,
            BigInt(blockchain.now),
            signature,
            users[1].address
        );
        expect(await collection.getNextItemIndex()).toEqual(100n);
        for (let i = 0; i < 100; i++) {
            const nft = blockchain.openContract(await collection.getNftItemByIndex(BigInt(i)));
            expect(await nft.getOwner()).toEqualAddress(users[0].address);
        }
        expect(await newSale.getAffilateTotal()).toEqual(toNano('1'));
        const referrerHelper = blockchain.openContract(
            Helper.createFromConfig(
                {
                    sale: newSale.address,
                    user: users[1].address,
                    available: 300n,
                },
                helperCode
            )
        );
        expect(await referrerHelper.getTotalAffilate()).toEqual(toNano('1'));
    });

    it('should mint anywhere between 1 and 100 NFTs at once', async () => {
        blockchain.now = 1800000000;

        let newSale = blockchain.openContract(
            Sale.createFromConfig(
                {
                    adminPubkey: adminKeypair.publicKey,
                    available: 10000n,
                    price: toNano('1'),
                    lastIndex: 0n,
                    collection: collection.address,
                    buyerLimit: 10000n,
                    startTime: 1800000000n,
                    endTime: 1900000000n,
                    adminAddress: admin.address,
                    helperCode,
                },
                code
            )
        );

        await newSale.sendDeploy(admin.getSender(), toNano('0.05'));
        await sale.sendChangeCollectionOwner(admin.getSender(), toNano('0.05'), newSale.address);

        const signature = newSale.signPurchase(adminKeypair, users[0].address, BigInt(blockchain.now));

        for (let i = 1; i <= 100; i++) {
            let before = (await blockchain.getContract(newSale.address)).balance;
            await newSale.sendPurchase(
                users[0].getSender(),
                toNano('1000'),
                123n,
                BigInt(i),
                BigInt(blockchain.now),
                signature
            );
            let after = (await blockchain.getContract(newSale.address)).balance;
            expect(after).toBeGreaterThanOrEqual(before);
        }

        expect(await collection.getNextItemIndex()).toEqual(5050n);
    });

    it('should mint anywhere between 1 and 100 NFTs at once with referrer', async () => {
        blockchain.now = 1800000000;

        let newSale = blockchain.openContract(
            Sale.createFromConfig(
                {
                    adminPubkey: adminKeypair.publicKey,
                    available: 10000n,
                    price: toNano('1'),
                    lastIndex: 0n,
                    collection: collection.address,
                    buyerLimit: 10000n,
                    startTime: 1800000000n,
                    endTime: 1900000000n,
                    adminAddress: admin.address,
                    helperCode,
                    affilatePercentage: 500n,
                },
                code
            )
        );

        await newSale.sendDeploy(admin.getSender(), toNano('0.05'));
        await sale.sendChangeCollectionOwner(admin.getSender(), toNano('0.05'), newSale.address);

        const signature = newSale.signPurchase(adminKeypair, users[0].address, BigInt(blockchain.now));

        for (let i = 1; i <= 100; i++) {
            let before = (await blockchain.getContract(newSale.address)).balance;
            const result = await newSale.sendPurchase(
                users[0].getSender(),
                toNano('1000'),
                123n,
                BigInt(i),
                BigInt(blockchain.now),
                signature,
                users[1].address
            );
            let after = (await blockchain.getContract(newSale.address)).balance;
            expect(after).toBeGreaterThanOrEqual(before);
            expect(result.transactions).toHaveTransaction({
                from: newSale.address,
                to: users[1].address,
                value: (x: bigint | undefined) => (x ? x >= (BigInt(i) * toNano('1')) / 100n - toNano('0.03') : false),
            });
        }

        expect(await collection.getNextItemIndex()).toEqual(5050n);
        expect(await newSale.getAffilateTotal()).toEqual(toNano('252.5'));

        const referrerHelper = blockchain.openContract(
            Helper.createFromConfig(
                {
                    sale: newSale.address,
                    user: users[1].address,
                    available: 10000n,
                },
                helperCode
            )
        );
        expect(await referrerHelper.getTotalAffilate()).toEqual(toNano('252.5'));
    });

    it('should not mint 101 NFTs at once', async () => {
        blockchain.now = 1800000000;

        let newSale = blockchain.openContract(
            Sale.createFromConfig(
                {
                    adminPubkey: adminKeypair.publicKey,
                    available: 300n,
                    price: toNano('1'),
                    lastIndex: 0n,
                    collection: collection.address,
                    buyerLimit: 300n,
                    startTime: 1800000000n,
                    endTime: 1900000000n,
                    adminAddress: admin.address,
                    helperCode,
                },
                code
            )
        );

        await newSale.sendDeploy(admin.getSender(), toNano('0.05'));
        await sale.sendChangeCollectionOwner(admin.getSender(), toNano('0.05'), newSale.address);

        const signature = newSale.signPurchase(adminKeypair, users[0].address, BigInt(blockchain.now));
        const res = await newSale.sendPurchase(
            users[0].getSender(),
            toNano('1000'),
            123n,
            101n,
            BigInt(blockchain.now),
            signature
        );
        expect(res.transactions).toHaveTransaction({
            on: newSale.address,
            exitCode: 709,
        });
        expect(await collection.getNextItemIndex()).toEqual(0n);
    });

    it('should mint 500 NFTs in separate transactions', async () => {
        blockchain.now = 1800000000;

        let newSale = blockchain.openContract(
            Sale.createFromConfig(
                {
                    adminPubkey: adminKeypair.publicKey,
                    available: 500n,
                    price: toNano('1'),
                    lastIndex: 0n,
                    collection: collection.address,
                    buyerLimit: 500n,
                    startTime: 1800000000n,
                    endTime: 1900000000n,
                    adminAddress: admin.address,
                    helperCode,
                },
                code
            )
        );

        await newSale.sendDeploy(admin.getSender(), toNano('0.05'));
        await sale.sendChangeCollectionOwner(admin.getSender(), toNano('0.05'), newSale.address);

        const signature = newSale.signPurchase(adminKeypair, users[0].address, BigInt(blockchain.now));
        for (let i = 0; i < 200; i++) {
            await newSale.sendPurchase(
                users[0].getSender(),
                toNano('1000'),
                123n,
                BigInt(i % 10),
                BigInt(blockchain.now),
                signature
            );
        }
        expect(await collection.getNextItemIndex()).toEqual(500n);
        expect((await blockchain.getContract(newSale.address)).balance).toBeLessThanOrEqual(toNano('20'));
    });

    it('should mint several NFTs in separate transactions', async () => {
        blockchain.now = 1800000000;
        const signature = sale.signPurchase(adminKeypair, users[0].address, BigInt(blockchain.now));

        for (let i = 0; i < 5; i++) {
            await sale.sendPurchase(users[0].getSender(), toNano('2.5'), 123n, 1n, BigInt(blockchain.now), signature);

            expect(await collection.getNextItemIndex()).toEqual(BigInt(i + 1));
            const nft = blockchain.openContract(await collection.getNftItemByIndex(BigInt(i)));
            expect(await nft.getOwner()).toEqualAddress(users[0].address);
        }
    });

    it('should not exceed the buyer limit', async () => {
        blockchain.now = 1800000000;
        const signature = sale.signPurchase(adminKeypair, users[0].address, BigInt(blockchain.now));

        await sale.sendPurchase(users[0].getSender(), toNano('100'), 123n, 4n, BigInt(blockchain.now), signature);
        expect(await collection.getNextItemIndex()).toEqual(4n);

        await sale.sendPurchase(users[0].getSender(), toNano('100'), 123n, 2n, BigInt(blockchain.now), signature);
        expect(await collection.getNextItemIndex()).toEqual(5n);

        await sale.sendPurchase(users[0].getSender(), toNano('100'), 123n, 1n, BigInt(blockchain.now), signature);
        expect(await collection.getNextItemIndex()).toEqual(5n);
    });

    it('should not exceed the total limit', async () => {
        blockchain.now = 1800000000;

        for (let i = 0; i < 10; i++) {
            const signature = sale.signPurchase(adminKeypair, users[i].address, BigInt(blockchain.now));
            const r = await sale.sendPurchase(
                users[i].getSender(),
                toNano('100'),
                123n,
                5n,
                BigInt(blockchain.now),
                signature
            );
        }

        expect(await collection.getNextItemIndex()).toEqual(20n);
    });

    it('should reject old signature', async () => {
        blockchain.now = 1810000000;
        const signature = sale.signPurchase(adminKeypair, users[0].address, 1800000000n);
        const res = await sale.sendPurchase(users[0].getSender(), toNano('2.5'), 123n, 1n, 1800000000n, signature);

        expect(res.transactions).toHaveTransaction({
            on: sale.address,
            exitCode: 708,
        });
    });

    it('should reject wrong sender', async () => {
        blockchain.now = 1800000000;
        const signature = sale.signPurchase(adminKeypair, users[0].address, BigInt(blockchain.now));
        const res = await sale.sendPurchase(
            users[1].getSender(),
            toNano('2.5'),
            123n,
            1n,
            BigInt(blockchain.now),
            signature
        );

        expect(res.transactions).toHaveTransaction({
            on: sale.address,
            exitCode: 701,
        });
    });

    it('should reject on not enough value', async () => {
        blockchain.now = 1800000000;
        const signature = sale.signPurchase(adminKeypair, users[0].address, BigInt(blockchain.now));
        const res = await sale.sendPurchase(
            users[0].getSender(),
            toNano('2'),
            123n,
            1n,
            BigInt(blockchain.now),
            signature
        );

        expect(res.transactions).toHaveTransaction({
            on: sale.address,
            exitCode: 703,
        });
    });

    it('should reject when too early', async () => {
        blockchain.now = 1790000000;
        const signature = sale.signPurchase(adminKeypair, users[0].address, BigInt(blockchain.now));
        const res = await sale.sendPurchase(
            users[0].getSender(),
            toNano('2.5'),
            123n,
            1n,
            BigInt(blockchain.now),
            signature
        );

        expect(res.transactions).toHaveTransaction({
            on: sale.address,
            exitCode: 704,
        });
    });

    it('should reject when too late', async () => {
        blockchain.now = 1910000000;
        const signature = sale.signPurchase(adminKeypair, users[0].address, BigInt(blockchain.now));
        const res = await sale.sendPurchase(
            users[0].getSender(),
            toNano('2.5'),
            123n,
            1n,
            BigInt(blockchain.now),
            signature
        );

        expect(res.transactions).toHaveTransaction({
            on: sale.address,
            exitCode: 704,
        });
    });

    it('should reject on trying to purchase 0 NFTs by accident', async () => {
        blockchain.now = 1800000000;
        const signature = sale.signPurchase(adminKeypair, users[0].address, BigInt(blockchain.now));
        await sale.sendPurchase(users[0].getSender(), toNano('100'), 123n, 5n, BigInt(blockchain.now), signature);
        const res = await sale.sendPurchase(
            users[0].getSender(),
            toNano('2.5'),
            123n,
            1n,
            BigInt(blockchain.now),
            signature
        );

        expect(res.transactions).toHaveTransaction({
            on: sale.address,
            exitCode: 705,
        });
    });

    it('should reject on trying to purchase 0 NFTs', async () => {
        blockchain.now = 1800000000;
        const signature = sale.signPurchase(adminKeypair, users[0].address, BigInt(blockchain.now));
        const res = await sale.sendPurchase(
            users[0].getSender(),
            toNano('1'),
            123n,
            0n,
            BigInt(blockchain.now),
            signature
        );

        expect(res.transactions).toHaveTransaction({
            on: sale.address,
            exitCode: 705,
        });
    });

    it('should return unused coins', async () => {
        blockchain.now = 1800000000;
        const signature = sale.signPurchase(adminKeypair, users[0].address, BigInt(blockchain.now));
        const res = await sale.sendPurchase(
            users[0].getSender(),
            toNano('10000'),
            123n,
            3n,
            BigInt(blockchain.now),
            signature
        );

        expect((await blockchain.getContract(users[0].address)).balance).toBeGreaterThanOrEqual(toNano('9993'));
    });

    it('should work with as little coins as possible', async () => {
        blockchain.now = 1800000000;
        const signature = sale.signPurchase(adminKeypair, users[0].address, BigInt(blockchain.now));

        let res = await sale.sendPurchase(
            users[0].getSender(),
            toNano('6.204'),
            123n,
            3n,
            BigInt(blockchain.now),
            signature
        );
        expect(res.transactions).toHaveTransaction({
            on: sale.address,
            exitCode: 703,
        });

        await sale.sendPurchase(users[0].getSender(), toNano('6.205'), 123n, 3n, BigInt(blockchain.now), signature);
        expect(await collection.getNextItemIndex()).toEqual(3n);
    });

    it('should work with as little coins as possible with referrer', async () => {
        blockchain.now = 1800000000;
        const signature = sale.signPurchase(adminKeypair, users[0].address, BigInt(blockchain.now));

        let res = await sale.sendPurchase(
            users[0].getSender(),
            toNano('6.204'),
            123n,
            3n,
            BigInt(blockchain.now),
            signature,
            users[1].address
        );
        expect(res.transactions).toHaveTransaction({
            on: sale.address,
            exitCode: 703,
        });

        res = await sale.sendPurchase(
            users[0].getSender(),
            toNano('6.205'),
            123n,
            3n,
            BigInt(blockchain.now),
            signature,
            users[1].address
        );
        expect(res.transactions).toHaveTransaction({
            from: sale.address,
            to: users[1].address,
            value: toNano('0.3'),
        });
        expect(await collection.getNextItemIndex()).toEqual(3n);
    });

    it('should transfer funds to admin after successful purchase', async () => {
        blockchain.now = 1800000000;
        const signature = sale.signPurchase(adminKeypair, users[0].address, BigInt(blockchain.now));

        const res = await sale.sendPurchase(
            users[0].getSender(),
            toNano('6.27'),
            123n,
            3n,
            BigInt(blockchain.now),
            signature
        );
        expect(res.transactions).toHaveTransaction({
            from: sale.address,
            to: admin.address,
            value: toNano('6'),
        });
    });

    it('should change the owner of collection and set inactive', async () => {
        let result = await sale.sendChangeCollectionOwner(admin.getSender(), toNano('0.05'), users[0].address);
        expect(result.transactions).toHaveTransaction({
            from: sale.address,
            to: collection.address,
            success: true,
            op: 3,
        });
        expect(await collection.getOwner()).toEqualAddress(users[0].address);

        blockchain.now = 1800000000;
        const signature = sale.signPurchase(adminKeypair, users[0].address, BigInt(blockchain.now));
        result = await sale.sendPurchase(
            users[0].getSender(),
            toNano('2.5'),
            123n,
            1n,
            BigInt(blockchain.now),
            signature
        );
        expect(result.transactions).toHaveTransaction({
            from: users[0].address,
            to: sale.address,
            success: false,
            exitCode: 707,
        });
    });

    it('should change the last index value by admin', async () => {
        let result = await sale.sendChangeLastIndex(users[0].getSender(), toNano('0.05'), 12345n);
        expect(result.transactions).toHaveTransaction({
            from: users[0].address,
            to: sale.address,
            exitCode: 702,
        });

        result = await sale.sendChangeLastIndex(admin.getSender(), toNano('0.05'), 12345n);
        expect(result.transactions).toHaveTransaction({
            from: admin.address,
            to: sale.address,
            success: true,
        });
        expect(await sale.getLastIndex()).toEqual(12345n);
    });

    it('should change the available value by admin', async () => {
        let result = await sale.sendChangeAvailable(users[0].getSender(), toNano('0.05'), 12345n);
        expect(result.transactions).toHaveTransaction({
            from: users[0].address,
            to: sale.address,
            exitCode: 702,
        });

        result = await sale.sendChangeAvailable(admin.getSender(), toNano('0.05'), 12345n);
        expect(result.transactions).toHaveTransaction({
            from: admin.address,
            to: sale.address,
            success: true,
        });
        expect(await sale.getAvailable()).toEqual(12345n);
    });

    it('should collect remaining balance by admin', async () => {
        let result = await sale.sendCollectRemainingBalance(users[0].getSender(), toNano('0.05'));
        expect(result.transactions).toHaveTransaction({
            from: users[0].address,
            to: sale.address,
            exitCode: 702,
        });

        result = await sale.sendCollectRemainingBalance(admin.getSender(), toNano('0.05'));
        expect(result.transactions).toHaveTransaction({
            from: admin.address,
            to: sale.address,
            success: true,
            value: (x) => (x || 0n) >= toNano('0.05'),
        });
    });

    it('should disable and enable by admin', async () => {
        let result = await sale.sendDisable(users[0].getSender(), toNano('0.05'));
        expect(result.transactions).toHaveTransaction({
            from: users[0].address,
            to: sale.address,
            exitCode: 702,
        });

        result = await sale.sendDisable(admin.getSender(), toNano('0.05'));
        expect(result.transactions).toHaveTransaction({
            from: admin.address,
            to: sale.address,
            success: true,
        });
        expect(await sale.getActive()).toBeFalsy();

        result = await sale.sendDisable(users[0].getSender(), toNano('0.05'));
        expect(result.transactions).toHaveTransaction({
            from: users[0].address,
            to: sale.address,
            exitCode: 707,
        });

        result = await sale.sendDisable(admin.getSender(), toNano('0.05'));
        expect(result.transactions).toHaveTransaction({
            from: admin.address,
            to: sale.address,
            success: true,
        });
        expect(await sale.getActive()).toBeFalsy();

        result = await sale.sendEnable(users[0].getSender(), toNano('0.05'));
        expect(result.transactions).toHaveTransaction({
            from: users[0].address,
            to: sale.address,
            exitCode: 707,
        });

        result = await sale.sendEnable(admin.getSender(), toNano('0.05'));
        expect(result.transactions).toHaveTransaction({
            from: admin.address,
            to: sale.address,
            success: true,
        });
        expect(await sale.getActive()).toBeTruthy();

        result = await sale.sendDisable(users[0].getSender(), toNano('0.05'));
        expect(result.transactions).toHaveTransaction({
            from: users[0].address,
            to: sale.address,
            exitCode: 702,
        });

        result = await sale.sendDisable(admin.getSender(), toNano('0.05'));
        expect(result.transactions).toHaveTransaction({
            from: admin.address,
            to: sale.address,
            success: true,
        });
        expect(await sale.getActive()).toBeFalsy();
    });

    it('should mint NFTs with correct content', async () => {
        blockchain.now = 1800000000;
        const signature = sale.signPurchase(adminKeypair, users[0].address, BigInt(blockchain.now));
        await sale.sendPurchase(users[0].getSender(), toNano('12'), 123n, 5n, BigInt(blockchain.now), signature);

        const nft = blockchain.openContract(await collection.getNftItemByIndex(2n));
        expect(await collection.getNftContent(2n, await nft.getIndividualContent())).toEqualCell(
            beginCell()
                .storeUint(1, 8)
                .storeStringTail('test.com/nft/')
                .storeRef(beginCell().storeStringTail('2.json').endCell())
                .endCell()
        );
    });

    it('should return correct data from get-methods', async () => {
        blockchain.now = 1800000000;
        const signature = sale.signPurchase(adminKeypair, users[0].address, BigInt(blockchain.now));
        await sale.sendPurchase(users[0].getSender(), toNano('12'), 123n, 4n, BigInt(blockchain.now), signature);

        expect(await sale.getActive()).toBeTruthy();
        expect(await sale.getAffilatePercentage()).toEqual(500n);
        expect(await sale.getAffilateTotal()).toEqual(0n);
        expect(await sale.getAvailable()).toEqual(16n);
        expect(await sale.getBuyerLimit()).toEqual(5n);
        expect(await sale.getLastIndex()).toEqual(4n);
        expect(await sale.getPrice()).toEqual(toNano('2'));
        expect(await sale.getStartEndTime()).toEqual([1800000000, 1900000000]);

        const helper = blockchain.openContract(
            Helper.createFromConfig(
                {
                    sale: sale.address,
                    user: users[0].address,
                    available: 5n,
                },
                helperCode
            )
        );
        expect(await helper.getAvailable()).toEqual(1n);
        expect(await helper.getTotalAffilate()).toEqual(0n);
    });

    it('should process affilates correctly', async () => {
        blockchain.now = 1800000000;
        const signature = sale.signPurchase(adminKeypair, users[0].address, BigInt(blockchain.now));
        await sale.sendPurchase(
            users[0].getSender(),
            toNano('12'),
            123n,
            4n,
            BigInt(blockchain.now),
            signature,
            users[1].address
        );

        expect(await sale.getAffilateTotal()).toEqual(toNano('0.4'));

        const helper = blockchain.openContract(
            Helper.createFromConfig(
                {
                    sale: sale.address,
                    user: users[1].address,
                    available: 5n,
                },
                helperCode
            )
        );
        expect(await helper.getTotalAffilate()).toEqual(toNano('0.4'));
    });
});
