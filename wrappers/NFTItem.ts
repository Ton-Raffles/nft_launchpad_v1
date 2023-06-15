import { Address, beginCell, Cell, Contract, ContractProvider, Sender, SendMode, toNano } from 'ton-core';

export class NFTItem implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new NFTItem(address);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendTransfer(provider: ContractProvider, via: Sender, value: bigint, recipient: Address) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(0x5fcc3d14, 32)
                .storeUint(0, 64)
                .storeAddress(recipient)
                .storeAddress(await this.getOwner(provider))
                .storeUint(0, 1)
                .storeCoins(toNano('0.1'))
                .storeUint(0, 1)
                .endCell(),
        });
    }

    async getOwner(provider: ContractProvider) {
        let stack = (await provider.get('get_nft_data', [])).stack;
        stack.skip(3);
        return stack.readAddress();
    }

    async getIndividualContent(provider: ContractProvider) {
        let stack = (await provider.get('get_nft_data', [])).stack;
        stack.skip(4);
        return stack.readCell();
    }
}
