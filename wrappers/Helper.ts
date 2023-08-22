import { Address, Cell, Contract, ContractProvider, beginCell, contractAddress } from '@ton/core';

export type HelperConfig = {
    sale: Address;
    user: Address;
    available: bigint;
    totalAffilate?: bigint;
};

export function helperConfigToCell(config: HelperConfig): Cell {
    return beginCell()
        .storeAddress(config.sale)
        .storeAddress(config.user)
        .storeUint(config.available, 32)
        .storeCoins(config.totalAffilate || 0)
        .endCell();
}

export class Helper implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new Helper(address);
    }

    static createFromConfig(config: HelperConfig, code: Cell, workchain = 0) {
        const data = helperConfigToCell(config);
        const init = { code, data };
        return new Helper(contractAddress(workchain, init), init);
    }

    async getAvailable(provider: ContractProvider): Promise<bigint> {
        const result = (await provider.get('get_contract_data', [])).stack;
        result.skip(2);
        return result.readBigNumber();
    }

    async getTotalAffilate(provider: ContractProvider): Promise<bigint> {
        const result = (await provider.get('get_contract_data', [])).stack;
        result.skip(3);
        return result.readBigNumber();
    }
}
