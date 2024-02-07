import {
    Address,
    beginCell,
    Builder,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Sender,
    SendMode,
} from '@ton/core';
import { KeyPair, sign } from '@ton/crypto';

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
    affilatePercentage?: bigint;
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
        .storeRef(
            beginCell()
                .storeCoins(0)
                .storeUint(config.affilatePercentage || 0, 16)
                .storeUint(Math.floor(Math.random() * 10000), 16)
                .endCell()
        )
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
        signature: Buffer,
        referrer?: Address
    ) {
        const maybeReferrer = referrer ? beginCell().storeAddress(referrer).endCell().beginParse() : undefined;
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(0x0503a1f4, 32)
                .storeUint(queryId, 64)
                .storeUint(quantity, 16)
                .storeUint(time, 64)
                .storeBuffer(signature, 64)
                .storeMaybeSlice(maybeReferrer)
                .endCell(),
        });
    }

    async sendChangeCollectionOwner(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        newOwner: Address,
        collection?: Address
    ) {
        let b = beginCell().storeUint(0x4afc346e, 32).storeAddress(newOwner);
        if (collection) {
            b.storeUint(1, 1).storeAddress(collection);
        } else {
            b.storeUint(0, 1);
        }
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: b.endCell(),
        });
    }

    async sendChangeLastIndex(provider: ContractProvider, via: Sender, value: bigint, newLastIndex: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(0x27eb8974, 32).storeUint(newLastIndex, 32).endCell(),
        });
    }

    async sendChangeAvailable(provider: ContractProvider, via: Sender, value: bigint, newAvailable: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(0x277b8f15, 32).storeUint(newAvailable, 32).endCell(),
        });
    }

    async sendChangeStartTime(provider: ContractProvider, via: Sender, value: bigint, newTime: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(0xfd36d2c, 32).storeUint(newTime, 32).endCell(),
        });
    }

    async sendChangeEndTime(provider: ContractProvider, via: Sender, value: bigint, newTime: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(0x44e014e6, 32).storeUint(newTime, 32).endCell(),
        });
    }

    async sendDisable(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(0x34c02669, 32).endCell(),
        });
    }

    async sendEnable(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(0x2e484313, 32).endCell(),
        });
    }

    async sendCollectRemainingBalance(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(0x4316d699, 32).endCell(),
        });
    }

    async getAvailable(provider: ContractProvider): Promise<bigint> {
        const result = (await provider.get('get_contract_data', [])).stack;
        result.skip(1);
        return result.readBigNumber();
    }

    async getPrice(provider: ContractProvider): Promise<bigint> {
        const result = (await provider.get('get_contract_data', [])).stack;
        result.skip(2);
        return result.readBigNumber();
    }

    async getLastIndex(provider: ContractProvider): Promise<bigint> {
        const result = (await provider.get('get_contract_data', [])).stack;
        result.skip(3);
        return result.readBigNumber();
    }

    async getBuyerLimit(provider: ContractProvider): Promise<bigint> {
        const result = (await provider.get('get_contract_data', [])).stack;
        result.skip(5);
        return result.readBigNumber();
    }

    async getStartEndTime(provider: ContractProvider): Promise<[number, number]> {
        const result = (await provider.get('get_contract_data', [])).stack;
        result.skip(6);
        return [result.readNumber(), result.readNumber()];
    }

    async getActive(provider: ContractProvider): Promise<boolean> {
        const result = (await provider.get('get_contract_data', [])).stack;
        result.skip(9);
        return result.readBoolean();
    }

    async getAffilateTotal(provider: ContractProvider): Promise<bigint> {
        const result = (await provider.get('get_contract_data', [])).stack;
        result.skip(11);
        return result.readBigNumber();
    }

    async getAffilatePercentage(provider: ContractProvider): Promise<bigint> {
        const result = (await provider.get('get_contract_data', [])).stack;
        result.skip(12);
        return result.readBigNumber();
    }
}
