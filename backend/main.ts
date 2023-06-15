import express, { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { Pool } from 'pg';
import { config } from 'dotenv';
import { keyPairFromSecretKey, sign } from 'ton-crypto';
import { Address, Cell, SendMode, WalletContractV3R2, beginCell, internal, toNano } from 'ton';
import { Sale, SaleConfig, saleConfigToCell } from '../wrappers/Sale';
import * as fs from 'fs';

config();

const app = express();
const keyPair = keyPairFromSecretKey(Buffer.from(process.env.ADMIN_SECRET_KEY!, 'hex'));
const adminAddress = Address.parse(process.env.ADMIN_ADDRESS!);
const endpoint = process.env.TONAPI_ENDPOINT;
const tonApiKey = process.env.TONAPI_KEY!;
const jwtSecretKey = process.env.JWT_ADMIN!;
const saleCode = Cell.fromBoc(
    Buffer.from(JSON.parse(fs.readFileSync('./build/Sale.compiled.json').toString('utf-8')).hex, 'hex')
)[0];
const adminWallet = WalletContractV3R2.create({ workchain: 0, publicKey: keyPair.publicKey });

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

// This function checks whether user has positive balance of specific Jetton
async function sendRawMessage(message: Cell): Promise<[number, any[]]> {
    const result = await axios.post(endpoint + '/v2/blockchain/message', {
        headers: {
            Authorization: 'Bearer ' + tonApiKey,
        },
        data: {
            boc: message.toBoc(),
        },
    });
    return [result.status, result.data];
}

// This function fetches the latest seqno for admin wallet
async function fetchSeqno(): Promise<number> {
    const result = await axios.get(endpoint + `/v2/blockchain/accounts/${adminAddress.toRawString()}/methods/seqno`, {
        headers: {
            Authorization: 'Bearer ' + tonApiKey,
        },
    });
    const hexSeqno = result.data.stack[0].num;
    const decSeqno = parseInt(hexSeqno, 16);
    return decSeqno;
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
    const { nft_collection, jetton, whitelisted_users, startTime, endTime, price, available, buyerLimit, lastIndex } =
        req.body;
    try {
        const config: SaleConfig = {
            adminPubkey: keyPair.publicKey,
            available: BigInt(available),
            price: BigInt(price),
            lastIndex: BigInt(lastIndex),
            collection: Address.parse(nft_collection),
            buyerLimit: BigInt(buyerLimit),
            startTime: BigInt(startTime),
            endTime: BigInt(endTime),
            adminAddress: adminAddress,
        };

        const contract = Sale.createFromConfig(config, saleCode);

        const transferCell = adminWallet.createTransfer({
            seqno: await fetchSeqno(),
            secretKey: keyPair.secretKey,
            messages: [
                internal({
                    value: '0.1',
                    to: contract.address,
                    init: {
                        code: saleCode,
                        data: saleConfigToCell(config),
                    },
                }),
            ],
        });

        const [status, error] = await sendRawMessage(transferCell);
        if (status != 200) {
            res.status(status).json({ error });
        }

        const result = await pool.query(
            'INSERT INTO sales (nft_collection, jetton, whitelisted_users) VALUES ($1, $2, $3) RETURNING *',
            [nft_collection, jetton, whitelisted_users]
        );
        const saleData = result.rows[0];

        res.json({ id: saleData.id, contractAddress: contract.address.toString() });
    } catch (err: any) {
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
        const message = beginCell().storeUint(0x379ef53b, 32).storeAddress(newOwnerAddress).endCell();

        const callMessage = adminWallet.createTransfer({
            seqno: await fetchSeqno(),
            secretKey: keyPair.secretKey,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            messages: [
                internal({
                    to: Address.parse(sale.contractAddress),
                    body: message,
                    value: toNano('0.05'),
                }),
            ],
        });

        const [status, error] = await sendRawMessage(callMessage);
        if (status != 200) {
            res.status(status).json({ error });
            return;
        }

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

        const bodyCell = beginCell().storeUint(queryId, 64).storeAddress(userAddress).endCell();
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

        return res.json({ access: true, signature: signature.toString('hex') });
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
        const result = await pool.query('SELECT * FROM sales WHERE status = $1', ['inactive']);
        const sales = result.rows;
        if (sales.length == 0) {
            return res.status(404).send('No inactive sales found');
        }
        res.json(sales);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(process.env.PORT!, () => {
    console.log(`API is listening on port ${process.env.PORT!}`);
});
