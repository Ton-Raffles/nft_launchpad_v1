import express, { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { Pool } from 'pg';
import { config } from 'dotenv';
import { keyPairFromSecretKey, sign } from '@ton/crypto';
import { Address, Cell, WalletContractV3R2, beginCell, toNano, TonClient } from '@ton/ton';
import { Sale, SaleConfig } from '../wrappers/Sale';
import { NFTCollection } from '../wrappers/NFTCollection';
import * as fs from 'fs';
import cors from 'cors';

config();

const app = express();
app.use(cors());
app.use(express.json());

const client = new TonClient({
    endpoint: 'https://toncenter.com/api/v2/jsonRPC',
    apiKey: process.env.TONCENTER_KEY,
});

const keyPair = keyPairFromSecretKey(Buffer.from(process.env.ADMIN_SECRET_KEY!, 'hex'));
const endpoint = process.env.TONAPI_ENDPOINT;
const tonApiKey = process.env.TONAPI_KEY!;
const jwtSecretKey = process.env.JWT_ADMIN!;
const saleCode = Cell.fromBoc(
    Buffer.from(JSON.parse(fs.readFileSync('./build/Sale.compiled.json').toString('utf-8')).hex, 'hex')
)[0];
const helperCode = Cell.fromBoc(
    Buffer.from(JSON.parse(fs.readFileSync('./build/Helper.compiled.json').toString('utf-8')).hex, 'hex')
)[0];
const NFTItemCode = Cell.fromBoc(
    Buffer.from(JSON.parse(fs.readFileSync('./build/NFTItem.compiled.json').toString('utf-8')).hex, 'hex')
)[0];
const NFTCollectionCode = Cell.fromBoc(
    Buffer.from(JSON.parse(fs.readFileSync('./build/NFTCollection.compiled.json').toString('utf-8')).hex, 'hex')
)[0];
const adminWallet = WalletContractV3R2.create({ workchain: 0, publicKey: keyPair.publicKey });
const adminSender = client.open(adminWallet).sender(keyPair.secretKey);
const adminAddress = adminWallet.address;

const pool = new Pool({
    user: process.env.PGUSER,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    password: process.env.PGPASSWORD,
    port: parseInt(process.env.PGPORT!),
});

pool.query(`
    CREATE TABLE IF NOT EXISTS sales (
        id SERIAL PRIMARY KEY,
        launch_id INTEGER,
        nft_collection TEXT,
        jetton TEXT,
        whitelisted_users text[],
        status TEXT DEFAULT 'active'
    )
`);

interface JwtPayloadWithRole extends JwtPayload {
    role?: string;
}

// This function checks whether user holds any NFTs from specific collection
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

// This function checks whether user has positive balance of specific Jetton
async function checkIfAddressHoldsJetton(address: Address, jetton: Address): Promise<boolean> {
    const result = await axios.get(endpoint + '/v2/accounts/' + address.toRawString() + '/jettons', {
        headers: {
            Authorization: 'Bearer ' + tonApiKey,
        },
    });
    const balances = result.data.balances!.filter((j: any) => j.jetton.address == jetton.toRawString());
    if (balances.length == 0) {
        return false;
    }
    return balances.balance! != '0';
}

function authorizeAdmin(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(403).send('No token provided');
    }

    const token = authHeader.split(' ')[1];

    jwt.verify(token, jwtSecretKey, (err, decoded) => {
        if (err) {
            return res.status(401).send('Unauthorized access');
        }

        const decodedPayload = decoded as JwtPayloadWithRole;
        if (!decodedPayload || decodedPayload.role !== 'admin') {
            return res.status(403).send('Forbidden');
        }

        next();
    });
}

