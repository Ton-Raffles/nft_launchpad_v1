import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from 'ton-core';
import { KeyPair, sign } from 'ton-crypto';

export type LaunchpadConfig = {
    adminPubkey: Buffer;
    available: bigint;
    price: bigint;
    lastIndex: bigint;
    collection: Address;
    buyerLimit: bigint;
    buyers?: Cell;
    startTime: bigint;
    endTime: bigint;
};

export function launchpadConfigToCell(config: LaunchpadConfig): Cell {
    return beginCell()
        .storeBuffer(config.adminPubkey, 32)
        .storeUint(config.available, 32)
        .storeCoins(config.price)
        .storeUint(config.lastIndex, 32)
        .storeAddress(config.collection)
        .storeUint(config.buyerLimit, 32)
        .storeMaybeRef(config.buyers)
        .storeUint(config.startTime, 32)
        .storeUint(config.endTime, 32)
        .endCell();
}

export class Launchpad implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new Launchpad(address);
    }

    static createFromConfig(config: LaunchpadConfig, code: Cell, workchain = 0) {
        const data = launchpadConfigToCell(config);
        const init = { code, data };
        return new Launchpad(contractAddress(workchain, init), init);
    }

    signPurchase(admin: KeyPair, queryId: bigint, user: Address, quantity: bigint): Buffer {
        const body = beginCell().storeUint(queryId, 64).storeAddress(user).storeUint(quantity, 16).endCell();
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
        signature: Buffer,
        queryId: bigint,
        user: Address,
        quantity: bigint
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(0x4c56b6b5, 32)
                .storeBuffer(signature, 64)
                .storeUint(queryId, 64)
                .storeAddress(user)
                .storeUint(quantity, 16)
                .endCell(),
        });
    }
}
