import {ethers} from 'ethers';

const privateKey = "PRIVATE_KEY";

// Configure your provider (e.g., Infura, Alchemy, or a local node)
const provider = new ethers.InfuraProvider('sepolia', 'c2a3c6cad8844df4a79998c898822291');

// Set up your wallet (private key should be kept secret and secure)
const wallet = new ethers.Wallet(privateKey, provider);

// Define the faucet contract address
const faucetAddress = '0x6d454714c3Ac6D2deB4eA123254BD87DD14Fd729';

// Define the amount to deposit (in Ether)
const depositAmount = ethers.parseEther('0.1'); // 0.1 Ether

async function depositToFaucet() {
    try {
        const {data} = encodeData("deposit", {}, []);

        // Create a transaction
        const tx = {
            to: faucetAddress,
            value: depositAmount,
            data: data,
            chain: 11155111,
            gasLimit: 50000, // Adjust gas limit as needed
            gasPrice: await getGasPrice() + 1000000000,
        };

        // Send the transaction
        const transactionResponse = await wallet.sendTransaction(tx);
        console.log('Transaction sent:', transactionResponse.hash);

        // Wait for the transaction to be mined
        const receipt = await transactionResponse.wait();
        console.log('Transaction mined:', receipt.hash);
    } catch (error) {
        console.error('Error depositing to faucet:', error);
    }
}

async function getGasPrice() {
    // get current gas prices on Sepolia
    const {
        data: { rapid, fast, standard },
    } = await fetchJson(`https://sepolia.beaconcha.in/api/v1/execution/gasnow`);

    let gasPrice = Math.max(rapid, fast, standard);
    if (!gasPrice) {
        console.log('Unable to get gas price. Please refresh and try again.');
    }

    return Math.max(rapid, fast, standard);
}

function encodeData (method, args, ret) {
    const abi = [
        `function ${method}(${Object.keys(args).join(',')}) returns (${ret.join(
            ',',
        )})`,
    ];
    const iface = new ethers.Interface(abi);
    const allArgs = [];
    const argValues = Object.values(args);
    for (let i = 0; i < argValues.length; i++) {
        allArgs.push(argValues[i]);
    }

    console.log(abi[0], 'with args', allArgs);

    return {
        iface,
        data: iface.encodeFunctionData(method, allArgs),
    };
}

async function fetchJson (url, params = {}, noWarnings = false) {
    let res;
    try {
        res = await fetch(url, params);
        if (res.status !== 200) {
            if (noWarnings) return;
            console.log('res error');
            console.log(res);
            throw res;
        }
        return res.json();
    } catch (e) {
        if (noWarnings) return;
        console.log('fetchJson error', JSON.stringify(e));
    }
}

// Run the script
depositToFaucet();
