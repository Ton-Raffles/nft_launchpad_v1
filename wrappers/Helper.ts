import { Address, Cell, Contract, ContractProvider } from 'ton-core';

export class Sale implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new Sale(address);
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