app.post('/createSale', authorizeAdmin, async (req, res) => {
    const {
        saleCollection,
        nft_collection,
        jetton,
        whitelisted_users,
        startTime,
        endTime,
        price,
        available,
        buyerLimit,
        lastIndex,
        launch_id,
        affilatePercentage,
    } = req.body;
    try {
        const config: SaleConfig = {
            adminPubkey: keyPair.publicKey,
            available: BigInt(available),
            price: BigInt(price),
            lastIndex: BigInt(lastIndex),
            collection: Address.parse(saleCollection),
            buyerLimit: BigInt(buyerLimit),
            startTime: BigInt(startTime),
            endTime: BigInt(endTime),
            adminAddress,
            helperCode,
            affilatePercentage,
        };

        const contract = client.open(Sale.createFromConfig(config, saleCode));

        await contract.sendDeploy(adminSender, toNano('0.05'));

        const result = await pool.query(
            'INSERT INTO sales (nft_collection, jetton, whitelisted_users, launch_id) VALUES ($1, $2, $3, $4) RETURNING *',
            [nft_collection, jetton, whitelisted_users, launch_id]
        );
        const saleData = result.rows[0];

        res.json({ id: saleData.id, contractAddress: contract.address.toString() });
    } catch (err: any) {
        console.log(err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/removeSale/:id', authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('UPDATE sales SET status = $1 WHERE id = $2', ['inactive', id]);
        res.json({ message: 'Marked sale as inactive' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/editSale/:id', authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    const { nft_collection, jetton, whitelisted_users } = req.body;
    try {
        const result = await pool.query(
            'UPDATE sales SET nft_collection = $1, jetton = $2, whitelisted_users = $3 WHERE id = $4 RETURNING *',
            [nft_collection, jetton, whitelisted_users, id]
        );
        res.json(result.rows[0]);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/changeCollectionOwner/:id', authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    const { new_owner } = req.body;
    try {
        const result = await pool.query('SELECT * FROM sales WHERE id = $1', [id]);
        const sale = result.rows[0];

        if (!sale) {
            return res.status(404).send('Sale not found');
        }

        const newOwnerAddress = Address.parse(new_owner);

        const contract = client.open(Sale.createFromAddress(Address.parse(sale.address)));

        await contract.sendChangeCollectionOwner(adminSender, toNano('0.05'), newOwnerAddress);

        res.json({ message: 'Changed collection owner' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/checkUser/:saleId', async (req, res) => {
    const { saleId } = req.params;
    const { address, query_id } = req.query;

    try {
        const result = await pool.query('SELECT * FROM sales WHERE id = $1 AND status = $2', [saleId, 'active']);
        const sale = result.rows[0];

        if (!sale) {
            return res.status(404).send('Sale not found');
        }

        const userAddress = Address.parse(address as string);
        const queryId = BigInt(query_id as string);

        const currentTime = Date.now();

        const bodyCell = beginCell().storeAddress(userAddress).storeUint(currentTime, 64).endCell();
        const signature = sign(bodyCell.hash(), keyPair.secretKey);

        // Check if user is whitelisted
        if (sale.whitelisted_users.includes(address)) {
            return res.json({ access: true, signature: signature.toString('hex') });
        }

        // Check if user holds necessary NFT
        if (sale.nft_collection) {
            const nftAddress = Address.parse(sale.nft_collection);
            const hasNFT = await checkIfAddressHoldsNFT(userAddress, nftAddress);
            if (!hasNFT) {
                return res.json({ access: false, reason: 'User does not hold the necessary NFT.' });
            }
        }

        // Check if user holds necessary Jetton
        if (sale.jetton) {
            const jettonAddress = Address.parse(sale.jetton);
            const hasJetton = await checkIfAddressHoldsJetton(userAddress, jettonAddress);
            if (!hasJetton) {
                return res.json({ access: false, reason: 'User does not hold the necessary Jetton.' });
            }
        }

        return res.json({ access: true, signature: signature.toString('hex'), time: currentTime });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// This endpoint returns all active sales.
app.get('/sales', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM sales WHERE status = $1', ['active']);
        const sales = result.rows;
        if (sales.length == 0) {
            return res.status(404).send('No active sales found');
        }
        res.json(sales);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// This endpoint returns the details of a specific sale.
app.get('/sale/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM sales WHERE id = $1', [id]);
        const sale = result.rows[0];
        if (!sale) {
            return res.status(404).send('Sale not found');
        }
        res.json(sale);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// This endpoint returns all inactive sales.
app.get('/sales/history', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM sales');
        const sales = result.rows;
        if (sales.length == 0) {
            return res.status(404).send('No sales found');
        }
        res.json(sales);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// This endpoint returns all sales of specific launch.
app.get('/sales/launch/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM sales WHERE launch_id = $1', [id]);
        const sales = result.rows;
        res.json(sales);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/createCollection', authorizeAdmin, async (req, res) => {
    const {
        ownerAddress,
        collectionContentUrl,
        collectionCommonContentUrl,
        royaltyBase,
        royaltyFactor,
        royaltyAddress,
    } = req.body;

    try {
        const collection = client.open(
            NFTCollection.createFromConfig(
                {
                    owner: ownerAddress,
                    collectionContent: beginCell().storeUint(1, 8).storeStringTail(collectionContentUrl).endCell(),
                    commonContent: beginCell().storeStringTail(collectionCommonContentUrl).endCell(),
                    itemCode: NFTItemCode,
                    royaltyFactor,
                    royaltyBase,
                    royaltyAddress,
                },
                NFTCollectionCode
            )
        );
        await collection.sendDeploy(adminSender, toNano('0.10'));

        res.json({ message: 'Collection created successfully' });
    } catch (err: any) {
        console.log(err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(process.env.PORT!, () => {
    console.log(`API is listening on port ${process.env.PORT!}`);
});
