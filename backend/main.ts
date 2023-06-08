import express from 'express';
import { config } from 'dotenv';
import { keyPairFromSecretKey } from 'ton-crypto';
import { Address } from 'ton';

config();

const app = express();
const port = process.env.PORT;
const keyPair = keyPairFromSecretKey(Buffer.from(process.env.ADMIN_SECRET_KEY!, 'hex'));
const adminAddress = Address.parse(process.env.ADMIN_ADDRESS!);

app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.listen(port, () => {
    console.log(`API is listening on port ${port}`);
});
