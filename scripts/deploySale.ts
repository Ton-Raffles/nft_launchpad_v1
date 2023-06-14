import { toNano } from 'ton-core';
import { Sale } from '../wrappers/Sale';
import { compile, NetworkProvider } from '@ton-community/blueprint';

export async function run(provider: NetworkProvider) {
    // const sale = provider.open(Sale.createFromConfig({}, await compile('Sale')));
    // await sale.sendDeploy(provider.sender(), toNano('0.05'));
    // await provider.waitForDeploy(sale.address);
    // run methods on `sale`
}
