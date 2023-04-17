import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from 'ton-core';

export type LaunchpadConfig = {};

export function launchpadConfigToCell(config: LaunchpadConfig): Cell {
    return beginCell().endCell();
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

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }
}
