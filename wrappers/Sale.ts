import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from 'ton-core';
import { KeyPair, sign } from 'ton-crypto';

export type SaleConfig = {
    adminPubkey: Buffer;
    available: bigint;
    price: bigint;
    lastIndex: bigint;
    collection: Address;
    buyerLimit: bigint;
    startTime: bigint;
    endTime: bigint;
    adminAddress: Address;
    helperCode: Cell;
};

export function saleConfigToCell(config: SaleConfig): Cell {
    return beginCell()
        .storeBuffer(config.adminPubkey, 32)
        .storeUint(config.available, 32)
        .storeCoins(config.price)
        .storeUint(config.lastIndex, 32)
        .storeAddress(config.collection)
        .storeUint(config.buyerLimit, 32)
        .storeUint(config.startTime, 32)
        .storeUint(config.endTime, 32)
        .storeAddress(config.adminAddress)
        .storeUint(1, 1)
        .storeRef(config.helperCode)
        .storeUint(Math.floor(Math.random() * 10000), 16)
        .endCell();
}

export class Sale implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new Sale(address);
    }

    static createFromConfig(config: SaleConfig, code: Cell, workchain = 0) {
        const data = saleConfigToCell(config);
        const init = { code, data };
        return new Sale(contractAddress(workchain, init), init);
    }

    signPurchase(admin: KeyPair, user: Address, time: bigint): Buffer {
        const body = beginCell().storeAddress(user).storeUint(time, 64).endCell();
        return sign(body.hash(), admin.secretKey);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendPurchase(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        queryId: bigint,
        quantity: bigint,
        time: bigint,
        signature: Buffer
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(0x26c6f3d0, 32)
                .storeUint(queryId, 64)
                .storeUint(quantity, 16)
                .storeUint(time, 64)
                .storeBuffer(signature, 64)
                .endCell(),
        });
    }

    async sendChangeCollectionOwner(provider: ContractProvider, via: Sender, value: bigint, newOwner: Address) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(0x49a4bbf6, 32).storeAddress(newOwner).endCell(),
        });
    }
}
