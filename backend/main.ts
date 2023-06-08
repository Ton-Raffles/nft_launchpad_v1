import express from 'express';
import { config } from 'dotenv';

config();

const app = express();
const port = process.env.PORT;

app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.listen(port, () => {
    console.log(`API is listening on port ${port}`);
});
