import { toNano } from 'ton-core';
import { Launchpad } from '../wrappers/Launchpad';
import { compile, NetworkProvider } from '@ton-community/blueprint';

export async function run(provider: NetworkProvider) {
    // const launchpad = provider.open(Launchpad.createFromConfig({}, await compile('Launchpad')));
    // await launchpad.sendDeploy(provider.sender(), toNano('0.05'));
    // await provider.waitForDeploy(launchpad.address);
    // run methods on `launchpad`
}
