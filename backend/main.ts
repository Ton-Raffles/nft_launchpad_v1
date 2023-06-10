import express from 'express';
import axios from 'axios';
import { config } from 'dotenv';
import { keyPairFromSecretKey } from 'ton-crypto';
import { Address } from 'ton';

config();

const app = express();
const keyPair = keyPairFromSecretKey(Buffer.from(process.env.ADMIN_SECRET_KEY!, 'hex'));
const adminAddress = Address.parse(process.env.ADMIN_ADDRESS!);
const endpoint = process.env.TONAPI_ENDPOINT;
const tonApiKey = process.env.TONAPI_KEY!;

async function checkIfAddressHoldsNFT(address: Address, collection: Address): Promise<boolean> {
    const result = await axios.get(
        endpoint +
            '/v2/accounts/' +
            address.toRawString() +
            '/nfts?collection=' +
            collection.toRawString() +
            '&limit=1&indirect_ownership=false',
        {
            headers: {
                Authorization: 'Bearer ' + tonApiKey,
            },
        }
    );
    const items = result.data.nft_items!;
    return items.length > 0;
}

app.get('/', async (req, res) => {
    res.send('Hello World!');
    checkIfAddressHoldsNFT(
        Address.parse('EQBKgXCNLPexWhs2L79kiARR1phGH1LwXxRbNsCFF9doc2lN'),
        Address.parse('EQDvRFMYLdxmvY3Tk-cfWMLqDnXF_EclO2Fp4wwj33WhlNFT')
    );
});

app.listen(process.env.PORT!, () => {
    console.log(`API is listening on port ${process.env.PORT!}`);
});
