import { useState, useEffect, useContext } from "react";
import { NearContext } from "../context";

import { Ethereum } from "../services/ethereum";
import { useDebounce } from "../hooks/debounce";
import PropTypes from 'prop-types';
import * as nearAPI from "near-api-js";
import BN from "bn.js";

const Sepolia = 11155111;
const Eth = new Ethereum('https://rpc2.sepolia.org', Sepolia);
const { connect, keyStores, WalletConnection, Contract } = nearAPI;
const myKeyStore = new keyStores.BrowserLocalStorageKeyStore();

export function EthereumView({ props: { setStatus, MPC_CONTRACT, NEAR_ACCOUNT } }) {
  const { wallet, signedAccountId } = useContext(NearContext);

  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState("request");
  const [signedTransaction, setSignedTransaction] = useState(null);
  const [senderAddress, setSenderAddress] = useState("")

  const [derivation, setDerivation] = useState("ethereum-1");
  const derivationPath = useDebounce(derivation, 1000);

  const [nearAccount, setNearAccount] = useState(null);

  useEffect(() => {
    async function initWallet() {
      const connectionConfig = {
        networkId: "testnet",
        keyStore: myKeyStore, // first create a key store
        nodeUrl: "https://rpc.testnet.near.org",
        walletUrl: "https://testnet.mynearwallet.com/",
        helperUrl: "https://helper.testnet.near.org",
        explorerUrl: "https://testnet.nearblocks.io",
      };

      const nearConnection = await connect(connectionConfig);

      if (nearAccount === null) {
        const account = await nearConnection.account();
        setNearAccount(account);
      }

      const key = await myKeyStore.getKey("testnet", NEAR_ACCOUNT);
      if (key === null) {
        const walletConnection = new WalletConnection(nearConnection, "kaushiksapp");
        walletConnection.requestSignIn({
          contractId: NEAR_ACCOUNT // TODO where do we get the wallet?
        }).catch((e) => {
          setStatus(`Error connecting to wallet ${e}`)
        });
      }
    }

    initWallet();
  }, []);

  useEffect(() => {
    setSenderAddress('Waiting for you to stop typing...')
  }, [derivation]);

  useEffect(() => {
    setEthAddress()

    async function setEthAddress() {
      setStatus('Querying your address and balance');
      setSenderAddress(`Deriving address from path ${derivationPath}...`);

      const { address } = await Eth.deriveAddress(signedAccountId, derivationPath);
      setSenderAddress(address);

      const balance = await Eth.getBalance(address);
      setStatus(`Your Ethereum address is: ${address}, balance: ${balance} ETH`);
    }
  }, [signedAccountId, derivationPath]);

  async function chainSignature() {
    setStatus('🏗️ Creating transaction');
    console.log("wallet address in chain sig", wallet.address);
    const {transaction, payload } = await Eth.createSepoliaFaucetPayload(senderAddress);

    console.log("wallet with access key", wallet.createAccessKeyFor);
    setStatus(`🕒 Asking ${MPC_CONTRACT} to sign the transaction, this might take a while`);

    try {
      const signedTransaction = await Eth.sign(wallet, MPC_CONTRACT, transaction, payload, derivationPath, senderAddress);
      // const signedTransaction = await Eth.requestSignatureToMPCNearContract(wallet, derivationPath, transaction, payload, senderAddress);
      setSignedTransaction(signedTransaction);
      setStatus(`✅ Signed payload ready to be relayed to the Ethereum network`);
      setStep('relay');
    } catch (e) {
      setStatus(`❌ Error: ${e.message}`);
      setLoading(false);
    }
  }



  async function relayTransaction() {
    setLoading(true);
    setStatus('🔗 Relaying transaction to the Ethereum network... this might take a while');

    try {
      const txHash = await Eth.relayTransaction(signedTransaction);
      setStatus(<>
        <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank"> ✅ Successful </a>
      </>
      );
    } catch (e) {
      setStatus(`❌ Error: ${e.message} Reason: ${e.reason}}`);
    }

    setStep('request');
    setLoading(false);
  }

  const UIChainSignature = async () => {
    setLoading(true);
    await chainSignature();
    setLoading(false);
  }

  return (
    <>
      <div className="row mb-3">
        <label className="col-sm-2 col-form-label col-form-label-sm">Path:</label>
        <div className="col-sm-10">
          <input type="text" className="form-control form-control-sm" value={derivation} onChange={(e) => setDerivation(e.target.value)} disabled={loading} />
          <div className="form-text" id="eth-sender"> {senderAddress} </div>
        </div>
      </div>

      <div className="text-center">
        {step === 'request' && <button className="btn btn-primary text-center" onClick={UIChainSignature} disabled={loading}> Request Signature </button>}
        {step === 'relay' && <button className="btn btn-success text-center" onClick={relayTransaction} disabled={loading}> Relay Transaction </button>}
      </div>
    </>
  )
}

EthereumView.propTypes = {
  props: PropTypes.shape({
    setStatus: PropTypes.func.isRequired,
    MPC_CONTRACT: PropTypes.string.isRequired,
    NEAR_ACCOUNT: PropTypes.string.isRequired
  }).isRequired
};