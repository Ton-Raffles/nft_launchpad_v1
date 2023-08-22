import { toNano } from '@ton/ton';
import { Sale } from '../wrappers/Sale';
import { compile, NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    // const sale = provider.open(Sale.createFromConfig({}, await compile('Sale')));
    // await sale.sendDeploy(provider.sender(), toNano('0.05'));
    // await provider.waitForDeploy(sale.address);
    // run methods on `sale`
}
