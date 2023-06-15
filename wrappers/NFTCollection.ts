import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Sender,
    SendMode,
    toNano,
} from 'ton-core';
import { NFTItem } from './NFTItem';

export type NFTCollectionConfig = {
    owner: Address;
    collectionContent: Cell;
    commonContent: Cell;
    itemCode: Cell;
    royaltyFactor: bigint;
    royaltyBase: bigint;
};

export function NFTCollectionConfigToCell(config: NFTCollectionConfig): Cell {
    return beginCell()
        .storeAddress(config.owner)
        .storeUint(0, 64)
        .storeRef(beginCell().storeRef(config.collectionContent).storeRef(config.commonContent).endCell())
        .storeRef(config.itemCode)
        .storeRef(
            beginCell()
                .storeUint(config.royaltyFactor, 16)
                .storeUint(config.royaltyBase, 16)
                .storeAddress(config.owner)
                .endCell()
        )
        .endCell();
}

export class NFTCollection implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new NFTCollection(address);
    }

    static createFromConfig(config: NFTCollectionConfig, code: Cell, workchain = 0) {
        const data = NFTCollectionConfigToCell(config);
        const init = { code, data };
        return new NFTCollection(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendMint(provider: ContractProvider, via: Sender, value: bigint): Promise<NFTItem> {
        const itemIndex = await this.getNextItemIndex(provider);
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(1, 32)
                .storeUint(0, 64)
                .storeUint(itemIndex, 64)
                .storeCoins(toNano('0.05'))
                .storeRef(beginCell().storeAddress(via.address!).storeRef(Cell.EMPTY).endCell())
                .endCell(),
        });
        return this.getNftItemByIndex(provider, itemIndex);
    }

    async sendChangeOwner(provider: ContractProvider, via: Sender, value: bigint, newOwner: Address) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(3, 32).storeUint(0, 64).storeAddress(newOwner).endCell(),
        });
    }

    async getNextItemIndex(provider: ContractProvider) {
        return (await provider.get('get_collection_data', [])).stack.readBigNumber();
    }

    async getNftItemByIndex(provider: ContractProvider, index: bigint): Promise<NFTItem> {
        const address = (
            await provider.get('get_nft_address_by_index', [{ type: 'int', value: index }])
        ).stack.readAddress();
        return NFTItem.createFromAddress(address);
    }

    async getOwner(provider: ContractProvider): Promise<Address> {
        const result = (await provider.get('get_collection_data', [])).stack;
        result.skip(2);
        return result.readAddress();
    }

    async getNftContent(provider: ContractProvider, index: bigint, individualContent: Cell): Promise<Cell> {
        const result = (
            await provider.get('get_nft_content', [
                { type: 'int', value: index },
                { type: 'cell', cell: individualContent },
            ])
        ).stack;
        return result.readCell();
    }
}
