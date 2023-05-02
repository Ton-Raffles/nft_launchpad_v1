import { CompilerConfig } from '@ton-community/blueprint';

export const compile: CompilerConfig = {
    targets: [
        'contracts/imports/stdlib.fc',
        'contracts/nft/params.fc',
        'contracts/nft/op-codes.fc',
        'contracts/nft/nft-collection-editable.fc',
    ],
};
